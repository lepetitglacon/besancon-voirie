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
  /** Longueur ajoutée au trajet du dernier véhicule qui dégage le point de conflit (m). */
  longueurVehicule: 6,
  /** Rouge de dégagement retenu quand la géométrie ne permet pas de le calculer (s). */
  rougeDegagementDefaut: 2,
} as const;
