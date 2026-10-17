/** Pages du site, ouvertes par-dessus la carte : la carte reste montée et garde son état. */
export const PAGES = {
  connexion: { chemin: '/connexion', titre: 'Connexion' },
  accessibilite: { chemin: '/accessibilite', titre: 'Accessibilité' },
  aPropos: { chemin: '/a-propos', titre: 'À propos' },
  mentions: { chemin: '/mentions-legales', titre: 'Mentions légales' },
  /** Page à part entière : la carte n'y est pas montée. */
  designSystem: { chemin: '/design-system', titre: 'Design system' },
} as const

/** Fiche publique d'un carrefour. */
export const cheminFiche = (slug: string) => `/carrefours/${slug}`

export const DEPOT = 'https://github.com/lepetitglacon/besancon-voirie'

/**
 * Destination qui garde la vue de la carte (« #zoom/lat/lon ») : MapLibre l'écrit dans l'URL
 * sans passer par le routeur, d'où la lecture directe de window.location.
 */
export function avecVue(chemin: string) {
  return { pathname: chemin, hash: window.location.hash }
}
