import { z } from 'zod';
import type { DetectionBranchesIa } from './branches.js';
import type { CarrefourResume } from './carrefour.js';

export const StatutAnalyseIa = z.enum(['en_attente', 'en_cours', 'terminee', 'echec']);
export type StatutAnalyseIa = z.infer<typeof StatutAnalyseIa>;

/** Une demande « OSM + IA » dans la file, sans sa proposition. */
export interface AnalyseIa {
  id: string;
  statut: StatutAnalyseIa;
  carrefour: CarrefourResume;
  /** Centre du carrefour, pour y recentrer la carte. */
  position: [number, number];
  /** Place dans la file (1 = la prochaine lancée), pour une analyse en attente. */
  rang: number | null;
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
