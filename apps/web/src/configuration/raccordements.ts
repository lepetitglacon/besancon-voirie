/**
 * Raccordements du réseau à un carrefour (docs/RESEAU.md §4) : branche et liens voie à voie de
 * chaque bout de tronçon, tels qu'enregistrés, modifiés dans l'éditeur, ou proposés par défaut.
 */
import { liensParDefaut } from '@voirie/engine'
import type { Branche, LiensRaccordement, Raccordement } from '@voirie/schema'
import { voiesDe } from './modele'

/** Choix fait dans l'éditeur pour un bout ; `liens` null : liens proposés par défaut. */
export interface RaccordementEdite {
  troncon_id: string
  extremite: Raccordement['extremite']
  branche: string | null
  liens: LiensRaccordement | null
}

/** Modifications en cours, par bout de tronçon (`cleRaccordement`). */
export type BrouillonRaccordements = Record<string, RaccordementEdite>

export const cleRaccordement = (r: Pick<Raccordement, 'troncon_id' | 'extremite'>) => `${r.troncon_id}:${r.extremite}`

/** Bout de tronçon tel que l'éditeur le montre. */
export interface RaccordementAffiche extends Raccordement {
  cle: string
  /** Liens proposés par défaut (ni saisis ni enregistrés). */
  liens_auto: boolean
}

function liensAuto(r: Raccordement, branche: Branche | undefined): LiensRaccordement {
  return {
    entree: liensParDefaut(r.voies_vers_carrefour, branche ? voiesDe(branche, 'entrante').length : 0),
    sortie: liensParDefaut(branche ? voiesDe(branche, 'sortante').length : 0, r.voies_depuis_carrefour),
  }
}

/**
 * Branche et liens retenus pour chaque bout : la modification en cours, sinon l'enregistré. Les
 * liens par défaut se recalculent sur les branches du brouillon (voies ajoutées ou retirées).
 */
export function raccordementsAffiches(
  lus: Raccordement[],
  brouillon: BrouillonRaccordements | null,
  branches: Branche[],
): RaccordementAffiche[] {
  return lus.map((r) => {
    const cle = cleRaccordement(r)
    const edite = brouillon?.[cle]
    const branche = edite ? edite.branche : r.branche
    const b = branches.find((x) => x.code === branche)
    const saisis = edite ? edite.liens : r.liens_auto ? null : r.liens
    return { ...r, cle, branche, liens: saisis ?? liensAuto(r, b), liens_auto: saisis === null }
  })
}

/** Ajoute le lien, ou le retire s'il existe ; les liens par défaut deviennent des liens saisis. */
export function basculerLien(liens: LiensRaccordement, sens: keyof LiensRaccordement, [a, b]: [number, number]): LiensRaccordement {
  const existe = liens[sens].some(([x, y]) => x === a && y === b)
  return {
    ...liens,
    [sens]: existe ? liens[sens].filter(([x, y]) => !(x === a && y === b)) : [...liens[sens], [a, b]],
  }
}

/** Enregistre dans le brouillon le choix fait pour un bout. */
export function editer(
  brouillon: BrouillonRaccordements | null,
  r: RaccordementAffiche,
  changement: Partial<Pick<RaccordementEdite, 'branche' | 'liens'>>,
): BrouillonRaccordements {
  const actuel: RaccordementEdite = brouillon?.[r.cle] ?? {
    troncon_id: r.troncon_id,
    extremite: r.extremite,
    branche: r.branche,
    liens: r.liens_auto ? null : r.liens,
  }
  return { ...brouillon, [r.cle]: { ...actuel, ...changement } }
}
