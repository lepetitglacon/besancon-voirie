import { z } from 'zod';
import { CodeLigne, type Controleur, type IntervalleVert, type Plage } from './feux.js';

/**
 * Tops relevés sur place : instants où une ligne de feux passe au vert. Ce sont des
 * observations brutes, rattachées au plan en vigueur à l'instant du top quand on calcule le
 * décalage (docs/ARCHITECTURE.md §6.1).
 */
export const AjoutTops = z.object({
  ligne: CodeLigne,
  instants: z.array(z.iso.datetime({ offset: true, precision: 3 })).min(1).max(200),
});
export type AjoutTops = z.infer<typeof AjoutTops>;

export interface TopSynchro {
  id: string;
  ligne: string;
  instant: string;
  /** Plan en vigueur à l'instant du top, null si aucun. */
  plan: string | null;
  /** Décalage que donne ce top pour son plan, null si le plan ne met pas la ligne au vert. */
  decalage_s: number | null;
}

export type ConfianceSynchro = 'inconnue' | 'estimee' | 'synchronisee' | 'incoherente';

export interface SynchronisationPlan {
  decalage_s: number | null;
  confiance: ConfianceSynchro;
  tops: number;
  jours: number;
  ecart_s: number | null;
}

export interface TopsCarrefour {
  tops: TopSynchro[];
  /** Synchronisation de chaque plan à cycle, par code. */
  plans: Record<string, SynchronisationPlan>;
}

/** Plan tel que le mode Temps réel le rejoue. */
export interface PlanTempsReel {
  code: string;
  mode: 'cycle' | 'jaune_clignotant' | 'eteint';
  plages: Plage[];
  cycle_s: number | null;
  jaune_s: number | null;
  /** Diagramme de feux : intervalles de vert par ligne, dans [0, cycle]. */
  verts: Record<string, IntervalleVert[]> | null;
  /** Lignes au vert pendant la priorité tram (étape qui sert une ligne R17/R18), null sans étape tram. */
  etape_tram: string[] | null;
  synchro: SynchronisationPlan | null;
}

export interface CarrefourTempsReel {
  id: string;
  nom: string;
  position: [number, number];
  /** À moins de 25 m d'une voie de tram (OSM). */
  pres_tram: boolean;
  controleur: Pick<Controleur, 'mode' | 'priorite_tc'>;
  /**
   * Lignes de feux et où dessiner leur état : les feux physiques qui les affichent, sinon le bout
   * des voies entrantes qu'elles commandent (ou le milieu de la traversée pour les piétons).
   */
  lignes: Array<{
    code: string;
    pieton: boolean;
    /** Ligne de transports en commun (R17, R18) : au vert pendant la priorité tram. */
    tc: boolean;
    /** Ses trajectoires ou sa traversée coupent la voie de tram : au rouge pendant la priorité. */
    coupe_tram: boolean;
    positions: Array<[number, number]>;
  }>;
  plans: PlanTempsReel[];
}

export interface FeuxTempsReel {
  carrefours: CarrefourTempsReel[];
}
