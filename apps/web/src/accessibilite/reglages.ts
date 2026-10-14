import { createContext, useContext } from 'react'

/** famille : valeur de --police ; null pour la police du thème (IBM Plex Sans). */
export const POLICES = {
  plex: { libelle: 'IBM Plex Sans', famille: null, apercu: "'IBM Plex Sans'" },
  atkinson: { libelle: 'Atkinson Hyperlegible', famille: "'Atkinson Hyperlegible'", apercu: "'Atkinson Hyperlegible'" },
  opendyslexic: { libelle: 'OpenDyslexic', famille: "'OpenDyslexic'", apercu: "'OpenDyslexic'" },
} as const

export type Police = keyof typeof POLICES

export interface ReglagesAccessibilite {
  /** Facteur sur la taille du texte seul. */
  texte: number
  /** Facteur sur toute l'interface (texte, boutons, panneaux), hors carte. */
  interface: number
  police: Police
  /** Lettres et mots plus espacés. */
  espacement: boolean
}

export const REGLAGES_DEFAUT: ReglagesAccessibilite = { texte: 1, interface: 1, police: 'plex', espacement: false }

type Contexte = readonly [ReglagesAccessibilite, (reglages: ReglagesAccessibilite) => void]

export const ContexteAccessibilite = createContext<Contexte>([REGLAGES_DEFAUT, () => {}])

export function useAccessibilite() {
  return useContext(ContexteAccessibilite)
}
