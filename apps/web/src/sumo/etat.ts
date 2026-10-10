import { useQuery } from '@tanstack/react-query'
import type { FluxSumo } from '@voirie/schema'
import { useMemo, useSyncExternalStore } from 'react'
import { api } from '../api'
import { Series, type CleIndicateur, type Statistique } from './indicateurs'
import { Vehicules } from './vehicules'

/**
 * État du mode SUMO, partagé entre la couche de la carte (dans la carte) et les cartes de l'écran
 * (hors de la carte). Un petit store plutôt qu'un état d'App : l'heure de la timeline change à
 * chaque image pendant la lecture, et seuls ses abonnés se redessinent.
 */
export interface EtatSumo {
  essaiId: string | null
  /** Heure de la timeline, en secondes depuis minuit. */
  temps: number
  lecture: boolean
  /** Secondes simulées par seconde réelle. */
  vitesse: number
  indicateur: CleIndicateur
  statistique: Statistique
  /** Rang du tronçon choisi sur la carte. */
  troncon: number | null
  /** Flux du formulaire de lancement en cours, dessinés sur la carte. */
  flux: FluxSumo[]
  /** Bout de flux à placer au prochain clic sur la carte. */
  choixPoint: { flux: number; bout: 'origine' | 'destination' } | null
  afficherTroncons: boolean
  afficherVehicules: boolean
  couleurVehicules: 'etat' | 'motif'
  /** Rang de la voiture choisie sur la carte. */
  vehicule: number | null
  /** La carte suit la voiture choisie. */
  suivre: boolean
}

let etat: EtatSumo = {
  essaiId: null,
  temps: 0,
  lecture: false,
  vitesse: 300,
  indicateur: 'vitesse',
  statistique: 'instant',
  troncon: null,
  flux: [],
  choixPoint: null,
  afficherTroncons: true,
  afficherVehicules: true,
  couleurVehicules: 'etat',
  vehicule: null,
  suivre: false,
}
const abonnes = new Set<() => void>()

export const etatSumo = {
  lire: () => etat,
  modifier(changement: Partial<EtatSumo> | ((e: EtatSumo) => Partial<EtatSumo>)) {
    etat = { ...etat, ...(typeof changement === 'function' ? changement(etat) : changement) }
    abonnes.forEach((abonne) => abonne())
  },
  abonner(abonne: () => void) {
    abonnes.add(abonne)
    return () => abonnes.delete(abonne)
  },
}

/** Une partie de l'état ; le composant ne se redessine que si elle change (valeur primitive). */
export function useEtatSumo<T>(choix: (e: EtatSumo) => T): T {
  return useSyncExternalStore(etatSumo.abonner, () => choix(etat))
}

/** Rang de la tranche de 5 min qui contient l'heure de la timeline. */
export function tranche(temps: number, debut: number, pas: number, tranches: number): number {
  return Math.min(tranches - 1, Math.max(0, Math.floor((temps - debut) / pas)))
}

/** Données de l'essai choisi : résumé et courbes, tronçons, séries. */
export function useDonneesEssai() {
  const essaiId = useEtatSumo((e) => e.essaiId)
  const essai = useQuery({
    queryKey: ['sumo-essai', essaiId],
    queryFn: () => api.essaiSumo(essaiId!),
    enabled: essaiId !== null,
    staleTime: Infinity,
  })
  const troncons = useQuery({
    queryKey: ['sumo-troncons', essaiId],
    queryFn: () => api.tronconsSumo(essaiId!),
    enabled: essaiId !== null,
    staleTime: Infinity,
  })
  const brutes = useQuery({
    queryKey: ['sumo-series', essaiId],
    queryFn: () => api.seriesSumo(essaiId!),
    enabled: essaiId !== null,
    staleTime: Infinity,
  })
  const series = useMemo(
    () => (essai.data && brutes.data ? new Series(brutes.data, essai.data) : undefined),
    [essai.data, brutes.data],
  )
  const aVehicules = essai.data?.vehicules !== undefined
  const vehiculesBruts = useQuery({
    queryKey: ['sumo-vehicules', essaiId],
    queryFn: () => api.vehiculesSumo(essaiId!),
    enabled: essaiId !== null && aVehicules,
    staleTime: Infinity,
  })
  const vehicules = useMemo(
    () =>
      essai.data && troncons.data && vehiculesBruts.data
        ? new Vehicules(vehiculesBruts.data, essai.data, troncons.data)
        : undefined,
    [essai.data, troncons.data, vehiculesBruts.data],
  )
  return {
    essai: essai.data,
    troncons: troncons.data,
    series,
    vehicules,
    chargementVehicules: vehiculesBruts.isLoading,
    chargement: essai.isLoading || troncons.isLoading || brutes.isLoading,
    erreur: essai.error ?? troncons.error ?? brutes.error,
  }
}
