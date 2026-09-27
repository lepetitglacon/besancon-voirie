import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  cleVoie,
  distanceArretGiratoire,
  flechesParVoie,
  genererVoies,
  LARGEUR_VOIE_M,
  mouvementsDepuisConnexions,
  proposerConnexions,
  RAYON_ANNEAU_DEFAUT_M,
  type LonLat,
} from '@voirie/engine';
import type {
  Anneau,
  Branche,
  BrancheLue,
  BranchesCarrefour,
  ConfigurationBranches,
  Connexion,
  DetectionBranches,
  SensBranche,
  Voie,
} from '@voirie/schema';
import { DRIZZLE, type Db } from '../db/db.module.js';
import { tableExiste, type Executeur } from '../db/sql.js';
import { connexionsGiratoire, proposerBranches, type Passage } from './detection.js';

/** Marge ajoutée au feu le plus éloigné du centre pour tracer le cercle de détection. */
const MARGE_CERCLE_M = 15;
const RAYON_MIN_M = 20;
const RAYON_MAX_M = 80;
/** Giratoire : les branches se détectent sur un cercle à cette distance au-delà de l'anneau. */
const MARGE_ANNEAU_M = 15;
/** Distance maximale entre le carrefour et l'anneau OSM qu'on lui associe. */
const DISTANCE_ANNEAU_OSM_M = 60;

/**
 * Voies prises en compte pour détecter les branches. Les voies `service` (parkings, accès
 * riverains) sont écartées : elles encombrent la proposition et sont rarement réglées par des feux.
 */
const VOIES_CIRCULABLES = [
  'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified',
  'residential', 'living_street', 'busway', 'road',
];

function sensDe(branche: Branche): SensBranche {
  const entrantes = branche.voies.some((v) => v.sens === 'entrante');
  const sortantes = branche.voies.some((v) => v.sens === 'sortante');
  return entrantes && sortantes ? 'double' : entrantes ? 'entrant' : 'sortant';
}

/** Complète branches et connexions avec ce qui s'en déduit : sens, mouvements, flèches, alertes. */
export function deduire(
  centre: [number, number],
  branches: Branche[],
  connexions: Connexion[],
  anneau: Anneau | null = null,
): BranchesCarrefour {
  const avecDepart = new Set(connexions.map((c) => c.de));
  const alertes = branches.flatMap((b) =>
    b.voies
      .filter((v) => v.sens === 'entrante' && !avecDepart.has(cleVoie(b.code, 'entrante', v.rang)))
      .map((v) => `${b.code}, voie entrante ${v.rang + 1} : aucune connexion`),
  );
  return {
    centre,
    branches: branches.map((b): BrancheLue => ({ ...b, sens: sensDe(b) })),
    connexions,
    anneau,
    mouvements: mouvementsDepuisConnexions(branches, connexions),
    fleches: flechesParVoie(branches, connexions),
    alertes,
  };
}

@Injectable()
export class BranchesService {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  /** Branches, voies, passages piétons et connexions enregistrés, avec ce qui s'en déduit. */
  async lire(carrefourId: string): Promise<BranchesCarrefour> {
    const { centre, anneau } = await this.carrefour(this.db, carrefourId);
    const { rows: branches } = await this.db.execute<Branche>(sql`
      SELECT b.code, b.nom, b.azimut_deg AS azimut, b.osm_way_id::float8 AS osm_way_id,
             (ST_AsGeoJSON(b.geom)::json)->'coordinates' AS geom,
             (ST_AsGeoJSON(b.traversee)::json)->'coordinates' AS traversee,
             b.priorite_entree,
             coalesce(
               (SELECT json_agg(json_build_object(
                          'sens', v.sens, 'rang', v.rang, 'type', v.type,
                          'geom', (ST_AsGeoJSON(v.geom)::json)->'coordinates')
                        ORDER BY v.sens, v.rang)
                FROM voie v WHERE v.branche_id = b.id),
               '[]'::json
             ) AS voies
      FROM branche b
      WHERE b.carrefour_id = ${carrefourId}
      ORDER BY b.azimut_deg
    `);
    const { rows: connexions } = await this.db.execute<Connexion>(sql`
      SELECT be.code || ':e' || ve.rang AS de, bs.code || ':s' || vs.rang AS vers
      FROM connexion c
      JOIN voie ve ON ve.id = c.voie_entree_id JOIN branche be ON be.id = ve.branche_id
      JOIN voie vs ON vs.id = c.voie_sortie_id JOIN branche bs ON bs.id = vs.branche_id
      WHERE c.carrefour_id = ${carrefourId}
      ORDER BY 1, 2
    `);
    return deduire(centre, branches, connexions, anneau);
  }

  /**
   * Proposition depuis OSM, **non enregistrée** : branches, voies générées le long de leur
   * axe (à caler ensuite sur la photo), passages piétons, et connexions tirées des flèches.
   * Giratoire : l'anneau vient d'OSM (`junction=roundabout`), les branches se détectent autour
   * de lui, leurs voies s'arrêtent à son bord et chaque entrée mène à toutes les sorties.
   */
  async detecter(carrefourId: string): Promise<DetectionBranches> {
    const { rows } = await this.db.execute<{ lon: number; lat: number; rayon: number; nature: string; anneau: Anneau | null }>(sql`
      SELECT ST_X(c.geom) AS lon, ST_Y(c.geom) AS lat, c.nature, c.anneau,
             least(greatest(coalesce(max(ST_Distance(f.geom::geography, c.geom::geography)), 0) + ${MARGE_CERCLE_M},
                            ${RAYON_MIN_M}), ${RAYON_MAX_M}) AS rayon
      FROM carrefour c LEFT JOIN feu f ON f.carrefour_id = c.id
      WHERE c.id = ${carrefourId}
      GROUP BY c.id
    `);
    const cercle = rows[0];
    if (!cercle) throw new NotFoundException('Carrefour inconnu');
    const osm = await tableExiste(this.db, 'osm_way');
    const centreCarrefour: [number, number] = [cercle.lon, cercle.lat];
    const anneau =
      cercle.nature === 'giratoire'
        ? ((osm ? await this.anneauOsm(centreCarrefour) : null) ??
          cercle.anneau ?? { centre: centreCarrefour, rayon_m: RAYON_ANNEAU_DEFAUT_M, voies: 1 })
        : null;
    // Giratoire : les branches rayonnent depuis le centre de l'îlot, au-delà de l'anneau.
    const centre: [number, number] = anneau ? anneau.centre : centreCarrefour;
    const rayon = anneau ? Math.max(cercle.rayon, anneau.rayon_m + MARGE_ANNEAU_M) : cercle.rayon;
    const passages = osm ? await this.passages(centre, rayon, anneau !== null) : [];
    const { branches: proposees, sources } = proposerBranches(passages, centre);

    const branches = proposees.map((p): Branche => {
      const voies = genererVoies(
        centre as LonLat,
        p.azimut,
        p.fleches.length,
        p.sortantes,
        anneau ? distanceArretGiratoire(anneau) : undefined,
      );
      const segments = (sens: Voie['sens'], liste: typeof voies.entrantes): Voie[] =>
        liste.map((geom, rang) => ({ sens, rang, type: 'generale', geom }));
      return {
        code: p.code,
        nom: p.nom,
        azimut: p.azimut,
        osm_way_id: p.osm_way_id,
        geom: p.geom,
        voies: [...segments('entrante', voies.entrantes), ...segments('sortante', voies.sortantes)],
        traversee: voies.traversee,
        priorite_entree: null,
      };
    });
    const connexions = anneau ? connexionsGiratoire(proposees) : proposerConnexions(proposees);
    // Dans un giratoire, les connexions ne viennent pas des flèches : toutes sont proposées par défaut.
    const sourcesRetenues = anneau ? Object.fromEntries(Object.keys(sources).map((code) => [code, 'defaut' as const])) : sources;
    return { ...deduire(centreCarrefour, branches, connexions, anneau), rayon_m: Math.round(rayon), sources: sourcesRetenues };
  }

  /** Remplace branches, voies, passages piétons, connexions et anneau du carrefour. */
  async enregistrer(carrefourId: string, { branches, connexions, anneau }: ConfigurationBranches): Promise<BranchesCarrefour> {
    await this.db.transaction(async (tx) => {
      await this.carrefour(tx, carrefourId); // 404 si le carrefour n'existe pas
      await tx.execute(sql`UPDATE carrefour SET anneau = ${anneau ? JSON.stringify(anneau) : null}::jsonb WHERE id = ${carrefourId}`);
      await tx.execute(sql`DELETE FROM branche WHERE carrefour_id = ${carrefourId}`);
      const idsVoies = new Map<string, string>();
      for (const b of branches) {
        const ligne = (coords: unknown) => (coords ? JSON.stringify({ type: 'LineString', coordinates: coords }) : null);
        const { rows } = await tx.execute<{ id: string }>(sql`
          INSERT INTO branche (carrefour_id, code, nom, azimut_deg, sens, osm_way_id, geom, traversee, priorite_entree)
          VALUES (${carrefourId}, ${b.code}, ${b.nom}, ${b.azimut}, ${sensDe(b)}, ${b.osm_way_id},
                  ST_SetSRID(ST_GeomFromGeoJSON(${ligne(b.geom)}), 4326),
                  ST_SetSRID(ST_GeomFromGeoJSON(${ligne(b.traversee)}), 4326),
                  ${b.priorite_entree}::priorite_entree)
          RETURNING id
        `);
        for (const v of b.voies) {
          const { rows: voie } = await tx.execute<{ id: string }>(sql`
            INSERT INTO voie (branche_id, sens, rang, type, geom)
            VALUES (${rows[0]!.id}, ${v.sens}, ${v.rang}, ${v.type}, ST_SetSRID(ST_GeomFromGeoJSON(${ligne(v.geom)}), 4326))
            RETURNING id
          `);
          idsVoies.set(cleVoie(b.code, v.sens, v.rang), voie[0]!.id);
        }
      }
      for (const c of connexions) {
        // Les clés ont été validées par le schéma : les deux voies existent.
        await tx.execute(sql`
          INSERT INTO connexion (carrefour_id, voie_entree_id, voie_sortie_id)
          VALUES (${carrefourId}, ${idsVoies.get(c.de)!}, ${idsVoies.get(c.vers)!})
        `);
      }
    });
    return this.lire(carrefourId);
  }

  private async carrefour(db: Executeur, carrefourId: string): Promise<{ centre: [number, number]; anneau: Anneau | null }> {
    const { rows } = await db.execute<{ lon: number; lat: number; anneau: Anneau | null }>(
      sql`SELECT ST_X(geom) AS lon, ST_Y(geom) AS lat, anneau FROM carrefour WHERE id = ${carrefourId}`,
    );
    if (!rows[0]) throw new NotFoundException('Carrefour inconnu');
    return { centre: [rows[0].lon, rows[0].lat], anneau: rows[0].anneau };
  }

  /**
   * Anneau OSM le plus proche du carrefour : voies `junction=roundabout` (ou `circular`)
   * reliées entre elles. Le tracé OSM suit le milieu de la chaussée annulaire : le bord
   * extérieur est une demi-largeur plus loin.
   */
  private async anneauOsm([lon, lat]: [number, number]): Promise<Anneau | null> {
    const { rows } = await this.db.execute<{ lon: number; lat: number; rayon: number; voies: number | null }>(sql`
      WITH point AS (SELECT ST_SetSRID(ST_MakePoint(${lon}::float8, ${lat}::float8), 4326) AS geom),
      anneaux AS (
        SELECT w.geom, w.tags, ST_ClusterDBSCAN(w.geom, 0, 1) OVER () AS groupe
        FROM osm_way w, point p
        WHERE w.tags->>'junction' IN ('roundabout', 'circular')
          AND ST_DWithin(w.geom::geography, p.geom::geography, ${DISTANCE_ANNEAU_OSM_M}::float8)
      ), groupes AS (
        SELECT ST_ConvexHull(ST_Collect(geom)) AS enveloppe,
               max(nullif(regexp_replace(tags->>'lanes', '[^0-9].*$', ''), '')::int) AS voies
        FROM anneaux GROUP BY groupe
      )
      SELECT ST_X(ST_Centroid(g.enveloppe)) AS lon, ST_Y(ST_Centroid(g.enveloppe)) AS lat,
             sqrt(ST_Area(g.enveloppe::geography) / pi()) AS rayon, g.voies
      FROM groupes g, point p
      WHERE GeometryType(g.enveloppe) = 'POLYGON'
      ORDER BY ST_Distance(g.enveloppe::geography, p.geom::geography)
      LIMIT 1
    `);
    const trouve = rows[0];
    if (!trouve) return null;
    const voies = Math.min(Math.max(trouve.voies ?? 1, 1), 4);
    const rayon = Math.round((trouve.rayon + (voies * LARGEUR_VOIE_M) / 2) * 10) / 10;
    return { centre: [trouve.lon, trouve.lat], rayon_m: Math.min(Math.max(rayon, 4), 150), voies };
  }

  /**
   * Points où les voies OSM circulables traversent le cercle autour du carrefour. Giratoire :
   * les voies de l'anneau lui-même ne sont pas des branches.
   */
  private async passages([lon, lat]: [number, number], rayon: number, sansAnneau: boolean): Promise<Passage[]> {
    const { rows } = await this.db.execute<{
      osm_id: string;
      tags: Record<string, string>;
      azimut: number;
      lon: number;
      lat: number;
      vient_de_l_interieur: boolean;
    }>(sql`
      WITH p AS (SELECT ST_SetSRID(ST_MakePoint(${lon}::float8, ${lat}::float8), 4326) AS geom),
      c AS (
        SELECT geom AS centre, ST_ExteriorRing(ST_Buffer(geom::geography, ${rayon}::float8, 32)::geometry) AS cercle
        FROM p
      ), voies AS (
        SELECT w.osm_id, w.tags, w.geom FROM osm_way w, c
        WHERE ST_DWithin(w.geom::geography, c.centre::geography, ${rayon}::float8 + 5)
          AND regexp_replace(w.tags->>'highway', '_link$', '') = ANY (${`{${VOIES_CIRCULABLES.join(',')}}`}::text[])
          AND coalesce(w.tags->>'area', 'no') <> 'yes'
          AND NOT (${sansAnneau}::boolean AND coalesce(w.tags->>'junction', '') IN ('roundabout', 'circular'))
      ), passages AS (
        SELECT v.osm_id, v.tags, v.geom, (ST_Dump(ST_Intersection(v.geom, c.cercle))).geom AS pt, c.centre
        FROM voies v, c WHERE ST_Intersects(v.geom, c.cercle)
      )
      SELECT osm_id::text, tags, ST_X(pt) AS lon, ST_Y(pt) AS lat,
             (degrees(ST_Azimuth(centre::geography, pt::geography)) + 360)::numeric % 360 AS azimut,
             ST_DWithin(
               ST_LineInterpolatePoint(geom, greatest(
                 ST_LineLocatePoint(geom, pt) - 2.0 / nullif(ST_Length(geom::geography), 0), 0))::geography,
               centre::geography, ${rayon}::float8
             ) AS vient_de_l_interieur
      FROM passages
      WHERE GeometryType(pt) = 'POINT'
    `);
    return rows.map((r) => ({
      osmId: Number(r.osm_id),
      tags: r.tags,
      azimut: Number(r.azimut),
      lon: r.lon,
      lat: r.lat,
      vientDeLInterieur: r.vient_de_l_interieur,
    }));
  }
}

/** Voies (clé → segment), passages piétons (branche → segment) et anneau d'une configuration lue. */
export function geometrieDe(config: BranchesCarrefour) {
  const voies = config.branches.flatMap((b) => b.voies.map((v) => ({ cle: cleVoie(b.code, v.sens, v.rang), ...v })));
  return {
    centre: config.centre,
    connexions: config.connexions,
    voies: new Map(voies.map((v) => [v.cle, v.geom] as const)),
    typesVoies: new Map(voies.map((v) => [v.cle, v.type] as const)),
    traversees: new Map(config.branches.flatMap((b) => (b.traversee ? [[b.code, b.traversee] as const] : []))),
    anneau: config.anneau,
  };
}

