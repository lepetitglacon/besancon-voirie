/** Le plan de feux se pose à droite sur un écran large, en bas sinon. */
export type Disposition = 'droite' | 'bas'

/** Hauteur du plan de feux posé en bas, en % de la fenêtre. */
export const HAUTEUR_PANNEAU_VH = 44
export const hauteurPanneau = `calc(var(--ecran-h) * ${HAUTEUR_PANNEAU_VH / 100})`

/**
 * Largeur du plan de feux posé à droite : 640 px au plus, en laissant 800 px à la carte pour que
 * la barre d'outils y tienne.
 */
export const LARGEUR_PANNEAU_PX = 640
export const LARGEUR_CARTE_MIN_PX = 800
export const largeurPanneau = `min(${LARGEUR_PANNEAU_PX}px, calc(var(--ecran-w) - ${LARGEUR_CARTE_MIN_PX}px))`

/** Place que le plan de feux prend à la carte, en pixels, pour la recentrer dans ce qui reste. */
export const emprisePanneau = (disposition: Disposition) =>
  disposition === 'droite'
    ? { right: Math.min(LARGEUR_PANNEAU_PX, window.innerWidth - LARGEUR_CARTE_MIN_PX), bottom: 0 }
    : { right: 0, bottom: (window.innerHeight * HAUTEUR_PANNEAU_VH) / 100 }

/**
 * Largeur du plan de feux à partir de laquelle ses onglets passent sur deux colonnes. Requête de
 * conteneur et non de fenêtre : le panneau latéral est étroit même sur un grand écran.
 */
const LARGEUR_DEUX_COLONNES = '60rem'

const auLarge = `@container (min-width: ${LARGEUR_DEUX_COLONNES})`

/** Grille d'un onglet : une colonne, puis `gabarit` quand le panneau est assez large. */
export const colonnes = (gabarit: string) => ({ templateColumns: '1fr', css: { [auLarge]: { gridTemplateColumns: gabarit } } })

/** Colonne qui reste en vue au défilement, quand elle est à côté de l'autre. */
export const collanteAuLarge = { css: { [auLarge]: { position: 'sticky', top: 0 } } }
