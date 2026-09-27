import { modulo, planEnVigueur, positionCycle, type Intervalle } from '@voirie/engine'
import type { CarrefourTempsReel, ConfianceSynchro, PlanTempsReel } from '@voirie/schema'

/** Ce qu'affiche un feu à l'instant donné ; `inconnu` : plan ou phase inconnus. */
export type EtatTempsReel = 'vert' | 'jaune' | 'rouge' | 'clignotant' | 'eteint' | 'inconnu'

/**
 * Degré de confiance de l'état affiché : calé sur plusieurs jours de tops, sur un seul, ou
 * seulement indicatif (contrôleur micro-régulé ou priorité transports en commun, tops
 * discordants) — docs/ARCHITECTURE.md §6.1.
 */
export type Fiabilite = 'synchronisee' | 'estimee' | 'indicative' | 'inconnue'

export interface EtatCarrefour {
  plan: PlanTempsReel | null
  /** Position dans le cycle (s), null si le plan n'a pas de cycle ou pas de décalage. */
  position: number | null
  etats: Map<string, EtatTempsReel>
  fiabilite: Fiabilite
  /** Pourquoi l'état n'est qu'indicatif. */
  reserves: string[]
}

const EPSILON = 1e-9

/**
 * Jaunes d'une ligne véhicule : `jaune_s` après chaque fin de vert. Un vert à cheval sur la fin
 * du cycle ([a, cycle] et [0, b]) ne finit pas en fin de cycle mais en b.
 */
export function jaunesDepuisVerts(verts: readonly Intervalle[], cycle_s: number, jaune_s: number): Intervalle[] {
  const commenceA0 = verts.some(([a]) => a <= EPSILON)
  return verts
    .filter(([, b]) => !(commenceA0 && b >= cycle_s - EPSILON && verts.length > 1))
    .map(([, b]): Intervalle => [modulo(b, cycle_s), modulo(b, cycle_s) + jaune_s])
}

const dans = (intervalles: readonly Intervalle[], t: number, cycle_s: number) =>
  intervalles.some(([a, b]) => {
    const d = modulo(t - a, cycle_s)
    return d < b - a - EPSILON
  })

const RESERVES_CONTROLEUR: Partial<Record<string, string>> = {
  actue: 'contrôleur micro-régulé : les verts s’allongent selon le trafic',
  semi_actue: 'contrôleur micro-régulé : les verts s’allongent selon le trafic',
}

const FIABILITE: Record<ConfianceSynchro, Fiabilite> = {
  synchronisee: 'synchronisee',
  estimee: 'estimee',
  incoherente: 'indicative',
  inconnue: 'inconnue',
}

/** État de chaque ligne d'un carrefour à un instant réel (ms epoch). */
export function etatCarrefour(carrefour: CarrefourTempsReel, instant_ms: number): EtatCarrefour {
  const plan = planEnVigueur(carrefour.plans, instant_ms)
  const tous = (etat: EtatTempsReel) => new Map(carrefour.lignes.map((l) => [l.code, etat]))
  if (!plan) return { plan, position: null, etats: tous('inconnu'), fiabilite: 'inconnue', reserves: ['aucun plan ne couvre cette heure'] }
  // Jaune clignotant : allumé une seconde sur deux (les piétons sont éteints).
  if (plan.mode === 'jaune_clignotant') {
    const allume = Math.floor(instant_ms / 1000) % 2 === 0
    const etats = new Map(carrefour.lignes.map((l): [string, EtatTempsReel] => [l.code, l.pieton || !allume ? 'eteint' : 'clignotant']))
    return { plan, position: null, etats, fiabilite: 'synchronisee', reserves: [] }
  }
  if (plan.mode === 'eteint') return { plan, position: null, etats: tous('eteint'), fiabilite: 'synchronisee', reserves: [] }

  const synchro = plan.synchro
  if (!plan.cycle_s || !plan.verts || synchro?.decalage_s == null) {
    return { plan, position: null, etats: tous('inconnu'), fiabilite: 'inconnue', reserves: ['aucun top relevé : phase inconnue'] }
  }
  const cycle = plan.cycle_s
  const position = positionCycle(instant_ms, cycle, synchro.decalage_s)
  const etats = new Map(
    carrefour.lignes.map((l): [string, EtatTempsReel] => {
      const verts = plan.verts![l.code] ?? []
      if (dans(verts, position, cycle)) return [l.code, 'vert']
      if (!l.pieton && dans(jaunesDepuisVerts(verts, cycle, plan.jaune_s ?? 3), position, cycle)) return [l.code, 'jaune']
      return [l.code, 'rouge']
    }),
  )

  const reserves: string[] = []
  const controle = RESERVES_CONTROLEUR[carrefour.controleur.mode]
  if (controle) reserves.push(controle)
  if (carrefour.pres_tram || carrefour.controleur.priorite_tc === 'tram') reserves.push('priorité tram : le passage d’une rame décale le cycle')
  else if (carrefour.controleur.priorite_tc === 'bus') reserves.push('priorité bus : le passage d’un bus décale le cycle')
  if (synchro.confiance === 'incoherente') reserves.push(`tops discordants (écart ${synchro.ecart_s} s) : carrefour sans doute pas calé sur l’heure`)
  const fiabilite = reserves.length > 0 ? 'indicative' : FIABILITE[synchro.confiance]
  return { plan, position, etats, fiabilite, reserves }
}
