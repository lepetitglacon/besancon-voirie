import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Bbox, FeuResume, FeuxGeoJson, PlacementFeu, PointGeoJson } from '@voirie/schema';
import { recalculerCarrefour } from '../carrefours/positions.js';
import { DRIZZLE, type Db } from '../db/db.module.js';
import type { Executeur } from '../db/sql.js';

/** Un feu se place sur son mât, à quelques mètres du point OSM : au-delà, c'est une erreur. */
const ECART_OSM_MAX_M = 50;

type LigneFeu = FeuResume & { geometry: PointGeoJson };
type FeatureFeu = FeuxGeoJson['features'][number];

const COLONNES_FEU = sql`
  id, osm_id::float8 AS osm_id, type, carrefour_id, present_osm, position_manuelle,
  ST_X(geom_osm) AS osm_lon, ST_Y(geom_osm) AS osm_lat, ST_AsGeoJSON(geom)::json AS geometry`;

const enFeature = ({ geometry, ...properties }: LigneFeu): FeatureFeu => ({
  type: 'Feature',
  id: properties.id,
  geometry,
  properties,
});

@Injectable()
export class FeuxService {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  /** Feux contenus dans l'emprise de la carte, au format GeoJSON. */
  async dansEmprise([minLon, minLat, maxLon, maxLat]: Bbox): Promise<FeuxGeoJson> {
    const { rows } = await this.db.execute<LigneFeu>(sql`
      SELECT ${COLONNES_FEU}
      FROM feu
      WHERE geom && ST_MakeEnvelope(${minLon}, ${minLat}, ${maxLon}, ${maxLat}, 4326)
      LIMIT 5000
    `);
    return { type: 'FeatureCollection', features: rows.map(enFeature) };
  }

  /**
   * Place le feu sur son mât (position vue sur la photo), ou le remet à sa position OSM. La
   * position OSM reste connue dans les deux cas ; le centre de son carrefour est recalculé.
   */
  async placer(id: string, { position }: PlacementFeu): Promise<FeatureFeu> {
    return this.db.transaction(async (tx) => {
      const { rows } = await tx.execute<{ carrefour_id: string | null; osm: boolean; ecart_m: number | null }>(sql`
        SELECT carrefour_id, geom_osm IS NOT NULL AS osm,
               ST_Distance(geom_osm::geography,
                           ST_SetSRID(ST_MakePoint(${position?.[0] ?? null}::float8, ${position?.[1] ?? null}::float8), 4326)::geography
               ) AS ecart_m
        FROM feu WHERE id = ${id} FOR UPDATE
      `);
      const feu = rows[0];
      if (!feu) throw new NotFoundException('Feu inconnu');

      if (position) {
        if (feu.ecart_m !== null && feu.ecart_m > ECART_OSM_MAX_M) {
          throw new BadRequestException(`Un feu se place à moins de ${ECART_OSM_MAX_M} m de sa position OSM`);
        }
        await tx.execute(sql`
          UPDATE feu SET geom = ST_SetSRID(ST_MakePoint(${position[0]}, ${position[1]}), 4326), position_manuelle = true
          WHERE id = ${id}
        `);
      } else {
        if (!feu.osm) throw new ConflictException("Ce feu n'a pas de position OSM");
        await tx.execute(sql`UPDATE feu SET geom = geom_osm, position_manuelle = false WHERE id = ${id}`);
      }
      if (feu.carrefour_id) await recalculerCarrefour(tx, feu.carrefour_id);
      return this.lire(tx, id);
    });
  }

  private async lire(db: Executeur, id: string): Promise<FeatureFeu> {
    const { rows } = await db.execute<LigneFeu>(sql`SELECT ${COLONNES_FEU} FROM feu WHERE id = ${id}`);
    return enFeature(rows[0]!);
  }
}
