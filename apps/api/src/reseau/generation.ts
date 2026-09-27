/**
 * Génération du réseau depuis les voies OSM importées (`osm_way`) — docs/RESEAU.md.
 *
 * Les tronçons OSM sont recréés à chaque génération, sauf ceux corrigés ou supprimés à la main
 * (`modifie`, `supprime`), reconnus par leur voie et leurs nœuds OSM d'origine. Les tronçons
 * tracés à la main ne sont jamais touchés.
 */
import { sql } from 'drizzle-orm';
import { VOIES_CIRCULABLES } from '../branches/branches.service.js';
import { tableExiste, type Executeur } from '../db/sql.js';
import { decouperVoies, type TronconOsm, type VoieOsm } from './osm.js';

export interface BilanReseau {
  voies_osm: number;
  noeuds: number;
  troncons: number;
  /** Tronçons OSM corrigés ou supprimés à la main, gardés tels quels. */
  conserves: number;
}

/** Au-delà, les insertions se font par paquets (taille des paramètres JSON). */
const PAQUET = 4000;

const cleOsm = (osmWayId: number, de: number, vers: number) => `${osmWayId}:${de}:${vers}`;

/** Voies OSM circulables (sans les aires ni les accès interdits), avec leurs nœuds et coordonnées. */
async function voiesOsm(db: Executeur): Promise<VoieOsm[]> {
  const { rows } = await db.execute<{ osm_id: string; tags: Record<string, string>; nodes: string[]; coords: Array<[number, number]> }>(sql`
    SELECT osm_id::text, tags, nodes::text[] AS nodes, (ST_AsGeoJSON(geom)::json)->'coordinates' AS coords
    FROM osm_way
    WHERE regexp_replace(tags->>'highway', '_link$', '') = ANY (${`{${VOIES_CIRCULABLES.join(',')}}`}::text[])
      AND coalesce(tags->>'area', 'no') <> 'yes'
      AND coalesce(tags->>'access', 'yes') <> 'no'
      AND coalesce(tags->>'motor_vehicle', 'yes') <> 'no'
  `);
  return rows.map((r) => ({ osm_id: Number(r.osm_id), tags: r.tags, nodes: r.nodes.map(Number), coords: r.coords }));
}

export async function genererReseau(db: Executeur): Promise<BilanReseau> {
  if (!(await tableExiste(db, 'osm_way'))) throw new Error('Tables OSM absentes : lancer `pnpm osm:import` avant');
  const voies = await voiesOsm(db);
  const { noeuds, troncons } = decouperVoies(voies);

  await db.execute(sql`DELETE FROM troncon WHERE source = 'osm' AND NOT modifie AND NOT supprime`);
  const { rows: gardes } = await db.execute<{ osm_way_id: string; osm_de: string; osm_vers: string }>(sql`
    SELECT DISTINCT osm_way_id::text, osm_de::text, osm_vers::text FROM troncon
    WHERE source = 'osm' AND osm_way_id IS NOT NULL AND osm_de IS NOT NULL AND osm_vers IS NOT NULL
  `);
  const conserves = new Set(gardes.map((g) => cleOsm(Number(g.osm_way_id), Number(g.osm_de), Number(g.osm_vers))));
  const nouveaux = troncons.filter((t) => !conserves.has(cleOsm(t.osm_way_id, t.de, t.vers)));

  const listeNoeuds = [...noeuds];
  for (let i = 0; i < listeNoeuds.length; i += PAQUET) {
    const paquet = listeNoeuds.slice(i, i + PAQUET).map(([id, [lon, lat]]) => ({ id, lon, lat }));
    await db.execute(sql`
      INSERT INTO noeud (osm_node_id, geom)
      SELECT (e->>'id')::bigint, ST_SetSRID(ST_MakePoint((e->>'lon')::float8, (e->>'lat')::float8), 4326)
      FROM jsonb_array_elements(${JSON.stringify(paquet)}::jsonb) e
      ON CONFLICT (osm_node_id) DO UPDATE SET geom = EXCLUDED.geom
    `);
  }

  for (let i = 0; i < nouveaux.length; i += PAQUET) {
    const paquet = nouveaux.slice(i, i + PAQUET).map((t: TronconOsm) => ({ ...t, geom: JSON.stringify({ type: 'LineString', coordinates: t.points }), points: undefined }));
    await db.execute(sql`
      INSERT INTO troncon (noeud_de, noeud_vers, geom, osm_way_id, osm_de, osm_vers, nom, highway, voies_avant, voies_arriere, vitesse_kmh, source)
      SELECT nd.id, nv.id, ST_SetSRID(ST_GeomFromGeoJSON(e->>'geom'), 4326),
             (e->>'osm_way_id')::bigint, (e->>'de')::bigint, (e->>'vers')::bigint, e->>'nom', e->>'highway',
             (e->>'voies_avant')::smallint, (e->>'voies_arriere')::smallint, (e->>'vitesse_kmh')::smallint, 'osm'
      FROM jsonb_array_elements(${JSON.stringify(paquet)}::jsonb) e
      JOIN noeud nd ON nd.osm_node_id = (e->>'de')::bigint
      JOIN noeud nv ON nv.osm_node_id = (e->>'vers')::bigint
      WHERE (e->>'voies_avant')::int + (e->>'voies_arriere')::int > 0
    `);
  }

  // Nœuds OSM qui ne portent plus aucun tronçon (voie disparue d'OSM).
  await db.execute(sql`
    DELETE FROM noeud n WHERE n.carrefour_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM troncon t WHERE t.noeud_de = n.id OR t.noeud_vers = n.id)
  `);

  const { rows: compte } = await db.execute<{ noeuds: number; troncons: number }>(sql`
    SELECT (SELECT count(*)::int FROM noeud) AS noeuds, (SELECT count(*)::int FROM troncon WHERE NOT supprime) AS troncons
  `);
  return {
    voies_osm: voies.length,
    noeuds: compte[0]!.noeuds,
    troncons: compte[0]!.troncons,
    conserves: gardes.length,
  };
}
