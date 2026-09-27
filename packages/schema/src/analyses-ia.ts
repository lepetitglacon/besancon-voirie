import { z } from 'zod';
import type { DetectionBranchesIa } from './branches.js';
import type { CarrefourResume } from './carrefour.js';

export const StatutAnalyseIa = z.enum(['en_attente', 'en_cours', 'terminee', 'echec']);
export type StatutAnalyseIa = z.infer<typeof StatutAnalyseIa>;

/** Bornes (m) de chaque côté de la zone dessinée pour la photo envoyée à l'IA. */
export const COTE_PHOTO_IA_MIN_M = 40;
export const COTE_PHOTO_IA_MAX_M = 400;

/** Zone [ouest, sud, est, nord] en lon/lat. */
export const EmpriseIa = z
  .tuple([z.number().min(-180).max(180), z.number().min(-85).max(85), z.number().min(-180).max(180), z.number().min(-85).max(85)])
  .refine(([ouest, sud, est, nord]) => ouest < est && sud < nord, 'Emprise attendue : [ouest, sud, est, nord]');
export type EmpriseIa = z.infer<typeof EmpriseIa>;

/** Demande d'analyse : sans `emprise`, le cadre de la photo est calculé d'après les feux. */
export const DemandeAnalyseIa = z.object({ emprise: EmpriseIa.optional() }).optional();
export type DemandeAnalyseIa = z.infer<typeof DemandeAnalyseIa>;

/** Cadre de l'orthophoto envoyée à l'IA, nord en haut. */
export interface CadrePhotoIa {
  emprise: EmpriseIa;
  /** Dimensions au sol (m). */
  largeur_m: number;
  hauteur_m: number;
  /** Dimensions de l'image (px). */
  largeur_px: number;
  hauteur_px: number;
  metres_par_px: number;
}

/** Une demande « OSM + IA » dans la file, sans sa proposition. */
export interface AnalyseIa {
  id: string;
  statut: StatutAnalyseIa;
  carrefour: CarrefourResume;
  /** Centre du carrefour, pour y recentrer la carte. */
  position: [number, number];
  /** Place dans la file (1 = la prochaine lancée), pour une analyse en attente. */
  rang: number | null;
  /** Zone de la photo dessinée sur la carte ; null : cadre calculé d'après les feux. */
  emprise: EmpriseIa | null;
  erreur: string | null;
  demandee_le: string;
  commencee_le: string | null;
  finie_le: string | null;
  /** Proposition chargée dans l'éditeur : plus de notification. */
  consultee_le: string | null;
}

export interface AnalyseIaDetail extends AnalyseIa {
  resultat: DetectionBranchesIa | null;
}
