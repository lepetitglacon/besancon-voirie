/**
 * Voies OSM chargées à la demande, autour d'un carrefour — docs/ARCHITECTURE.md §5. L'import de
 * la zone ne prend que les feux ; la détection des branches, la lecture IA, la suggestion de nom
 * et la proximité du tram demandent les voies (et le tram) autour du point qui les intéresse.
 * Ce qui est chargé reste en base (`osm_way`, `osm_tram`) avec l'emprise couverte
 * (`osm_voies_chargees`) : une zone déjà couverte n'est pas redemandée.
 */
import { ServiceUnavailableException } from '@nestjs/common';
import { HIERARCHIE_VOIES } from '@voirie/engine';
import { sql } from 'drizzle-orm';
import type { Executeur } from '../db/sql.js';
import { DDL_VOIES, telechargerOverpass } from './import-osm.js';

type LonLat = [number, number];

/** Une demande charge au moins ce rayon (m) : les carrefours voisins en profitent. */
const RAYON_CHARGE_MIN_M = 300;
/** Requête légère : un miroir lent est abandonné au profit du suivant. */
const DELAI_MS = 90_000;

/** Tables des voies, créées au besoin (DDL_VOIES). */
export async function creerTablesVoies(db: Executeur): Promise<void> {
  await db.execute(sql.raw(DDL_VOIES));
}

/** Les voies sont-elles déjà chargées sur tout le cercle ? */
async function couvert(db: Executeur, [lon, lat]: LonLat, rayonM: number): Promise<boolean> {
  const { rows } = await db.execute<{ couvert: boolean }>(sql`
    WITH cercle AS (SELECT ST_Buffer(ST_SetSRID(ST_MakePoint(${lon}::float8, ${lat}::float8), 4326)::geography, ${rayonM}::float8)::geometry AS geom)
    SELECT coalesce(ST_Covers(ST_Union(v.geom), (SELECT geom FROM cercle)), false) AS couvert
    FROM osm_voies_chargees v, cercle WHERE ST_Intersects(v.geom, cercle.geom)
  `);
  return rows[0]?.couvert ?? false;
}

/**
 * Charge depuis Overpass les voies circulables et le tram autour du point, s'ils ne le sont pas
 * déjà. `exiger` : une erreur d'Overpass remonte (503) ; sinon on se contente de ce qui est en base.
 */
export async function assurerVoies(db: Executeur, centre: LonLat, rayonM: number, { exiger = true } = {}): Promise<void> {
  await creerTablesVoies(db);
  // Coupé par OSM_VOIES_A_LA_DEMANDE=false (tests : les jeux de test fournissent les voies).
  if (process.env.OSM_VOIES_A_LA_DEMANDE === 'false') return;
  if (await couvert(db, centre, rayonM)) return;
  const [lon, lat] = centre;
  const rayon = Math.ceil(Math.max(rayonM, RAYON_CHARGE_MIN_M));
  const autour = `(around:${rayon},${lat},${lon})`;
  let elements;
  try {
    ({ elements } = await telechargerOverpass(
      `[out:json][timeout:60];
(
  way${autour}["highway"~"^(${HIERARCHIE_VOIES.join('|')})(_link)?$"];
  way${autour}["railway"="tram"];
);
out body geom;`,
      DELAI_MS,
    ));
  } catch (erreur) {
    if (exiger) throw new ServiceUnavailableException(`Voies OSM indisponibles autour du carrefour : ${(erreur as Error).message}`);
    return;
  }
  const lignes = elements.flatMap((e) =>
    e.type === 'way' && e.geometry?.length >= 2
      ? [{ id: e.id, tags: e.tags ?? {}, nodes: e.nodes, geom: JSON.stringify({ type: 'LineString', coordinates: e.geometry.map((g) => [g.lon, g.lat]) }) }]
      : [],
  );
  for (const [table, garder] of [
    ['osm_way', (t: Record<string, string>) => t.railway !== 'tram'],
    ['osm_tram', (t: Record<string, string>) => t.railway === 'tram'],
  ] as const) {
    const choisies = lignes.filter((l) => garder(l.tags));
    if (choisies.length === 0) continue;
    await db.execute(sql`
      INSERT INTO ${sql.identifier(table)} (osm_id, tags, nodes, geom)
      SELECT (e->>'id')::bigint, e->'tags', ARRAY(SELECT jsonb_array_elements_text(e->'nodes')::bigint),
             ST_SetSRID(ST_GeomFromGeoJSON(e->>'geom'), 4326)
      FROM jsonb_array_elements(${JSON.stringify(choisies)}::jsonb) e
      ON CONFLICT (osm_id) DO UPDATE SET tags = EXCLUDED.tags, nodes = EXCLUDED.nodes, geom = EXCLUDED.geom
    `);
  }
  await db.execute(sql`
    INSERT INTO osm_voies_chargees (geom)
    VALUES (ST_Buffer(ST_SetSRID(ST_MakePoint(${lon}::float8, ${lat}::float8), 4326)::geography, ${rayon}::float8, 16)::geometry)
  `);
}
