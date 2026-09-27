/**
 * Couleurs métier en valeurs brutes : MapLibre et le SVG en ont besoin telles quelles.
 * Le thème Chakra les reprend en tokens (`feu.*`, `statut.*`, `conflit.*`) pour l'interface.
 */

/** Lampes d'un feu. */
export const FEU = {
  vert: '#2fbf6a',
  orange: '#e6b422',
  rouge: '#e2453c',
} as const

/** Statuts de programmation d'un carrefour (docs/ARCHITECTURE.md §8). */
export const STATUT = {
  a_confirmer: '#9aa1ad',
  non_releve: '#6b7280',
  estime: '#e08a1e',
  mesure: '#2f6fd6',
  verifie: '#1f8a4c',
} as const

/** Natures de conflit entre deux lignes de feux. */
export const CONFLIT = {
  croisement: '#e2453c',
  convergence: '#f08a24',
  pieton: '#7c5cff',
  admis: '#2fbf6a',
} as const
