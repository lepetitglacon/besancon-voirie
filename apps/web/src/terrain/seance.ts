import type { SaisieReleve } from '@voirie/engine'
import { useCallback, useState } from 'react'

/**
 * Séance de relevé d'un carrefour, gardée sur le téléphone : elle survit à un rechargement, à une
 * mise en veille ou à l'absence de réseau. Le stockage peut manquer (navigation privée) : la séance
 * reste alors en mémoire.
 */
export interface Seance {
  saisies: SaisieReleve[]
  /** Instants des passages au vert déjà envoyés au calage : on ne les renvoie pas. */
  envoyes: number[]
  /** Relevé envoyé à l'API (une fois par séance) et le nombre de saisies qu'il contenait. */
  releve?: { id: string; saisies: number }
  /** « J'ai fini » : fin du relevé (ms epoch) ; plus de saisie tant qu'on ne reprend pas. */
  termine?: number
}

const VIDE: Seance = { saisies: [], envoyes: [] }
const cle = (carrefourId: string) => `voirie:releve:${carrefourId}`

function lire(carrefourId: string): Seance {
  try {
    const brut = window.localStorage.getItem(cle(carrefourId))
    return brut ? { ...VIDE, ...(JSON.parse(brut) as Partial<Seance>) } : VIDE
  } catch {
    return VIDE
  }
}

function ecrire(carrefourId: string, seance: Seance) {
  try {
    if (seance.saisies.length === 0) window.localStorage.removeItem(cle(carrefourId))
    else window.localStorage.setItem(cle(carrefourId), JSON.stringify(seance))
  } catch {
    // Stockage indisponible : la séance vit en mémoire jusqu'à la fermeture de la page.
  }
}

/** La séance du carrefour, et de quoi la modifier (chaque modification est enregistrée aussitôt). */
export function useSeance(carrefourId: string) {
  const [seance, setSeance] = useState(() => lire(carrefourId))
  const modifier = useCallback(
    (changer: (seance: Seance) => Seance) =>
      setSeance((actuelle) => {
        const suivante = changer(actuelle)
        ecrire(carrefourId, suivante)
        return suivante
      }),
    [carrefourId],
  )
  return [seance, modifier] as const
}

const CLE_PSEUDO = 'voirie:pseudo'

/** Pseudo du dernier relevé envoyé, proposé au suivant. */
export function lirePseudo(): string {
  try {
    return window.localStorage.getItem(CLE_PSEUDO) ?? ''
  } catch {
    return ''
  }
}

export function ecrirePseudo(pseudo: string) {
  try {
    if (pseudo.trim()) window.localStorage.setItem(CLE_PSEUDO, pseudo.trim())
    else window.localStorage.removeItem(CLE_PSEUDO)
  } catch {
    // Stockage indisponible : le pseudo sera à retaper.
  }
}
