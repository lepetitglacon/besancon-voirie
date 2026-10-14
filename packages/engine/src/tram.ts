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

/**
 * Valeurs de repli, utilisées tant que l'historique des passages ne fournit pas mieux :
 * la dispersion des durées observées remplace `ecartVitesse`, la calibration des prévisions
 * remplace les trois `incertitude*` sur le temps restant.
 */
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
  /** Plancher de l'incertitude calibrée, en s (latence du flux). */
  incertitudePlancher: 5,
} as const;

/**
 * Bus : pas d'historique des passages, et une marche bien plus irrégulière que le tram (trafic,
 * feux sans priorité, arrêts à la demande). Les marges de repli sont donc plus larges.
 */
/** Réglages de l'estimation de position, tram ou bus. */
export type ParametresPosition = { readonly [K in keyof typeof PARAMETRES_TRAM]: number };

export const PARAMETRES_BUS: ParametresPosition = {
  tempsArret: 10,
  incertitudeMin: 20,
  incertitudeRelative: 0.3,
  incertitudeParSecondeDAge: 0.3,
  ecartVitesse: 0.4,
  incertitudePlancher: 10,
};

export interface TronconTram {
  /** Longueur du tracé entre les deux arrêts, en m. */
  longueur: number;
  /** Durée de parcours prévue de l'arrêt précédent au suivant, en s. */
  duree: number;
  /** Durées observées quand ça roule bien et quand ça bloque (p10 et p90), en s. */
  dureeRapide?: number;
  dureeLente?: number;
}

/** Erreur des prévisions selon leur avance : [horizon (s), erreur (s)], horizons croissants. */
export type CalibrationPrevision = Array<[number, number]>;

/** Erreur attendue d'une prévision faite `avant` secondes à l'avance (interpolation linéaire). */
export function erreurPrevision(calibration: CalibrationPrevision, avant: number): number {
  const [premier] = calibration;
  if (!premier) throw new RangeError('Calibration vide');
  if (avant <= premier[0]) return premier[1];
  for (let i = 1; i < calibration.length; i++) {
    const [h0, e0] = calibration[i - 1]!;
    const [h1, e1] = calibration[i]!;
    if (avant <= h1) return e0 + ((e1 - e0) * (avant - h0)) / (h1 - h0);
  }
  return calibration[calibration.length - 1]![1];
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
 * @param calibration erreur observée des prévisions Ginko ; à défaut, marges de repli
 */
export function estimerPositionTram(
  { longueur, duree, dureeRapide, dureeLente }: TronconTram,
  restant: number,
  age = 0,
  calibration?: CalibrationPrevision,
  parametres: ParametresPosition = PARAMETRES_TRAM,
): PositionTram {
  if (longueur < 0 || duree <= 0) throw new RangeError('Tronçon invalide');
  const roulage = (d: number) => d - Math.min(parametres.tempsArret, d / 2);
  const vitesse = longueur / roulage(duree);
  // Plage de vitesses : observée si l'historique la donne, sinon ± ecartVitesse.
  const vitesseMax =
    dureeRapide && dureeRapide > 0
      ? Math.max(longueur / roulage(dureeRapide), vitesse)
      : vitesse * (1 + parametres.ecartVitesse);
  const vitesseMin =
    dureeLente && dureeLente > 0
      ? Math.min(longueur / roulage(dureeLente), vitesse)
      : vitesse * (1 - parametres.ecartVitesse);
  const borner = (d: number) => Math.min(Math.max(d, 0), longueur);
  const avant = Math.max(restant, 0);
  const incertitude =
    (calibration?.length
      ? Math.max(erreurPrevision(calibration, avant), parametres.incertitudePlancher)
      : Math.max(parametres.incertitudeMin, parametres.incertitudeRelative * avant)) +
    parametres.incertitudeParSecondeDAge * Math.max(age, 0);

  return {
    distance: borner(longueur - avant * vitesse),
    // Au plus loin de l'arrêt suivant : arrivée plus tardive et rame plus rapide.
    distanceMin: borner(longueur - (avant + incertitude) * vitesseMax),
    // Au plus près : arrivée plus tôt et rame plus lente.
    distanceMax: borner(longueur - Math.max(avant - incertitude, 0) * vitesseMin),
    vitesse,
    ...(restant <= 0
      ? { aQuai: 'suivant' as const }
      : avant >= roulage(duree)
        ? { aQuai: 'precedent' as const, departDans: avant - roulage(duree) }
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
