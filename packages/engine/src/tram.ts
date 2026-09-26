/**
 * Position estimée d'un tram entre deux arrêts.
 *
 * Ginko ne publie pas la position GPS des rames, seulement l'heure d'arrivée prévue à chacun
 * des arrêts restants de la course. Entre l'arrêt précédent et le suivant, on suppose que la
 * rame roule à la vitesse moyenne du tronçon : elle se trouve donc à `temps restant × vitesse`
 * avant l'arrêt suivant. La durée prévue du tronçon comprend l'arrêt en station au départ
 * (Ginko donne la même heure d'arrivée et de départ) : on la retire pour obtenir la vitesse
 * de roulage, et la rame reste à quai tant que le temps restant dépasse le temps de roulage.
 *
 * La zone d'incertitude combine deux marges :
 * - sur le temps restant : la prévision elle-même, d'autant moins sûre que l'arrivée est loin,
 *   plus l'âge de la donnée (la prévision a pu bouger depuis) ;
 * - sur la vitesse : la rame ne roule pas à vitesse constante (démarrage, feux, freinage).
 * Elle reste bornée au tronçon : la rame a quitté l'arrêt précédent (le flux ne le liste
 * plus) et n'a pas dépassé le suivant.
 */

/** Valeurs indicatives, à recaler en comparant les prévisions successives du flux. */
export const PARAMETRES_TRAM = {
  /** Arrêt en station compris dans la durée d'un tronçon, en s (plafonné à la moitié). */
  tempsArret: 15,
  /** Incertitude plancher sur le temps restant, en s. */
  incertitudeMin: 10,
  /** Part du temps restant ajoutée à l'incertitude. */
  incertitudeRelative: 0.15,
  /** Incertitude ajoutée par seconde d'âge de la donnée. */
  incertitudeParSecondeDAge: 0.2,
  /** Écart relatif admis autour de la vitesse moyenne du tronçon. */
  ecartVitesse: 0.2,
} as const;

export interface TronconTram {
  /** Longueur du tracé entre les deux arrêts, en m. */
  longueur: number;
  /** Durée de parcours prévue de l'arrêt précédent au suivant, en s. */
  duree: number;
}

export interface PositionTram {
  /** Distance estimée depuis l'arrêt précédent, en m. */
  distance: number;
  /** Bornes de la zone où la rame peut se trouver, en m depuis l'arrêt précédent. */
  distanceMin: number;
  distanceMax: number;
  /** Vitesse moyenne de roulage sur le tronçon, arrêt en station exclu, en m/s. */
  vitesse: number;
  /**
   * Rame à quai : à l'arrêt précédent pendant l'arrêt en station, ou à l'arrêt suivant une fois
   * l'arrivée prévue passée (en attendant la prévision suivante du flux).
   */
  aQuai?: 'precedent' | 'suivant';
  /** Pour une rame à quai à l'arrêt précédent : temps avant son départ, en s. */
  departDans?: number;
}

/**
 * @param restant temps avant l'arrivée prévue à l'arrêt suivant, en s (négatif si dépassée)
 * @param age âge de la prévision, en s
 */
export function estimerPositionTram(
  { longueur, duree }: TronconTram,
  restant: number,
  age = 0,
  parametres: typeof PARAMETRES_TRAM = PARAMETRES_TRAM,
): PositionTram {
  if (longueur < 0 || duree <= 0) throw new RangeError('Tronçon invalide');
  const roulage = duree - Math.min(parametres.tempsArret, duree / 2);
  const vitesse = longueur / roulage;
  const borner = (d: number) => Math.min(Math.max(d, 0), longueur);
  const avant = Math.max(restant, 0);
  const incertitude =
    Math.max(parametres.incertitudeMin, parametres.incertitudeRelative * avant) +
    parametres.incertitudeParSecondeDAge * Math.max(age, 0);

  return {
    distance: borner(longueur - avant * vitesse),
    // Au plus loin de l'arrêt suivant : arrivée plus tardive et rame plus rapide.
    distanceMin: borner(longueur - (avant + incertitude) * vitesse * (1 + parametres.ecartVitesse)),
    // Au plus près : arrivée plus tôt et rame plus lente.
    distanceMax: borner(
      longueur - Math.max(avant - incertitude, 0) * vitesse * (1 - parametres.ecartVitesse),
    ),
    vitesse,
    ...(restant <= 0
      ? { aQuai: 'suivant' as const }
      : avant >= roulage
        ? { aQuai: 'precedent' as const, departDans: avant - roulage }
        : {}),
  };
}

/** Lissage de l'affichage des rames entre deux images. */
export const LISSAGE_TRAM = {
  /** Temps caractéristique du rattrapage de la position estimée, en s. */
  constanteTemps: 0.6,
  /** En deçà de cet écart (m), une rame en avance attend sur place au lieu de reculer. */
  reculMax: 150,
  /** Au-delà de cet écart (m), la rame est replacée d'un coup (donnée manquée, onglet masqué). */
  sautMax: 800,
} as const;

/**
 * Distance à afficher le long du tracé, à partir de celle affichée à l'image précédente et de
 * la position estimée. Quand une nouvelle prévision déplace brusquement l'estimation, la rame
 * la rejoint en glissant le long de la voie (rattrapage exponentiel) plutôt que de sauter.
 * Une rame ne recule pas : si l'estimation est un peu en arrière, elle attend qu'elle la rattrape.
 *
 * @param affichee distance affichée à l'image précédente, `undefined` pour une nouvelle rame
 * @param dt temps écoulé depuis l'image précédente, en s
 */
export function lisserDistance(
  affichee: number | undefined,
  cible: number,
  dt: number,
  parametres: typeof LISSAGE_TRAM = LISSAGE_TRAM,
): number {
  if (affichee === undefined || Math.abs(cible - affichee) > parametres.sautMax) return cible;
  const suivie = affichee + (cible - affichee) * (1 - Math.exp(-Math.max(dt, 0) / parametres.constanteTemps));
  if (suivie < affichee && affichee - cible <= parametres.reculMax) return affichee;
  return suivie;
}
