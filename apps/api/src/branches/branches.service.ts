import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  azimutsVoiesGiratoire,
  branchesTroncons,
  cleVoie,
  distanceArretNoeud,
  flechesParVoie,
  genererVoies,
  liaisonsHorsNoeud,
  mouvementsDepuisConnexions,
  NOEUDS_CONSEILLES,
  proposerConnexions,
  proposerLiaisonsNoeuds,
  repereLocal,
  type LonLat,
  type XY,
} from '@voirie/engine';
import type {
  Anneau,
  Branche,
  BrancheLue,
  BranchesCarrefour,
  ConfigurationBranches,
  Chainage,
  Connexion,
  DetectionBranches,
  SensBranche,
  Voie,
} from '@voirie/schema';
import { DRIZZLE, type Db } from '../db/db.module.js';
import { tableExiste, type Executeur } from '../db/sql.js';
import { assurerVoies } from '../osm/voies-osm.js';
import { proposerBranches, type Passage } from './detection.js';

/** Marge ajoutée au feu le plus éloigné du centre pour tracer le cercle de détection. */
const MARGE_CERCLE_M = 15;
const RAYON_MIN_M = 20;
const RAYON_MAX_M = 80;
/** Giratoire : les branches se détectent sur un cercle à cette distance au-delà de l'anneau. */
const MARGE_ANNEAU_M = 15;
/** Distance maximale entre le carrefour et l'anneau OSM qu'on lui associe. */
const DISTANCE_ANNEAU_OSM_M = 60;
/** Voies OSM chargées autour du carrefour avant la détection : cercle, anneau et ses rues. */
const RAYON_VOIES_DETECTION_M = 250;
/** Deux raccordements à l'anneau plus proches que cela forment un seul nœud (m). */
const ECART_NOEUDS_MIN_M = 6;

/** Anneau lu dans OSM : son tracé fermé, dans le sens de circulation, et ce qui s'y raccorde. */
interface AnneauOsm {
  trace: LonLat[];
  centre: [number, number];
  rayon: number;
  voies: number;
  /** Où une voie OSM (ou le tram, osm_id nul) touche l'anneau. */
  raccords: Array<{ osmId: number | null; position: LonLat }>;
}

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
  chainages: Chainage[] = [],
): BranchesCarrefour {
  const avecDepart = new Set(connexions.map((c) => c.de));
  const alertes = branches.flatMap((b) =>
    b.voies
      .filter((v) => v.sens === 'entrante' && !avecDepart.has(cleVoie(b.code, 'entrante', v.rang)))
      .map((v) => `${b.code}, voie entrante ${v.rang + 1} : aucune connexion`),
  );
  if (anneau) {
    // Une rue se raccorde à un nœud ; le tram ou un site propre bus peut traverser l'îlot.
    const sitePropre = (b: Branche) => b.voies.length > 0 && b.voies.every((v) => v.type === 'tram' || v.type === 'bus');
    alertes.push(
      ...branches.filter((b) => !b.troncon && !b.noeud && !sitePropre(b)).map((b) => `${b.code} : rue raccordée à aucun nœud de l'anneau`),
    );
  }
  const azimutsVoies = azimutsVoiesGiratoire(branches, anneau);
  return {
    centre,
    branches: branches.map((b): BrancheLue => ({ ...b, sens: sensDe(b) })),
    connexions,
    chainages,
    anneau,
    mouvements: mouvementsDepuisConnexions(branches, connexions, azimutsVoies),
    fleches: flechesParVoie(branches, connexions, azimutsVoies),
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
             coalesce((ST_AsGeoJSON(b.traversee)::json)->'coordinates', '[]'::json) AS passages,
             b.priorite_entree, b.noeud, b.troncon,
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
    const { rows: chainages } = await this.db.execute<Chainage>(sql`
      SELECT bs.code || ':s' || vs.rang AS de, be.code || ':e' || ve.rang AS vers
      FROM chainage c
      JOIN voie vs ON vs.id = c.voie_sortie_id JOIN branche bs ON bs.id = vs.branche_id
      JOIN voie ve ON ve.id = c.voie_entree_id JOIN branche be ON be.id = ve.branche_id
      WHERE c.carrefour_id = ${carrefourId}
      ORDER BY 1, 2
    `);
    return deduire(centre, branches, connexions, anneau, chainages);
  }

  /**
   * Proposition depuis OSM, **non enregistrée** : branches, voies générées le long de leur
   * axe (à caler ensuite sur la photo), passages piétons, et connexions tirées des flèches.
   * Giratoire : les nœuds de l'anneau se posent là où les rues et le tram touchent l'anneau
   * OSM (`junction=roundabout`), quatre au moins ; chaque rue se raccorde à son nœud, et chaque
   * nœud reçoit des liaisons par défaut (continuer, sortir, s'insérer).
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
    const centreCarrefour: [number, number] = [cercle.lon, cercle.lat];
    // Les voies OSM se chargent à la demande autour du carrefour (anneau d'un giratoire compris).
    await assurerVoies(this.db, centreCarrefour, RAYON_VOIES_DETECTION_M);
    const osm = await tableExiste(this.db, 'osm_way');
    const lu = cercle.nature === 'giratoire' && osm ? await this.anneauOsm(centreCarrefour) : null;
    // Giratoire : les branches rayonnent depuis le centre de l'anneau, et se détectent au-delà.
    const centre: [number, number] = lu ? lu.centre : centreCarrefour;
    const rayon = lu ? Math.max(cercle.rayon, lu.rayon + MARGE_ANNEAU_M) : cercle.rayon;
    const passages = osm ? await this.passages(centre, rayon, lu !== null) : [];
    const { branches: proposees, sources } = proposerBranches(passages, centre);

    if (!lu) {
      const branches = proposees.map((p): Branche => {
        const voies = genererVoies(centre as LonLat, p.azimut, p.fleches.length, p.sortantes);
        return {
          ...brancheProposee(p),
          voies: [...segments('entrante', voies.entrantes), ...segments('sortante', voies.sortantes)],
          passages: [voies.traversee],
          noeud: null,
        };
      });
      // Giratoire sans anneau dans OSM : les nœuds se posent à la main.
      const anneau = cercle.nature === 'giratoire' ? cercle.anneau : null;
      return { ...deduire(centreCarrefour, branches, proposerConnexions(proposees), anneau), rayon_m: Math.round(rayon), sources };
    }

    const { anneau, noeudDesVoiesOsm } = noeudsDepuisOsm(lu);
    const voiesAnneau = new Map(anneau.noeuds.map((n) => [`R${n.code}`, lu.voies]));
    const repere = repereLocal(lu.centre);
    const rues = proposees.map((p): Branche => {
      // La rue se raccorde au nœud où sa voie OSM touche l'anneau, sinon au plus proche.
      const bout = repere.versXY(p.geom.at(-1)!);
      const noeud =
        noeudDesVoiesOsm.get(p.osm_way_id) ??
        anneau.noeuds.reduce((a, b) => (distanceXY(repere.versXY(a.position), bout) <= distanceXY(repere.versXY(b.position), bout) ? a : b));
      const [x, y] = repere.versXY(noeud.position);
      const azimutDepuisNoeud = ((Math.atan2(bout[0] - x, bout[1] - y) * 180) / Math.PI + 360) % 360;
      const voies = genererVoies(noeud.position, azimutDepuisNoeud, p.fleches.length, p.sortantes, distanceArretNoeud(lu.voies));
      return {
        ...brancheProposee(p),
        voies: [...segments('entrante', voies.entrantes), ...segments('sortante', voies.sortantes)],
        passages: [voies.traversee],
        noeud: noeud.code,
      };
    });
    const branches: Branche[] = [...rues, ...branchesTroncons(anneau, voiesAnneau)];
    const connexions = proposerLiaisonsNoeuds(branches, anneau);
    // Les liaisons d'un giratoire ne viennent pas des flèches OSM : toutes sont proposées par défaut.
    const parDefaut = Object.fromEntries(Object.keys(sources).map((code) => [code, 'defaut' as const]));
    return { ...deduire(centreCarrefour, branches, connexions, anneau), rayon_m: Math.round(rayon), sources: parDefaut };
  }

  /** Remplace branches, voies, passages piétons, connexions, chaînages et anneau du carrefour. */
  async enregistrer(carrefourId: string, { branches, connexions, chainages, anneau }: ConfigurationBranches): Promise<BranchesCarrefour> {
    const horsNoeud = anneau ? liaisonsHorsNoeud(branches, connexions, anneau) : [];
    if (horsNoeud.length > 0) {
      throw new BadRequestException({
        message: 'Liaisons entre deux nœuds différents',
        erreurs: horsNoeud.map((c) => `${c.replace('>', ' → ')} : les deux voies ne sont pas au même nœud`),
      });
    }
    await this.db.transaction(async (tx) => {
      await this.carrefour(tx, carrefourId); // 404 si le carrefour n'existe pas
      await tx.execute(sql`UPDATE carrefour SET anneau = ${anneau ? JSON.stringify(anneau) : null}::jsonb WHERE id = ${carrefourId}`);
      await tx.execute(sql`DELETE FROM branche WHERE carrefour_id = ${carrefourId}`);
      const idsVoies = new Map<string, string>();
      for (const b of branches) {
        const ligne = (coords: unknown) => (coords ? JSON.stringify({ type: 'LineString', coordinates: coords }) : null);
        const passages = b.passages.length ? JSON.stringify({ type: 'MultiLineString', coordinates: b.passages }) : null;
        const { rows } = await tx.execute<{ id: string }>(sql`
          INSERT INTO branche (carrefour_id, code, nom, azimut_deg, sens, osm_way_id, geom, traversee, priorite_entree, noeud, troncon)
          VALUES (${carrefourId}, ${b.code}, ${b.nom}, ${b.azimut}, ${sensDe(b)}, ${b.osm_way_id},
                  ST_SetSRID(ST_GeomFromGeoJSON(${ligne(b.geom)}), 4326),
                  ST_SetSRID(ST_GeomFromGeoJSON(${passages}), 4326),
                  ${b.priorite_entree}::priorite_entree, ${b.noeud}, ${b.troncon})
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
      for (const c of chainages) {
        await tx.execute(sql`
          INSERT INTO chainage (carrefour_id, voie_sortie_id, voie_entree_id)
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
   * reliées en une boucle, tracée dans le sens de circulation. Raccords : points où une rue
   * ou le tram touche l'anneau.
   */
  private async anneauOsm([lon, lat]: [number, number]): Promise<AnneauOsm | null> {
    const circulables = `{${VOIES_CIRCULABLES.join(',')}}`;
    const { rows } = await this.db.execute<{
      trace: { coordinates: LonLat[] };
      lon: number;
      lat: number;
      rayon: number;
      voies: number | null;
      raccords: Array<{ osm_id: number | null; lon: number; lat: number }> | null;
    }>(sql`
      WITH point AS (SELECT ST_SetSRID(ST_MakePoint(${lon}::float8, ${lat}::float8), 4326) AS geom),
      anneaux AS (
        SELECT w.osm_id, w.geom, w.tags, ST_ClusterDBSCAN(w.geom, 0, 1) OVER () AS groupe
        FROM osm_way w, point p
        WHERE w.tags->>'junction' IN ('roundabout', 'circular')
          AND ST_DWithin(w.geom::geography, p.geom::geography, ${DISTANCE_ANNEAU_OSM_M}::float8)
      ), plus_proche AS (
        SELECT a.groupe FROM anneaux a, point p
        GROUP BY a.groupe ORDER BY min(ST_Distance(a.geom::geography, p.geom::geography)) LIMIT 1
      ), boucle AS (
        SELECT ST_LineMerge(ST_Union(a.geom)) AS geom, array_agg(a.osm_id) AS ids,
               max(nullif(regexp_replace(a.tags->>'lanes', '[^0-9].*$', ''), '')::int) AS voies
        FROM anneaux a JOIN plus_proche USING (groupe)
      ), raccords AS (
        SELECT w.osm_id, (ST_Dump(ST_Intersection(w.geom, b.geom))).geom AS pt
        FROM osm_way w, boucle b
        WHERE ST_Intersects(w.geom, b.geom) AND NOT (w.osm_id = ANY (b.ids))
          AND regexp_replace(w.tags->>'highway', '_link$', '') = ANY (${circulables}::text[])
        UNION ALL
        SELECT NULL, (ST_Dump(ST_Intersection(t.geom, b.geom))).geom
        FROM osm_tram t, boucle b WHERE ST_Intersects(t.geom, b.geom)
      )
      SELECT ST_AsGeoJSON(b.geom)::json AS trace,
             ST_X(ST_Centroid(ST_ConvexHull(b.geom))) AS lon, ST_Y(ST_Centroid(ST_ConvexHull(b.geom))) AS lat,
             sqrt(ST_Area(ST_ConvexHull(b.geom)::geography) / pi()) AS rayon, b.voies,
             (SELECT json_agg(json_build_object('osm_id', r.osm_id, 'lon', ST_X(r.pt), 'lat', ST_Y(r.pt)))
              FROM raccords r WHERE GeometryType(r.pt) = 'POINT') AS raccords
      FROM boucle b
      WHERE GeometryType(b.geom) = 'LINESTRING' AND ST_IsClosed(b.geom)
    `);
    const lu = rows[0];
    if (!lu) return null;
    return {
      trace: lu.trace.coordinates,
      centre: [lu.lon, lu.lat],
      rayon: lu.rayon,
      voies: Math.min(Math.max(lu.voies ?? 1, 1), 4),
      raccords: (lu.raccords ?? []).map((r) => ({ osmId: r.osm_id === null ? null : Number(r.osm_id), position: [r.lon, r.lat] })),
    };
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

/** Voies (clé → segment), passages piétons (branche → segment) et tronçons d'anneau d'une configuration lue. */
export function geometrieDe(config: BranchesCarrefour) {
  return {
    centre: config.centre,
    connexions: config.connexions,
    voies: new Map(
      config.branches.flatMap((b) => b.voies.map((v) => [cleVoie(b.code, v.sens, v.rang), v.geom] as const)),
    ),
    traversees: new Map(config.branches.flatMap((b) => (b.passages.length ? [[b.code, b.passages] as const] : []))),
    troncons: new Set(config.branches.filter((b) => b.troncon).map((b) => b.code)),
  };
}


const distanceXY = (a: XY, b: XY) => Math.hypot(a[0] - b[0], a[1] - b[1]);

const segments = (sens: Voie['sens'], liste: Array<[LonLat, LonLat]>): Voie[] =>
  liste.map((geom, rang) => ({ sens, rang, type: 'generale', geom }));

/** Champs d'une branche proposée qui ne dépendent pas de ses voies. */
function brancheProposee(p: ReturnType<typeof proposerBranches>['branches'][number]) {
  return { code: p.code, nom: p.nom, azimut: p.azimut, osm_way_id: p.osm_way_id, geom: p.geom, priorite_entree: null, troncon: false };
}

/**
 * Nœuds d'un anneau OSM : un par raccord (rue ou tram), les raccords voisins de moins de
 * 6 m confondus, puis complétés à mi-chemin des plus grands écarts jusqu'à quatre. Ordre :
 * celui du tracé OSM, qui suit le sens de circulation ; on le retourne s'il est horaire.
 */
export function noeudsDepuisOsm(lu: AnneauOsm): { anneau: Anneau; noeudDesVoiesOsm: Map<number, Anneau['noeuds'][number]> } {
  const repere = repereLocal(lu.centre);
  const trace = lu.trace.map(repere.versXY);
  const cumul = trace.reduce<number[]>((acc, p, i) => [...acc, i === 0 ? 0 : acc[i - 1]! + distanceXY(trace[i - 1]!, p)], []);
  const longueur = cumul.at(-1)!;
  const abscisse = (p: XY) => {
    let meilleure = { d: Infinity, s: 0 };
    for (let i = 0; i < trace.length - 1; i++) {
      const a = trace[i]!;
      const b = trace[i + 1]!;
      const l = distanceXY(a, b) || 1e-9;
      const t = Math.min(Math.max(((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / (l * l), 0), 1);
      const d = distanceXY(p, [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
      if (d < meilleure.d) meilleure = { d, s: cumul[i]! + t * l };
    }
    return meilleure.s;
  };
  const pointA = (s: number): XY => {
    const d = ((s % longueur) + longueur) % longueur;
    const i = Math.max(cumul.findIndex((c) => c >= d) - 1, 0);
    const l = cumul[i + 1]! - cumul[i]! || 1e-9;
    const t = (d - cumul[i]!) / l;
    return [trace[i]![0] + t * (trace[i + 1]![0] - trace[i]![0]), trace[i]![1] + t * (trace[i + 1]![1] - trace[i]![1])];
  };

  const places: Array<{ s: number; osmIds: number[] }> = [];
  for (const r of lu.raccords.map((r) => ({ ...r, s: abscisse(repere.versXY(r.position)) })).sort((a, b) => a.s - b.s)) {
    const proche = places.find((p) => Math.min(Math.abs(p.s - r.s), longueur - Math.abs(p.s - r.s)) < ECART_NOEUDS_MIN_M);
    if (proche) {
      if (r.osmId !== null) proche.osmIds.push(r.osmId);
    } else places.push({ s: r.s, osmIds: r.osmId === null ? [] : [r.osmId] });
  }
  while (places.length < NOEUDS_CONSEILLES) {
    places.sort((a, b) => a.s - b.s);
    const ecarts = places.map((p, i) => ({ i, ecart: ((places[(i + 1) % places.length]?.s ?? p.s + longueur) - p.s + longueur) % longueur || longueur }));
    const plusGrand = ecarts.reduce((a, b) => (b.ecart > a.ecart ? b : a), { i: 0, ecart: places.length ? 0 : longueur });
    const depart = places[plusGrand.i]?.s ?? 0;
    places.push({ s: (depart + plusGrand.ecart / 2) % longueur, osmIds: [] });
  }
  places.sort((a, b) => a.s - b.s);

  const points = places.map((p) => pointA(p.s));
  // Aire signée (x vers l'est, y vers le nord) : positive dans le sens antihoraire.
  const aire = points.reduce((somme, p, i) => {
    const q = points[(i + 1) % points.length]!;
    return somme + p[0] * q[1] - q[0] * p[1];
  }, 0);
  const ordre = aire >= 0 ? places.map((_, i) => i) : places.map((_, i) => i).reverse();
  const noeuds = ordre.map((i, rang) => ({ code: String(rang + 1), position: repere.versLonLat(points[i]!) }));
  const noeudDesVoiesOsm = new Map(ordre.flatMap((i, rang) => places[i]!.osmIds.map((id) => [id, noeuds[rang]!] as const)));
  return { anneau: { noeuds }, noeudDesVoiesOsm };
}
