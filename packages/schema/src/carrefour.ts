import { z } from 'zod';
import { NatureCarrefour, StatutCarrefour } from './feux.js';

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
  nature: NatureCarrefour,
  pres_tram: z.boolean(),
  nb_feux: z.number().int(),
});
export type CarrefourResume = z.infer<typeof CarrefourResume>;

/** Composition manuelle d'un carrefour : les feux qui partagent une même programmation. */
export const CreerCarrefour = z.object({
  nom: z.string().trim().min(1).max(200).optional(),
  nature: NatureCarrefour.default('carrefour'),
  feux: z.array(z.uuid()).min(1).max(80),
});
export type CreerCarrefour = z.infer<typeof CreerCarrefour>;

export const ModifierCarrefour = z
  .object({
    nom: z.string().trim().min(1).max(200),
    nature: NatureCarrefour,
    feux: z.array(z.uuid()).min(1).max(80),
  })
  .partial()
  .refine((m) => Object.keys(m).length > 0, { message: 'Rien à modifier' });
export type ModifierCarrefour = z.infer<typeof ModifierCarrefour>;

export const TypeFeu = z.enum(['vehicule', 'pieton']);
export type TypeFeu = z.infer<typeof TypeFeu>;

export type FeuResume = {
  id: string;
  osm_id: number | null;
  type: TypeFeu;
  carrefour_id: string | null;
  present_osm: boolean;
};

export interface PointGeoJson {
  type: 'Point';
  coordinates: [number, number];
}

export interface CollectionPoints<P> {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    id: string;
    geometry: PointGeoJson;
    properties: P;
  }>;
}

export type CarrefoursGeoJson = CollectionPoints<CarrefourResume>;
export type FeuxGeoJson = CollectionPoints<FeuResume>;
