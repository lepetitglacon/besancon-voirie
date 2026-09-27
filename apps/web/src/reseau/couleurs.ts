/** Couleurs du réseau routier sur la photo aérienne (valeurs brutes pour MapLibre). */
export const COULEURS_RESEAU = {
  /** Tronçon OSM tel quel. */
  osm: '#38bdf8',
  /** Tronçon OSM corrigé à la main : gardé à la régénération. */
  modifie: '#f59e0b',
  /** Tronçon tracé à la main. */
  manuel: '#a3e635',
  selection: '#ffffff',
  carrefour: '#7c5cff',
  culDeSac: '#ef4444',
  trace: '#f472b6',
} as const
