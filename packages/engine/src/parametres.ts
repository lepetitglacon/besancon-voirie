/**
 * Paramètres de référence CERTU, repris des valeurs par défaut de DiagFeux
 * (Diagfeux.par, PlanFeux.vb) — voir README, section DiagFeux.
 */
export const PARAMETRES_CERTU = {
  /** Débit de saturation par voie, en UVP/h. */
  debitSaturation: 1800,
  cycleDefaut: 70,
  cycleMax: 120,
  cycleMaxAbsolu: 130,
  jauneAgglo: 3,
  jauneHorsAgglo: 5,
  vertMin: 6,
  rougeMin: 5,
  tempsPerdu: 5,
  /** Équivalences en unités de véhicule particulier. */
  uvpPoidsLourd: 2,
  uvpDeuxRoues: 0.3,
  /** Vitesses de dégagement, en m/s. */
  vitessePietons: 1,
  vitesseVehicules: 10,
  vitesseVelos: 10,
} as const;
