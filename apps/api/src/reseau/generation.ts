/**
 * Semis du réseau depuis les données OSM importées (`osm_way`, `osm_signal`, `osm_passage`) —
 * docs/RESEAU.md §3. Le réseau est semé une seule fois, puis corrigé à la main : ses
 * identifiants ne bougent plus (liaisons, carrefours et lignes de feux y renvoient). Semer de
 * nouveau exige de tout effacer (`reinitialiser`).
 */
import { ConflictException } from '@nestjs/common';
import type { BilanSemis } from '@voirie/schema';
import { sql } from 'drizzle-orm';
import { VOIES_CIRCULABLES } from '../branches/branches.service.js';
import { tableExiste, type Executeur } from '../db/sql.js';
import { decouperVoies, traverseePieton, type TronconOsm, type VoieOsm } from './osm.js';

/** Au-delà, les insertions se font par paquets (taille des paramètres JSON). */
const PAQUET = 4000;

/** Voies OSM du réseau : circulables (sans les aires ni les accès interdits) et pistes cyclables. */
async function voiesOsm(db: Executeur): Promise<VoieOsm[]> {
  const { rows } = await db.execute<{ osm_id: string; tags: Record<string, string>; nodes: string[]; coords: Array<[number, number]> }>(sql`
    SELECT osm_id::text, tags, nodes::text[] AS nodes, (ST_AsGeoJSON(geom)::json)->'coordinates' AS coords
    FROM osm_way
    WHERE coalesce(tags->>'area', 'no') <> 'yes'
      AND (
        tags->>'highway' = 'cycleway'
        OR (tags->>'highway' = 'path' AND tags->>'bicycle' = 'designated')
        OR (regexp_replace(tags->>'highway', '_link$', '') = ANY (${`{${VOIES_CIRCULABLES.join(',')}}`}::text[])
            AND coalesce(tags->>'access', 'yes') <> 'no'
            AND coalesce(tags->>'motor_vehicle', 'yes') <> 'no')
      )
  `);
  return rows.map((r) => ({ osm_id: Number(r.osm_id), tags: r.tags, nodes: r.nodes.map(Number), coords: r.coords }));
}

/**
 * Nœuds OSM qui portent une ligne d'arrêt à feux des véhicules (`highway=traffic_signals`), et
 * passages piétons avec leurs tags. Les feux piétons (`crossing=traffic_signals`) sont des passages.
 */
async function pointsOsm(db: Executeur): Promise<{ feux: Set<number>; coupes: Set<number>; passages: Map<number, Record<string, string>> }> {
  const { rows: signaux } = await db.execute<{ osm_id: string; vehicule: boolean }>(sql`
    SELECT osm_id::text, coalesce(tags->>'highway' = 'traffic_signals', false) AS vehicule FROM osm_signal
  `);
  const passages = new Map<number, Record<string, string>>();
  if (await tableExiste(db, 'osm_passage')) {
    const { rows } = await db.execute<{ osm_id: string; tags: Record<string, string> }>(sql`SELECT osm_id::text, tags FROM osm_passage`);
    for (const r of rows) passages.set(Number(r.osm_id), r.tags);
  }
  return {
    feux: new Set(signaux.filter((s) => s.vehicule).map((s) => Number(s.osm_id))),
    coupes: new Set([...signaux.map((s) => Number(s.osm_id)), ...passages.keys()]),
    passages,
  };
}

export async function semerReseau(db: Executeur, { reinitialiser }: { reinitialiser: boolean }): Promise<BilanSemis> {
  if (!(await tableExiste(db, 'osm_way'))) throw new Error('Tables OSM absentes : lancer `pnpm osm:import` avant');
  const { rows: existants } = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM troncon`);
  if (existants[0]!.n > 0 && !reinitialiser) {
    throw new ConflictException('Réseau déjà semé : il se corrige à la main. Pour repartir d’OSM, réinitialiser (tout est effacé).');
  }
  // Les carrefours gardent leurs feux ; leurs nœuds sont retrouvés après le semis.
  await db.execute(sql`DELETE FROM troncon`);
  await db.execute(sql`DELETE FROM noeud`);

  const voies = await voiesOsm(db);
  const { feux, coupes, passages } = await pointsOsm(db);
  const { noeuds, troncons } = decouperVoies(voies, coupes);

  const listeNoeuds = [...noeuds].map(([id, [lon, lat]]) => ({
    id,
    lon,
    lat,
    feux: feux.has(id),
    pieton: passages.has(id) ? traverseePieton(passages.get(id)!) : null,
  }));
  for (let i = 0; i < listeNoeuds.length; i += PAQUET) {
    await db.execute(sql`
      INSERT INTO noeud (osm_node_id, geom, feux, pieton)
      SELECT (e->>'id')::bigint, ST_SetSRID(ST_MakePoint((e->>'lon')::float8, (e->>'lat')::float8), 4326),
             (e->>'feux')::boolean, (e->>'pieton')::traversee_pieton
      FROM jsonb_array_elements(${JSON.stringify(listeNoeuds.slice(i, i + PAQUET))}::jsonb) e
    `);
  }

  for (let i = 0; i < troncons.length; i += PAQUET) {
    const paquet = troncons.slice(i, i + PAQUET).map(({ points, ...t }: TronconOsm) => ({
      ...t,
      geom: JSON.stringify({ type: 'LineString', coordinates: points }),
    }));
    await db.execute(sql`
      INSERT INTO troncon (noeud_de, noeud_vers, geom, osm_way_id, osm_de, osm_vers, osm_tags, nom, highway,
                           voies_avant, voies_arriere, types_avant, types_arriere, vitesse_kmh, source)
      SELECT nd.id, nv.id, ST_SetSRID(ST_GeomFromGeoJSON(e->>'geom'), 4326),
             (e->>'osm_way_id')::bigint, (e->>'de')::bigint, (e->>'vers')::bigint, e->'tags', e->>'nom', e->>'highway',
             (e->>'voies_avant')::smallint, (e->>'voies_arriere')::smallint,
             nullif(e->'types_avant', 'null'::jsonb), nullif(e->'types_arriere', 'null'::jsonb),
             (e->>'vitesse_kmh')::smallint, 'osm'
      FROM jsonb_array_elements(${JSON.stringify(paquet)}::jsonb) e
      JOIN noeud nd ON nd.osm_node_id = (e->>'de')::bigint
      JOIN noeud nv ON nv.osm_node_id = (e->>'vers')::bigint
    `);
  }

  const { rows: compte } = await db.execute<Omit<BilanSemis, 'voies_osm' | 'carrefours'>>(sql`
    SELECT (SELECT count(*)::int FROM noeud) AS noeuds,
           (SELECT count(*)::int FROM troncon) AS troncons,
           (SELECT count(*)::int FROM noeud WHERE feux) AS feux,
           (SELECT count(*)::int FROM noeud WHERE pieton IS NOT NULL) AS pieton,
           (SELECT count(*)::int FROM troncon WHERE highway IN ('cycleway', 'path')) AS cyclables
  `);
  return { voies_osm: voies.length, ...compte[0]!, carrefours: 0 };
}
