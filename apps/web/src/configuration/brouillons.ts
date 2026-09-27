import type { CarrefourResume, DetectionBranchesIa, PlanSaisi, SourceBranche } from '@voirie/schema'
import { useSyncExternalStore } from 'react'
import type { Brouillon } from './modele'
import type { BrouillonLignes } from './OngletLignes'
import type { BrouillonRaccordements } from './raccordements'

/**
 * Modifications non enregistrées d'un carrefour. Elles vivent hors de la configuration :
 * on peut quitter un carrefour, en ouvrir un autre, puis revenir les enregistrer.
 */
export interface BrouillonsCarrefour {
  carrefour: CarrefourResume
  position: [number, number]
  branches: Brouillon | null
  /** Provenance des branches proposées (OSM, défaut, IA), tant que leur brouillon existe. */
  sources: Record<string, SourceBranche>
  analyseIa: DetectionBranchesIa['ia'] | null
  /** Branche et liens voie à voie des tronçons du réseau raccordés (docs/RESEAU.md). */
  raccordements: BrouillonRaccordements | null
  lignes: BrouillonLignes | null
  programme: PlanSaisi[] | null
}

export type ModificationsBrouillons = Partial<Omit<BrouillonsCarrefour, 'carrefour' | 'position'>>

let brouillons: ReadonlyMap<string, BrouillonsCarrefour> = new Map()
const abonnes = new Set<() => void>()

function publier(suivants: ReadonlyMap<string, BrouillonsCarrefour>) {
  brouillons = suivants
  for (const abonne of abonnes) abonne()
}

const abonner = (abonne: () => void) => {
  abonnes.add(abonne)
  return () => abonnes.delete(abonne)
}

const aucun = (b: BrouillonsCarrefour) => b.branches === null && b.raccordements === null && b.lignes === null && b.programme === null

/** Brouillons de tous les carrefours modifiés, dans l'ordre de leur première modification. */
export function useBrouillons(): ReadonlyMap<string, BrouillonsCarrefour> {
  return useSyncExternalStore(abonner, () => brouillons)
}

/** Brouillons d'un carrefour, undefined s'il n'a aucune modification en attente. */
export function useBrouillonsCarrefour(carrefourId: string): BrouillonsCarrefour | undefined {
  return useSyncExternalStore(abonner, () => brouillons.get(carrefourId))
}

/** Lecture ponctuelle, hors rendu. */
export const lireBrouillons = (carrefourId: string) => brouillons.get(carrefourId)

/** Remplace une partie des brouillons d'un carrefour ; sans brouillon restant, le carrefour sort de la liste. */
export function modifierBrouillons(carrefour: CarrefourResume, position: [number, number], modifications: ModificationsBrouillons) {
  const avant = brouillons.get(carrefour.id)
  const apres: BrouillonsCarrefour = {
    branches: null,
    sources: {},
    analyseIa: null,
    raccordements: null,
    lignes: null,
    programme: null,
    ...avant,
    ...modifications,
    carrefour,
    position,
  }
  // Branches enregistrées ou abandonnées : leur provenance n'a plus d'objet.
  if (modifications.branches === null) Object.assign(apres, { sources: {}, analyseIa: null })
  const suivants = new Map(brouillons)
  if (aucun(apres)) suivants.delete(carrefour.id)
  else suivants.set(carrefour.id, apres)
  publier(suivants)
}

export function abandonnerBrouillons(carrefourId: string) {
  if (!brouillons.has(carrefourId)) return
  const suivants = new Map(brouillons)
  suivants.delete(carrefourId)
  publier(suivants)
}

/** « branches, lignes » : ce qui attend d'être enregistré. */
export function libelleBrouillons(b: BrouillonsCarrefour): string {
  return [b.branches && 'branches', b.raccordements && 'raccordements', b.lignes && 'lignes de feux', b.programme && 'programme']
    .filter(Boolean)
    .join(', ')
}
