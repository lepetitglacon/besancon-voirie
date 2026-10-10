/**
 * Tracé d'un tronçon sur la carte, sans effet de bord : on clique un point de départ (nœud,
 * tronçon ou point libre), des points intermédiaires, puis un nœud ou un tronçon d'arrivée —
 * ou Entrée pour finir sur un point libre (cul-de-sac, bout à relier plus tard).
 */
import type { LonLat } from '@voirie/engine'
import type { Accroche, NouveauTroncon, SensTroncon } from '@voirie/schema'

export interface PointTrace {
  position: LonLat
  /** Seuls le premier et le dernier point s'accrochent ; les autres dessinent la forme. */
  accroche: Accroche
}

export type Trace = PointTrace[]

/**
 * Ce qu'on a cliqué : un nœud ou un tronçon existant, ou rien (point libre). Au zoom des voies,
 * un clic sur une voie dit aussi laquelle (sens et rang).
 */
export type Cible =
  | { type: 'noeud'; id: string }
  | { type: 'troncon'; id: string; voie?: { sens: SensTroncon; rang: number } }
  /** Passage piéton tracé librement. */
  | { type: 'passage'; id: string }
  | null

export type ResultatClic = { trace: Trace; termine: boolean }

/**
 * Clic pendant le tracé. Au départ, la cible donne l'accroche du premier point ; ensuite, un
 * clic sur un nœud ou un tronçon termine le tracé, un clic dans le vide ajoute un point. Un
 * clic sur le point précédent (à `memePoint`) termine aussi, sur ce point.
 */
export function cliquer(trace: Trace, position: LonLat, cible: Cible, memePoint: (a: LonLat, b: LonLat) => boolean): ResultatClic {
  // Un passage piéton n'accroche rien : le point est libre.
  const accroche: Accroche = cible && cible.type !== 'passage' ? { type: cible.type, id: cible.id } : { type: 'libre' }
  const dernier = trace.at(-1)
  if (!dernier) return { trace: [{ position, accroche }], termine: false }
  if (cible?.type === 'noeud' && dernier.accroche.type === 'noeud' && dernier.accroche.id === cible.id) {
    return { trace, termine: false } // même nœud que le départ : on l'ignore
  }
  if (trace.length >= 2 && memePoint(dernier.position, position)) return { trace, termine: true }
  const suivant = [...trace, { position, accroche }]
  return { trace: suivant, termine: accroche.type !== 'libre' }
}

/** Retire le dernier point (Retour arrière). */
export const retirerDernier = (trace: Trace): Trace => trace.slice(0, -1)

/** Corps du POST, ou null si le tracé n'a pas deux points. Les points intermédiaires ne s'accrochent pas. */
export function versNouveauTroncon(trace: Trace, proprietes: Pick<NouveauTroncon, 'nom' | 'voies_avant' | 'voies_arriere' | 'vitesse_kmh'>): NouveauTroncon | null {
  if (trace.length < 2) return null
  return {
    ...proprietes,
    points: trace.map((p) => p.position),
    de: trace[0]!.accroche,
    vers: trace.at(-1)!.accroche,
  }
}
