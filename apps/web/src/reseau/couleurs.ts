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
  /** Carrefour ouvert : ses nœuds. */
  carrefourOuvert: '#f97316',
  /** Ligne d'arrêt à feux. */
  feux: '#e0561e',
  /** Passage piéton. */
  pieton: '#f8fafc',
  /** Voies réservées. */
  velo: '#22c55e',
  bus: '#e11d48',
  tram: '#a855f7',
  culDeSac: '#ef4444',
  trace: '#f472b6',
  /** Emprise réelle d'une voie, posée sur la photo. */
  emprise: '#facc15',
} as const
