import type { CarrefourResume } from './carrefour.js';
import type { Controleur, IntervalleVert, Plage, Signal } from './feux.js';
import type { ReleveResume } from './releve.js';
import type { SynchronisationPlan } from './temps-reel.js';

/**
 * Fiche publique d'un carrefour (`/carrefours/:slug`) : ce qui est saisi et ce qui en est calculé,
 * en un seul appel (docs/ARCHITECTURE.md §7.2).
 */
export interface FicheCarrefour {
  carrefour: CarrefourResume & {
    /** Centre du carrefour, [lon, lat]. */
    position: [number, number];
    controleur: Partial<Controleur>;
  };
  /** Rues du carrefour (les tronçons d'anneau d'un giratoire n'y sont pas). */
  branches: Array<{ code: string; nom: string | null; azimut: number; entrantes: number; sortantes: number; passages: number }>;
  lignes: Array<{ code: string; signal: Signal; mouvements: string[]; traverse: string | null; feux: number }>;
  plans: FichePlan[];
  /** Relevés terrain, hors rejetés, du plus récent au plus ancien. */
  releves: ReleveResume[];
}

export interface FichePlan {
  code: string;
  mode: 'cycle' | 'jaune_clignotant' | 'eteint';
  plages: Plage[];
  cycle_s: number | null;
  /** Diagramme calculé du plan à cycle ; null sans étapes. */
  diagramme: DiagrammeFeux | null;
  /** Calage sur l'heure réelle par les tops ; null hors plan à cycle. */
  synchro: SynchronisationPlan | null;
  /** Lignes qui appellent une étape (bouton, boucle) et lignes servies hors cycle (priorité). */
  appels: string[];
  priorites: string[];
}

/** Diagramme de feux d'un plan : étapes, transitions, verts et jaunes de chaque ligne sur un cycle. */
export interface DiagrammeFeux {
  cycle_s: number;
  etapes: Array<{ index: number; lignes: string[]; debut_s: number; fin_s: number }>;
  transitions: Array<{ debut_s: number; duree_s: number }>;
  verts: Record<string, IntervalleVert[]>;
  jaunes: Record<string, IntervalleVert[]>;
}
