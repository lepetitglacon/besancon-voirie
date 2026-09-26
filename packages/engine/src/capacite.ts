import { PARAMETRES_CERTU } from './parametres.js';

/**
 * Capacité théorique d'une ligne de feux, en UVP/h :
 * débit de saturation × voies × part de vert utile dans le cycle.
 */
export function capaciteLigne(
  vertUtile_s: number,
  cycle_s: number,
  voies = 1,
  debitSaturation: number = PARAMETRES_CERTU.debitSaturation,
): number {
  if (cycle_s <= 0) throw new RangeError('Le cycle doit être positif');
  if (vertUtile_s < 0 || vertUtile_s > cycle_s) {
    throw new RangeError('Le vert utile doit être compris entre 0 et la durée du cycle');
  }
  return (debitSaturation * voies * vertUtile_s) / cycle_s;
}

/**
 * Cycle optimal de Webster : C₀ = (1,5 L + 5) / (1 − Y).
 * @param tempsPerduTotal_s L, temps perdu total par cycle
 * @param sommeRapportsCritiques Y, somme des (débit critique / débit de saturation) des phases
 * @returns null si le carrefour est saturé (Y ≥ 1)
 */
export function cycleWebster(tempsPerduTotal_s: number, sommeRapportsCritiques: number): number | null {
  if (sommeRapportsCritiques >= 1) return null;
  return (1.5 * tempsPerduTotal_s + 5) / (1 - sommeRapportsCritiques);
}
