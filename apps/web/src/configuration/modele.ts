/**
 * Brouillon de configuration d'un carrefour (branches, voies, passages piétons, connexions)
 * et opérations d'édition, sans effet de bord.
 */
import {
  cleVoie,
  distanceArretGiratoire,
  genererVoies,
  RAYON_ANNEAU_DEFAUT_M,
  repereLocal,
  voieAdjacente,
  type LonLat,
  type Segment,
} from '@voirie/engine'
import type { Anneau, Branche, Connexion, PrioriteEntree, SensVoie, TypeVoie } from '@voirie/schema'

export interface Brouillon {
  branches: Branche[]
  connexions: Connexion[]
  /** Anneau d'un giratoire ; null pour un carrefour ordinaire. */
  anneau: Anneau | null
}

/** Poignée déplaçable sur la carte : extrémité d'une voie ou d'un passage piéton, centre ou bord de l'anneau. */
export type Poignee =
  | { role: 'voie'; cle: string; sens: SensVoie; extremite: 0 | 1 }
  | { role: 'traversee'; branche: string; extremite: 0 | 1 }
  | { role: 'anneau'; point: 'centre' | 'bord' }

/** Bornes du rayon extérieur d'un anneau (m), comme le schéma. */
const RAYON_ANNEAU_MIN_M = 4
const RAYON_ANNEAU_MAX_M = 150

/**
 * Où générer les voies d'une branche : depuis le centre du carrefour, ligne d'arrêt à 15 m ;
 * dans un giratoire, depuis le centre de l'îlot, ligne d'arrêt au bord de l'anneau.
 */
function origineVoies(brouillon: Brouillon, centre: LonLat): { centre: LonLat; distanceArret?: number } {
  return brouillon.anneau ? { centre: brouillon.anneau.centre, distanceArret: distanceArretGiratoire(brouillon.anneau) } : { centre }
}

export const voiesDe = (branche: Branche, sens: SensVoie) =>
  branche.voies.filter((v) => v.sens === sens).sort((a, b) => a.rang - b.rang)

const nombre = (branche: Branche, sens: SensVoie) => voiesDe(branche, sens).length

function surBranche(brouillon: Brouillon, code: string, modifier: (b: Branche) => Branche): Brouillon {
  return { ...brouillon, branches: brouillon.branches.map((b) => (b.code === code ? modifier(b) : b)) }
}

const sansVoie = (connexions: Connexion[], cle: string) => connexions.filter((c) => c.de !== cle && c.vers !== cle)

/** Ajoute une voie à côté de la dernière du même sens, sans toucher aux voies déjà calées. */
export function ajouterVoie(brouillon: Brouillon, code: string, sens: SensVoie, centre: LonLat): Brouillon {
  const origine = origineVoies(brouillon, centre)
  return surBranche(brouillon, code, (b) => {
    const existantes = voiesDe(b, sens)
    const derniere = existantes.at(-1)
    const generees = genererVoies(origine.centre, b.azimut, sens === 'entrante' ? 1 : 0, sens === 'sortante' ? 1 : 0, origine.distanceArret)
    const geom: Segment = derniere
      ? voieAdjacente(derniere.geom, sens === 'entrante' ? 'gauche' : 'droite')
      : (sens === 'entrante' ? generees.entrantes : generees.sortantes)[0]!
    return { ...b, voies: [...b.voies, { sens, rang: existantes.length, type: 'generale', geom }] }
  })
}

/** Retire la voie de plus haut rang d'un sens, et ses connexions. */
export function retirerVoie(brouillon: Brouillon, code: string, sens: SensVoie): Brouillon {
  const branche = brouillon.branches.find((b) => b.code === code)
  const derniere = branche && voiesDe(branche, sens).at(-1)
  if (!derniere) return brouillon
  const suivant = surBranche(brouillon, code, (b) => ({ ...b, voies: b.voies.filter((v) => v !== derniere) }))
  return { ...suivant, connexions: sansVoie(suivant.connexions, cleVoie(code, sens, derniere.rang)) }
}

export function changerTypeVoie(brouillon: Brouillon, code: string, sens: SensVoie, rang: number, type: TypeVoie): Brouillon {
  return surBranche(brouillon, code, (b) => ({
    ...b,
    voies: b.voies.map((v) => (v.sens === sens && v.rang === rang ? { ...v, type } : v)),
  }))
}

/** Renomme une branche et répercute le nouveau code dans les clés des connexions. */
export function renommerBranche(brouillon: Brouillon, ancien: string, nouveau: string): Brouillon {
  const renommer = (cle: string) => (cle.startsWith(`${ancien}:`) ? `${nouveau}${cle.slice(ancien.length)}` : cle)
  return {
    ...brouillon,
    branches: brouillon.branches.map((b) => (b.code === ancien ? { ...b, code: nouveau } : b)),
    connexions: brouillon.connexions.map((c) => ({ de: renommer(c.de), vers: renommer(c.vers) })),
  }
}

export function supprimerBranche(brouillon: Brouillon, code: string): Brouillon {
  return {
    ...brouillon,
    branches: brouillon.branches.filter((b) => b.code !== code),
    connexions: brouillon.connexions.filter((c) => !c.de.startsWith(`${code}:`) && !c.vers.startsWith(`${code}:`)),
  }
}

/** Ajoute la connexion, ou la retire si elle existe déjà. */
export function basculerConnexion(brouillon: Brouillon, de: string, vers: string): Brouillon {
  const existe = brouillon.connexions.some((c) => c.de === de && c.vers === vers)
  return {
    ...brouillon,
    connexions: existe
      ? brouillon.connexions.filter((c) => !(c.de === de && c.vers === vers))
      : [...brouillon.connexions, { de, vers }],
  }
}

/** Déplace l'extrémité d'une voie ou d'un passage piéton, le centre ou le bord de l'anneau (calage sur la photo). */
export function deplacerPoignee(brouillon: Brouillon, poignee: Poignee, position: LonLat): Brouillon {
  if (poignee.role === 'anneau') {
    const { anneau } = brouillon
    if (!anneau) return brouillon
    if (poignee.point === 'centre') return { ...brouillon, anneau: { ...anneau, centre: position } }
    const rayon = Math.hypot(...repereLocal(anneau.centre).versXY(position))
    const rayon_m = Math.round(Math.min(Math.max(rayon, RAYON_ANNEAU_MIN_M), RAYON_ANNEAU_MAX_M) * 10) / 10
    return { ...brouillon, anneau: { ...anneau, rayon_m } }
  }
  const remplacer = (segment: Segment): Segment =>
    poignee.extremite === 0 ? [position, segment[1]] : [segment[0], position]
  if (poignee.role === 'traversee') {
    return surBranche(brouillon, poignee.branche, (b) => (b.traversee ? { ...b, traversee: remplacer(b.traversee) } : b))
  }
  const [code] = poignee.cle.split(':')
  return surBranche(brouillon, code!, (b) => ({
    ...b,
    voies: b.voies.map((v) => (cleVoie(b.code, v.sens, v.rang) === poignee.cle ? { ...v, geom: remplacer(v.geom) } : v)),
  }))
}

/** Ajoute un passage piéton proposé en travers de la branche, ou le retire. */
export function basculerTraversee(brouillon: Brouillon, code: string, centre: LonLat): Brouillon {
  const origine = origineVoies(brouillon, centre)
  return surBranche(brouillon, code, (b) => ({
    ...b,
    traversee: b.traversee
      ? null
      : genererVoies(origine.centre, b.azimut, nombre(b, 'entrante'), nombre(b, 'sortante'), origine.distanceArret).traversee,
  }))
}

/** Replace les voies (et le passage piéton) de la branche à leur position proposée. */
export function regenererVoies(brouillon: Brouillon, code: string, centre: LonLat): Brouillon {
  const origine = origineVoies(brouillon, centre)
  return surBranche(brouillon, code, (b) => {
    const generees = genererVoies(origine.centre, b.azimut, nombre(b, 'entrante'), nombre(b, 'sortante'), origine.distanceArret)
    return {
      ...b,
      voies: b.voies.map((v) => ({ ...v, geom: (v.sens === 'entrante' ? generees.entrantes : generees.sortantes)[v.rang]! })),
      traversee: b.traversee ? generees.traversee : null,
    }
  })
}

/** Dessine un anneau proposé, centré sur le carrefour, à caler ensuite sur la photo. */
export const creerAnneau = (brouillon: Brouillon, centre: LonLat): Brouillon => ({
  ...brouillon,
  anneau: { centre, rayon_m: RAYON_ANNEAU_DEFAUT_M, voies: 1 },
})

export const retirerAnneau = (brouillon: Brouillon): Brouillon => ({
  ...brouillon,
  anneau: null,
  branches: brouillon.branches.map((b) => ({ ...b, priorite_entree: null })),
})

export const changerVoiesAnneau = (brouillon: Brouillon, voies: number): Brouillon =>
  brouillon.anneau ? { ...brouillon, anneau: { ...brouillon.anneau, voies } } : brouillon

/** Régime d'une entrée de giratoire hors feux ; cédez-le-passage, la règle par défaut, s'enregistre comme null. */
export const changerPrioriteEntree = (brouillon: Brouillon, code: string, priorite: PrioriteEntree): Brouillon =>
  surBranche(brouillon, code, (b) => ({ ...b, priorite_entree: priorite === 'cedez_le_passage' ? null : priorite }))

/** Couleurs des voies entrantes (et de leurs connexions), comme dans TM:PE. */
const PALETTE = ['#f94144', '#f3722c', '#f9c74f', '#90be6d', '#43aa8b', '#4d9de0', '#7b61ff', '#e056fd', '#ff6fb5', '#00c2d1']

export function couleursVoies(branches: Branche[]): Map<string, string> {
  const couleurs = new Map<string, string>()
  let i = 0
  for (const b of branches) {
    for (const v of voiesDe(b, 'entrante')) couleurs.set(cleVoie(b.code, 'entrante', v.rang), PALETTE[i++ % PALETTE.length]!)
  }
  return couleurs
}
