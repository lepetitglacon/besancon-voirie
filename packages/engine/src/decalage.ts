/** Modulo toujours positif (le `%` de JS garde le signe du dividende). */
export function modulo(valeur: number, diviseur: number): number {
  return ((valeur % diviseur) + diviseur) % diviseur;
}

/**
 * Décalage du carrefour B par rapport au carrefour A, en secondes dans [0, cycle).
 * t0A et t0B sont des instants absolus (ms epoch) d'un début de vert de leur ligne de référence.
 * Valable seulement si les deux carrefours ont le même cycle et sont synchronisés.
 */
export function decalage(t0A_ms: number, t0B_ms: number, cycle_s: number): number {
  if (cycle_s <= 0) throw new RangeError('Le cycle doit être positif');
  return modulo((t0B_ms - t0A_ms) / 1000, cycle_s);
}

/**
 * Deux cycles peuvent-ils être coordonnés ? Égaux, ou l'un double de l'autre
 * (à la tolérance près, les relevés étant faits à la main).
 */
export function cyclesCompatibles(cycleA_s: number, cycleB_s: number, tolerance_s = 0.5): boolean {
  const [petit, grand] = cycleA_s <= cycleB_s ? [cycleA_s, cycleB_s] : [cycleB_s, cycleA_s];
  return Math.abs(grand - petit) <= tolerance_s || Math.abs(grand - 2 * petit) <= tolerance_s;
}
