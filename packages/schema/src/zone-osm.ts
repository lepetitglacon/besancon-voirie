import { z } from 'zod';
import { LonLat } from './branches.js';

/**
 * Zone d'import OSM de l'instance — docs/ARCHITECTURE.md §5. Les feux importés sont ceux
 * qu'elle contient ; les voies et le tram sont téléchargés sur son emprise, un peu élargie.
 * Un ou plusieurs polygones, chacun donné par son contour extérieur (sans trou), en [lon, lat].
 */
export const PolygonesZone = z.array(z.array(LonLat).min(3).max(3000)).min(1).max(20);
export type PolygonesZone = z.infer<typeof PolygonesZone>;

/** D'où vient la zone : un contour administratif d'OSM (retouché ou non), ou un tracé à la main. */
export const SourceZoneOsm = z.object({
  contour: z.object({ osm_id: z.number().int(), nom: z.string() }).nullable(),
  retouchee: z.boolean(),
});
export type SourceZoneOsm = z.infer<typeof SourceZoneOsm>;

export const EnregistrementZoneOsm = z.object({ polygones: PolygonesZone, source: SourceZoneOsm });
export type EnregistrementZoneOsm = z.infer<typeof EnregistrementZoneOsm>;

export const StatutImportOsm = z.enum(['inactif', 'telechargement', 'chargement', 'termine', 'echec']);

export type StatutImportOsm = z.infer<typeof StatutImportOsm>;

/** Import lancé depuis l'application : un seul à la fois. */
export interface ImportOsm {
  statut: StatutImportOsm;
  debut: string | null;
  fin: string | null;
  erreur: string | null;
  bilan: {
    signaux: number;
    voies: number;
    trams: number;
    feux: { presents: number; nouveaux: number; disparus: number };
  } | null;
}

export interface ZoneOsm {
  /** null : aucune zone enregistrée, l'import retient la commune de Besançon. */
  polygones: PolygonesZone | null;
  source: SourceZoneOsm | null;
  modifiee_le: string | null;
  superficie_km2: number | null;
  /** Zone du dernier import (zone enregistrée alors, ou commune de Besançon), simplifiée pour l'affichage. */
  zone_importee: { nom: string; polygones: PolygonesZone; superficie_km2: number } | null;
  /** Dernier import des données OSM (script ou application). */
  dernier_import: { importe_le: string | null; donnees_du: string | null } | null;
  /** Feux présents dans OSM lors du dernier import, et feux rattachés à un carrefour. */
  feux: { presents: number; absents: number; rattaches: number };
  import: ImportOsm;
}

/** Contour administratif d'OSM qui contient un point : commune, intercommunalité, département… */
export interface ContourOsm {
  osm_id: number;
  nom: string;
  /** « Commune », « Intercommunalité »… */
  nature: string;
  admin_level: number | null;
}
