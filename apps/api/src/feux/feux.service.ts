import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Bbox, FeuResume, FeuxGeoJson, PointGeoJson } from '@voirie/schema';
import { DRIZZLE, type Db } from '../db/db.module.js';

@Injectable()
export class FeuxService {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  /** Feux contenus dans l'emprise de la carte, au format GeoJSON. */
  async dansEmprise([minLon, minLat, maxLon, maxLat]: Bbox): Promise<FeuxGeoJson> {
    const { rows } = await this.db.execute<FeuResume & { geometry: PointGeoJson }>(sql`
      SELECT id, osm_id::float8 AS osm_id, type, carrefour_id, present_osm, ST_AsGeoJSON(geom)::json AS geometry
      FROM feu
      WHERE geom && ST_MakeEnvelope(${minLon}, ${minLat}, ${maxLon}, ${maxLat}, 4326)
      LIMIT 5000
    `);
    return {
      type: 'FeatureCollection',
      features: rows.map(({ geometry, ...properties }) => ({ type: 'Feature', id: properties.id, geometry, properties })),
    };
  }
}
