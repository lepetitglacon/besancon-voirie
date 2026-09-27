import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  cleVoie,
  flechesParVoie,
  genererVoies,
  mouvementsDepuisConnexions,
  proposerConnexions,
  type LonLat,
} from '@voirie/engine';
import type {
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
import { proposerBranches, type Passage } from './detection.js';

/** Marge ajoutée au feu le plus éloigné du centre pour tracer le cercle de détection. */
const MARGE_CERCLE_M = 15;
const RAYON_MIN_M = 20;
const RAYON_MAX_M = 80;

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
export function deduire(centre: [number, number], branches: Branche[], connexions: Connexion[]): BranchesCarrefour {
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
    const centre = await this.centre(this.db, carrefourId);
    const { rows: branches } = await this.db.execute<Branche>(sql`
      SELECT b.code, b.nom, b.azimut_deg AS azimut, b.osm_way_id::float8 AS osm_way_id,
             (ST_AsGeoJSON(b.geom)::json)->'coordinates' AS geom,
             (ST_AsGeoJSON(b.traversee)::json)->'coordinates' AS traversee,
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
    return deduire(centre, branches, connexions);
  }

  /**
   * Proposition depuis OSM, **non enregistrée** : branches, voies générées le long de leur
   * axe (à caler ensuite sur la photo), passages piétons, et connexions tirées des flèches.
   */
  async detecter(carrefourId: string): Promise<DetectionBranches> {
    const { rows } = await this.db.execute<{ lon: number; lat: number; rayon: number }>(sql`
      SELECT ST_X(c.geom) AS lon, ST_Y(c.geom) AS lat,
             least(greatest(coalesce(max(ST_Distance(f.geom::geography, c.geom::geography)), 0) + ${MARGE_CERCLE_M},
                            ${RAYON_MIN_M}), ${RAYON_MAX_M}) AS rayon
      FROM carrefour c LEFT JOIN feu f ON f.carrefour_id = c.id
      WHERE c.id = ${carrefourId}
      GROUP BY c.id
    `);
    const cercle = rows[0];
    if (!cercle) throw new NotFoundException('Carrefour inconnu');
    const centre: [number, number] = [cercle.lon, cercle.lat];
    const passages = (await tableExiste(this.db, 'osm_way')) ? await this.passages(carrefourId, cercle.rayon) : [];
    const { branches: proposees, sources } = proposerBranches(passages, centre);

    const branches = proposees.map((p): Branche => {
      const voies = genererVoies(centre as LonLat, p.azimut, p.fleches.length, p.sortantes);
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
      };
    });
    const connexions = proposerConnexions(proposees);
    return { ...deduire(centre, branches, connexions), rayon_m: Math.round(cercle.rayon), sources };
  }

  /** Remplace branches, voies, passages piétons et connexions du carrefour. */
  async enregistrer(carrefourId: string, { branches, connexions }: ConfigurationBranches): Promise<BranchesCarrefour> {
    await this.db.transaction(async (tx) => {
      await this.centre(tx, carrefourId); // 404 si le carrefour n'existe pas
      await tx.execute(sql`DELETE FROM branche WHERE carrefour_id = ${carrefourId}`);
      const idsVoies = new Map<string, string>();
      for (const b of branches) {
        const ligne = (coords: unknown) => (coords ? JSON.stringify({ type: 'LineString', coordinates: coords }) : null);
        const { rows } = await tx.execute<{ id: string }>(sql`
          INSERT INTO branche (carrefour_id, code, nom, azimut_deg, sens, osm_way_id, geom, traversee)
          VALUES (${carrefourId}, ${b.code}, ${b.nom}, ${b.azimut}, ${sensDe(b)}, ${b.osm_way_id},
                  ST_SetSRID(ST_GeomFromGeoJSON(${ligne(b.geom)}), 4326),
                  ST_SetSRID(ST_GeomFromGeoJSON(${ligne(b.traversee)}), 4326))
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

  private async centre(db: Executeur, carrefourId: string): Promise<[number, number]> {
    const { rows } = await db.execute<{ lon: number; lat: number }>(
      sql`SELECT ST_X(geom) AS lon, ST_Y(geom) AS lat FROM carrefour WHERE id = ${carrefourId}`,
    );
    if (!rows[0]) throw new NotFoundException('Carrefour inconnu');
    return [rows[0].lon, rows[0].lat];
  }

  /** Points où les voies OSM circulables traversent le cercle autour du carrefour. */
  private async passages(carrefourId: string, rayon: number): Promise<Passage[]> {
    const { rows } = await this.db.execute<{
      osm_id: string;
      tags: Record<string, string>;
      azimut: number;
      lon: number;
      lat: number;
      vient_de_l_interieur: boolean;
    }>(sql`
      WITH c AS (
        SELECT geom AS centre, ST_ExteriorRing(ST_Buffer(geom::geography, ${rayon}::float8, 32)::geometry) AS cercle
        FROM carrefour WHERE id = ${carrefourId}
      ), voies AS (
        SELECT w.osm_id, w.tags, w.geom FROM osm_way w, c
        WHERE ST_DWithin(w.geom::geography, c.centre::geography, ${rayon}::float8 + 5)
          AND regexp_replace(w.tags->>'highway', '_link$', '') = ANY (${`{${VOIES_CIRCULABLES.join(',')}}`}::text[])
          AND coalesce(w.tags->>'area', 'no') <> 'yes'
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

/** Voies (clé → segment) et passages piétons (branche → segment) d'une configuration lue. */
export function geometrieDe(config: BranchesCarrefour) {
  return {
    centre: config.centre,
    connexions: config.connexions,
    voies: new Map(
      config.branches.flatMap((b) => b.voies.map((v) => [cleVoie(b.code, v.sens, v.rang), v.geom] as const)),
    ),
    traversees: new Map(config.branches.flatMap((b) => (b.traversee ? [[b.code, b.traversee] as const] : []))),
  };
}

