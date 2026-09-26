import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Bbox, CarrefourResume, CarrefoursGeoJson, PointGeoJson } from '@voirie/schema';
import { DRIZZLE, type Db } from '../db/db.module.js';
import { carrefour } from '../db/schema.js';

const LIMITE_CARREFOURS = 2000;

@Injectable()
export class CarrefoursService {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  /** Carrefours contenus dans l'emprise de la carte, au format GeoJSON. */
  async dansEmprise([minLon, minLat, maxLon, maxLat]: Bbox): Promise<CarrefoursGeoJson> {
    const { rows } = await this.db.execute<CarrefourResume & { geometry: PointGeoJson }>(sql`
      SELECT id, slug, nom, statut, pres_tram, ST_AsGeoJSON(geom)::json AS geometry
      FROM ${carrefour}
      WHERE geom && ST_MakeEnvelope(${minLon}, ${minLat}, ${maxLon}, ${maxLat}, 4326)
      ORDER BY nom
      LIMIT ${LIMITE_CARREFOURS}
    `);

    return {
      type: 'FeatureCollection',
      features: rows.map(({ geometry, ...properties }) => ({
        type: 'Feature',
        id: properties.id,
        geometry,
        properties,
      })),
    };
  }
}
