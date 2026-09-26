/**
 * Position d'un carrefour, déduite de ses feux. Partagé entre la composition des carrefours et
 * le placement des feux sur la photo.
 */
import { sql } from 'drizzle-orm';
import { tableExiste, type Executeur } from '../db/sql.js';

/** Un carrefour à moins de cette distance d'une voie de tram est marqué `pres_tram`. */
const RAYON_TRAM_M = 25;

/** Position (centre des feux) et proximité du tram. */
export async function recalculerCarrefour(db: Executeur, id: string): Promise<void> {
  const presTram = (await tableExiste(db, 'osm_tram'))
    ? sql`EXISTS (SELECT 1 FROM osm_tram t WHERE ST_DWithin(t.geom::geography, f.centre::geography, ${RAYON_TRAM_M}))`
    : sql`false`;
  await db.execute(sql`
    UPDATE carrefour c SET geom = f.centre, pres_tram = ${presTram}
    FROM (SELECT ST_Centroid(ST_Collect(geom)) AS centre FROM feu WHERE carrefour_id = ${id}) f
    WHERE c.id = ${id} AND f.centre IS NOT NULL
  `);
}
