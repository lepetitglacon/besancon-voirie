import type { EntreeMenu } from '../ds'

/**
 * Outil actif sur la carte pendant la configuration d'un carrefour. Carrefour bâti sur le réseau :
 * sélection, tracer, couper et nœuds agissent sur le réseau (docs/RESEAU.md §7), liaison et feu
 * sur le carrefour ; ajuster, piéton et nœud (d'anneau) ne servent qu'aux branches dessinées à la main.
 */
export type OutilCarte =
  | 'selection'
  | 'ajuster'
  | 'connecter'
  | 'feux'
  | 'pieton'
  | 'noeud'
  | 'tracer'
  | 'couper'
  | 'noeuds'
  | 'voie'
  | 'passage'
  | 'emprise'
  | 'forme'

/** Actions de la configuration, partagées par la barre d'outils, le clavier et le menu contextuel. */
export type ActionConfiguration = OutilCarte | 'osm' | 'ia' | 'json' | 'plan' | 'enregistrer' | 'fermer'

/** `giratoire` : outil réservé aux giratoires. */
export const OUTILS: Array<{ outil: OutilCarte; glyphe: string; libelle: string; raccourci: string; giratoire?: boolean }> = [
  { outil: 'selection', glyphe: '↖', libelle: 'Sélection', raccourci: 'V' },
  { outil: 'ajuster', glyphe: '≡', libelle: 'Voie', raccourci: 'L' },
  { outil: 'connecter', glyphe: '↝', libelle: 'Liaison', raccourci: 'C' },
  { outil: 'feux', glyphe: '●', libelle: 'Feu', raccourci: 'F' },
  { outil: 'pieton', glyphe: '▦', libelle: 'Piéton', raccourci: 'P' },
  { outil: 'noeud', glyphe: '◉', libelle: 'Nœud', raccourci: 'N', giratoire: true },
]

export const RACCOURCIS: Record<string, ActionConfiguration> = { v: 'selection', l: 'ajuster', c: 'connecter', f: 'feux', p: 'pieton', n: 'noeud', o: 'osm', i: 'ia' }

/**
 * Outils de l'éditeur des voies (docs/pipeline-donnees.md, étapes 1, 3 et 8) : corriger le tracé
 * d'un tronçon, ajouter ou retirer une voie, poser un passage piéton, dessiner l'emprise d'une voie.
 */
export const OUTILS_VOIES: Array<{ outil: 'forme' | 'voie' | 'passage' | 'emprise'; glyphe: string; libelle: string; raccourci: string }> = [
  { outil: 'forme', glyphe: '◇', libelle: 'Forme', raccourci: 'D' },
  { outil: 'voie', glyphe: '≡', libelle: 'Voie', raccourci: 'L' },
  { outil: 'passage', glyphe: '▦', libelle: 'Passage', raccourci: 'P' },
  { outil: 'emprise', glyphe: '▱', libelle: 'Emprise', raccourci: 'E' },
]

/** Outils d'un carrefour bâti sur le réseau, à la TM:PE. */
export const OUTILS_GRAPHE: Array<{ outil: OutilCarte; glyphe: string; libelle: string; raccourci: string }> = [
  { outil: 'selection', glyphe: '↖', libelle: 'Sélection', raccourci: 'V' },
  { outil: 'tracer', glyphe: '＋', libelle: 'Tracer', raccourci: 'T' },
  { outil: 'couper', glyphe: '✂', libelle: 'Couper', raccourci: 'X' },
  ...OUTILS_VOIES,
  { outil: 'connecter', glyphe: '↝', libelle: 'Liaison', raccourci: 'C' },
  { outil: 'noeuds', glyphe: '◎', libelle: 'Nœuds', raccourci: 'N' },
  { outil: 'feux', glyphe: '●', libelle: 'Feu', raccourci: 'F' },
]

export const RACCOURCIS_GRAPHE: Record<string, ActionConfiguration> = {
  v: 'selection',
  t: 'tracer',
  x: 'couper',
  l: 'voie',
  p: 'passage',
  e: 'emprise',
  d: 'forme',
  c: 'connecter',
  n: 'noeuds',
  f: 'feux',
}

/**
 * Outils qui agissent sur le réseau (les autres sont propres au carrefour). La liaison relie les
 * voies du carrefour, d'une branche à l'autre, pas celles de ses nœuds : il est une boîte noire.
 */
export const OUTILS_RESEAU = ['selection', 'tracer', 'couper', 'noeuds', 'voie', 'passage', 'emprise', 'forme'] as const

/** Entrées du menu contextuel de la carte pendant la configuration. */
export const MENU_CONFIGURATION: EntreeMenu[] = [
  ...OUTILS.filter((o) => !o.giratoire).map(({ outil, glyphe, libelle, raccourci }) => ({ valeur: outil, glyphe, libelle: `Outil ${libelle.toLowerCase()}`, raccourci })),
  { type: 'separateur' },
  { valeur: 'osm', glyphe: '⟳', libelle: 'Détecter les branches depuis OSM', raccourci: 'O' },
  { valeur: 'ia', glyphe: '✦', libelle: 'Générer avec OSM + IA (en file)', raccourci: 'I' },
  { valeur: 'json', glyphe: '⇪', libelle: 'Importer un JSON de branches' },
  { valeur: 'plan', glyphe: '▭', libelle: 'Plan de feux', raccourci: 'Tab' },
  { type: 'separateur' },
  { valeur: 'enregistrer', glyphe: '✓', libelle: 'Enregistrer', raccourci: 'Ctrl S' },
  { valeur: 'fermer', glyphe: '×', libelle: 'Quitter la configuration', raccourci: 'Échap' },
]


/** Menu contextuel d'un carrefour bâti sur le réseau. */
export const MENU_GRAPHE: EntreeMenu[] = [
  ...OUTILS_GRAPHE.map(({ outil, glyphe, libelle, raccourci }) => ({ valeur: outil, glyphe, libelle: `Outil ${libelle.toLowerCase()}`, raccourci })),
  { type: 'separateur' },
  { valeur: 'plan', glyphe: '▭', libelle: 'Plan de feux', raccourci: 'Tab' },
  { type: 'separateur' },
  { valeur: 'enregistrer', glyphe: '✓', libelle: 'Enregistrer', raccourci: 'Ctrl S' },
  { valeur: 'fermer', glyphe: '×', libelle: 'Quitter la configuration', raccourci: 'Échap' },
]
