import { z } from 'zod';
import { StatutCarrefour } from './feux.js';

/** Emprise de la carte : minLon, minLat, maxLon, maxLat (WGS84). */
export const Bbox = z
  .tuple([
    z.number().min(-180).max(180),
    z.number().min(-90).max(90),
    z.number().min(-180).max(180),
    z.number().min(-90).max(90),
  ])
  .refine(([minLon, minLat, maxLon, maxLat]) => minLon < maxLon && minLat < maxLat, {
    message: 'Emprise invalide',
  });
export type Bbox = z.infer<typeof Bbox>;

/** Paramètre de requête `bbox=minLon,minLat,maxLon,maxLat`. */
export const BboxQuery = z
  .string()
  .transform((valeur) => valeur.split(',').map(Number))
  .pipe(Bbox);

/** Propriétés d'un carrefour telles qu'affichées sur la carte. */
export const CarrefourResume = z.object({
  id: z.uuid(),
  slug: z.string(),
  nom: z.string(),
  statut: StatutCarrefour,
  pres_tram: z.boolean(),
});
export type CarrefourResume = z.infer<typeof CarrefourResume>;

export interface PointGeoJson {
  type: 'Point';
  coordinates: [number, number];
}

export interface CarrefoursGeoJson {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    id: string;
    geometry: PointGeoJson;
    properties: CarrefourResume;
  }>;
}
