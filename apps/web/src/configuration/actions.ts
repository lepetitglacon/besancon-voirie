import type { EntreeMenu } from '../ds'

/** Outil actif sur la carte pendant la configuration d'un carrefour. */
export type OutilCarte = 'selection' | 'ajuster' | 'connecter' | 'feux' | 'pieton'

/** Actions de la configuration, partagées par la barre d'outils, le clavier et le menu contextuel. */
export type ActionConfiguration = OutilCarte | 'osm' | 'plan' | 'enregistrer' | 'fermer'

export const OUTILS: Array<{ outil: OutilCarte; glyphe: string; libelle: string; raccourci: string }> = [
  { outil: 'selection', glyphe: '↖', libelle: 'Sélection', raccourci: 'V' },
  { outil: 'ajuster', glyphe: '≡', libelle: 'Voie', raccourci: 'L' },
  { outil: 'connecter', glyphe: '↝', libelle: 'Liaison', raccourci: 'C' },
  { outil: 'feux', glyphe: '●', libelle: 'Feu', raccourci: 'F' },
  { outil: 'pieton', glyphe: '▦', libelle: 'Piéton', raccourci: 'P' },
]

export const RACCOURCIS: Record<string, ActionConfiguration> = { v: 'selection', l: 'ajuster', c: 'connecter', f: 'feux', p: 'pieton', o: 'osm' }

/** Entrées du menu contextuel de la carte pendant la configuration. */
export const MENU_CONFIGURATION: EntreeMenu[] = [
  ...OUTILS.map(({ outil, glyphe, libelle, raccourci }) => ({ valeur: outil, glyphe, libelle: `Outil ${libelle.toLowerCase()}`, raccourci })),
  { type: 'separateur' },
  { valeur: 'osm', glyphe: '⟳', libelle: 'Détecter les branches depuis OSM', raccourci: 'O' },
  { valeur: 'plan', glyphe: '▭', libelle: 'Plan de feux', raccourci: 'Tab' },
  { type: 'separateur' },
  { valeur: 'enregistrer', glyphe: '✓', libelle: 'Enregistrer', raccourci: 'Ctrl S' },
  { valeur: 'fermer', glyphe: '×', libelle: 'Quitter la configuration', raccourci: 'Échap' },
]

