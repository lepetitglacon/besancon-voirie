import { distanceMetres, pointADistance, projeter } from '@voirie/engine'
import type { CarrefourTempsReel, TramsTempsReel } from '@voirie/schema'
import { rames, type RameSurParcours, type ReseauPrepare } from '../tram/positionsTrams'

/** Un carrefour est sur un parcours de tram s'il est à moins de cette distance de son tracé. */
const ECART_TRACE_M = 30
/**
 * Fenêtre de la priorité tram, le long du tracé : demandée quand la rame arrive à moins de
 * `APPROCHE_M` du carrefour (détection d'approche), tenue jusqu'à ce qu'elle l'ait dégagé
 * (longueur d'une rame et traversée du carrefour).
 */
export const APPROCHE_M = 150
export const DEGAGEMENT_M = 40
/** Une rame à quai ne demande la priorité qu'à l'approche de son départ. */
const DEPART_S = 10

/** Où un parcours de tram croise un carrefour : distance du carrefour le long du tracé. */
export interface PassageTram {
  parcours: string
  distance: number
}

/** Rame dans la fenêtre de priorité d'un carrefour. */
export interface ApprocheTram {
  vehicule: string
  ligne: string
  couleur: string
  destination: string
  /** Distance restante jusqu'au carrefour, en m ; négative une fois le carrefour franchi. */
  distance: number
  /** Temps estimé avant le passage, en s ; 0 une fois le carrefour atteint. */
  dans_s: number
}

/** Parcours de tram qui passent par chaque carrefour (id → passages). */
export function carrefoursSurLeTrace(reseau: ReseauPrepare, carrefours: readonly CarrefourTempsReel[]): Map<string, PassageTram[]> {
  const resultat = new Map<string, PassageTram[]>()
  for (const carrefour of carrefours) {
    const passages: PassageTram[] = []
    for (const [id, { ligne }] of reseau.parcours) {
      const distance = projeter(ligne, carrefour.position)
      if (distanceMetres(pointADistance(ligne, distance), carrefour.position) <= ECART_TRACE_M) passages.push({ parcours: id, distance })
    }
    if (passages.length > 0) resultat.set(carrefour.id, passages)
  }
  return resultat
}

/** Rames dans la fenêtre de priorité de chaque carrefour, la plus proche d'abord. */
export function approchesTram(
  passages: ReadonlyMap<string, readonly PassageTram[]>,
  reseau: ReseauPrepare,
  rames: readonly RameSurParcours[],
): Map<string, ApprocheTram[]> {
  const resultat = new Map<string, ApprocheTram[]>()
  for (const [carrefour, sesPassages] of passages) {
    const approches: ApprocheTram[] = []
    for (const passage of sesPassages) {
      const infos = reseau.parcours.get(passage.parcours)!.infos
      for (const rame of rames) {
        if (rame.parcours !== passage.parcours || rame.etat !== 'en_ligne') continue
        if (rame.departDans !== undefined && rame.departDans > DEPART_S) continue
        const distance = passage.distance - rame.distance
        if (distance > APPROCHE_M || distance < -DEGAGEMENT_M) continue
        approches.push({
          vehicule: rame.vehicule,
          ligne: infos.ligne,
          couleur: infos.couleur,
          destination: infos.destination,
          distance: Math.round(distance),
          dans_s: distance > 0 && rame.vitesse > 0 ? Math.round(distance / rame.vitesse + (rame.departDans ?? 0)) : 0,
        })
      }
    }
    if (approches.length > 0) resultat.set(carrefour, approches.sort((a, b) => a.distance - b.distance))
  }
  return resultat
}

/** Ce qu'il faut pour suivre la priorité tram : réseau, flux des rames et carrefours sur le tracé. */
export interface ContexteTram {
  reseau: ReseauPrepare
  trams: TramsTempsReel
  surLeTrace: ReadonlyMap<string, readonly PassageTram[]>
}

/** Rames dans la fenêtre de priorité de chaque carrefour, à l'instant donné (ms epoch). */
export function approchesA(contexte: ContexteTram | null, maintenant: number): Map<string, ApprocheTram[]> {
  if (!contexte) return new Map()
  return approchesTram(contexte.surLeTrace, contexte.reseau, rames(contexte.reseau, contexte.trams, maintenant))
}
