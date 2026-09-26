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
  /** Arrivée prévue à l'arrêt suivant (départ du terminus pour `au_terminus`), en ms epoch. */
  arrivee: number;
}

export interface TramsTempsReel {
  /** Instant de production du flux GTFS-RT, en ms epoch. */
  horodatage: number;
  trams: TramEnCirculation[];
}
