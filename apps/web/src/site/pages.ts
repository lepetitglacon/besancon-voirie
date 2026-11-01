/** Pages du site, ouvertes par-dessus la carte : la carte reste montée et garde son état. */
export const PAGES = {
  connexion: { chemin: '/connexion', titre: 'Se connecter' },
  inscription: { chemin: '/inscription', titre: 'Créer un compte' },
  motDePasseOublie: { chemin: '/mot-de-passe-oublie', titre: 'Mot de passe oublié' },
  /** Liens envoyés par e-mail (`?jeton=`). */
  reinitialisation: { chemin: '/reinitialisation', titre: 'Nouveau mot de passe' },
  verification: { chemin: '/verification', titre: 'Confirmation de l’adresse e-mail' },
  parametres: { chemin: '/parametres', titre: 'Paramètres du compte' },
  droits: { chemin: '/gestion-des-droits', titre: 'Gestion des droits' },
  accessibilite: { chemin: '/accessibilite', titre: 'Accessibilité' },
  aPropos: { chemin: '/a-propos', titre: 'À propos' },
  mentions: { chemin: '/mentions-legales', titre: 'Mentions légales' },
  /** Page à part entière : la carte n'y est pas montée. */
  designSystem: { chemin: '/design-system', titre: 'Design system' },
} as const

export const DEPOT = 'https://github.com/lepetitglacon/besancon-voirie'

/**
 * Destination qui garde la vue de la carte (« #zoom/lat/lon ») : MapLibre l'écrit dans l'URL
 * sans passer par le routeur, d'où la lecture directe de window.location.
 */
export function avecVue(chemin: string) {
  return { pathname: chemin, hash: window.location.hash }
}
