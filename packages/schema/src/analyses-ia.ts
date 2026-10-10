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
  /** Proposition retenue : celle du premier modèle d'IA_MODELES qui a réussi. */
  resultat: DetectionBranchesIa | null;
  /** Un essai par modèle lancé, dans l'ordre d'IA_MODELES, pour comparer. */
  essais: EssaiIa[];
}

/** `delai` : le modèle n'a pas répondu dans IA_DELAI_S. */
export const StatutEssaiIa = z.enum(['terminee', 'echec', 'delai']);
export type StatutEssaiIa = z.infer<typeof StatutEssaiIa>;

/** Un modèle lancé sur la photo d'une analyse, sans sa proposition. */
export interface EssaiIa {
  id: string;
  analyse_id: string | null;
  carrefour_id: string;
  /** Modèle demandé (alias d'IA_MODELES). */
  modele: string;
  /** Modèle qui a répondu (nom complet). */
  modele_reel: string | null;
  effort: string;
  statut: StatutEssaiIa;
  duree_s: number;
  cout_usd: number | null;
  tokens_entree: number | null;
  tokens_sortie: number | null;
  erreur: string | null;
  /** Photo, consigne et sortie brute gardées sur le serveur (IA_GARDER_FICHIERS=true). */
  dossier: string | null;
  cree_le: string;
}

export interface EssaiIaDetail extends EssaiIa {
  resultat: DetectionBranchesIa | null;
}
