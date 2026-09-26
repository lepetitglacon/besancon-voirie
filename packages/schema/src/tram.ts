import { z } from 'zod';

/** Arrêt d'un parcours de tram, repéré par sa distance le long du tracé. */
export interface ArretTram {
  id: string;
  nom: string;
  /** Distance depuis le début du tracé, en m. */
  distance: number;
  coordonnees: [number, number];
}

/** Une ligne de tram dans un sens (GTFS Ginko : route + direction). */
export interface ParcoursTram {
  /** `<route_id>-<direction_id>`, ex. `101-0`. */
  id: string;
  /** Nom public : T1, T2. */
  ligne: string;
  /** Couleurs de la ligne, en `#rrggbb`. */
  couleur: string;
  couleurTexte: string;
  destination: string;
  coordonnees: Array<[number, number]>;
  arrets: ArretTram[];
}

export interface ReseauTram {
  parcours: ParcoursTram[];
  /** Date de publication du GTFS statique (AAAAMMJJ). */
  version: string;
}

/**
 * `en_ligne` : entre deux arrêts. `au_terminus` : en attente du départ de sa prochaine course,
 * posé sur le premier arrêt.
 */
export type EtatTram = 'en_ligne' | 'au_terminus';

/** Dernier état connu d'une rame. La position se calcule à l'instant voulu (engine). */
export interface TramEnCirculation {
  /** Numéro SAE de la rame, ou identifiant de course à défaut. */
  vehicule: string;
  course: string;
  parcours: string;
  etat: EtatTram;
  arretPrecedent: string | null;
  arretSuivant: string;
  /** Tronçon en cours, en m le long du tracé du parcours. */
  debut: number;
  fin: number;
  /** Durée de parcours prévue du tronçon, en s. */
  duree: number;
  /** D'où vient `duree` : passages observés, prévisions du flux, ou horaires théoriques. */
  sourceDuree: 'historique' | 'flux' | 'theorique';
  /** Pour `historique` : nombre de passages observés sur le créneau. */
  echantillons?: number;
  /** Pour `historique` : durées quand ça roule bien (p10) et quand ça bloque (p90), en s. */
  dureeRapide?: number;
  dureeLente?: number;
  /** Arrivée prévue à l'arrêt suivant (départ du terminus pour `au_terminus`), en ms epoch. */
  arrivee: number;
}

/**
 * Erreur des prévisions Ginko selon leur avance : [horizon (s), erreur (s)], horizons croissants.
 * L'erreur est le 80e centile de l'écart entre l'heure prévue à cet horizon et le passage.
 */
export type CalibrationPrevision = Array<[number, number]>;

export interface TramsTempsReel {
  /** Instant de production du flux GTFS-RT, en ms epoch. */
  horodatage: number;
  trams: TramEnCirculation[];
  /** Absente tant que l'historique est trop maigre. */
  calibration?: CalibrationPrevision;
}

export const TypeJour = z.enum(['semaine', 'samedi', 'dimanche']);
export type TypeJour = z.infer<typeof TypeJour>;

/** Paramètres de `GET /api/tram/historique/troncons`. Sans `typeJour`, celui du jour. */
export const HistoriqueTronconsQuery = z.object({
  typeJour: TypeJour.optional(),
  /** Heure locale 0-23 ; absente : toute la journée. */
  heure: z.coerce.number().int().min(0).max(23).optional(),
  jours: z.coerce.number().int().min(1).max(365).default(28),
});
export type HistoriqueTronconsQuery = z.infer<typeof HistoriqueTronconsQuery>;

/** État de la collecte des passages. */
export interface EtatHistoriqueTram {
  collecteActive: boolean;
  passages: number;
  premier: string | null;
  dernier: string | null;
}

/** Durées observées d'un tronçon sur un créneau, en s. */
export interface TronconObserve {
  parcours: string;
  depart: string;
  arrivee: string;
  /** Nombre de passages observés. */
  n: number;
  p10: number;
  p50: number;
  p90: number;
  /** p10 toutes heures confondues (même type de jour) : le tronçon quand ça roule bien. */
  reference: number;
}

export interface HistoriqueTroncons {
  typeJour: TypeJour;
  /** Heure locale (0-23), ou `null` pour toute la journée. */
  heure: number | null;
  /** Profondeur de l'historique, en jours. */
  jours: number;
  troncons: TronconObserve[];
}
