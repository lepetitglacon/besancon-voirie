/**
 * Brouillon de configuration d'un carrefour (branches, voies, passages piétons, connexions)
 * et opérations d'édition, sans effet de bord.
 */
import { cleVoie, genererVoies, voieAdjacente, type LonLat, type Segment } from '@voirie/engine'
import type { Branche, Connexion, SensVoie, TypeVoie } from '@voirie/schema'

export interface Brouillon {
  branches: Branche[]
  connexions: Connexion[]
}

/** Poignée déplaçable sur la carte : extrémité d'une voie ou d'un passage piéton. */
export type Poignee =
  | { role: 'voie'; cle: string; sens: SensVoie; extremite: 0 | 1 }
  | { role: 'traversee'; branche: string; extremite: 0 | 1 }

export const voiesDe = (branche: Branche, sens: SensVoie) =>
  branche.voies.filter((v) => v.sens === sens).sort((a, b) => a.rang - b.rang)

const nombre = (branche: Branche, sens: SensVoie) => voiesDe(branche, sens).length

function surBranche(brouillon: Brouillon, code: string, modifier: (b: Branche) => Branche): Brouillon {
  return { ...brouillon, branches: brouillon.branches.map((b) => (b.code === code ? modifier(b) : b)) }
}

const sansVoie = (connexions: Connexion[], cle: string) => connexions.filter((c) => c.de !== cle && c.vers !== cle)

/** Ajoute une voie à côté de la dernière du même sens, sans toucher aux voies déjà calées. */
export function ajouterVoie(brouillon: Brouillon, code: string, sens: SensVoie, centre: LonLat): Brouillon {
  return surBranche(brouillon, code, (b) => {
    const existantes = voiesDe(b, sens)
    const derniere = existantes.at(-1)
    const generees = genererVoies(centre, b.azimut, sens === 'entrante' ? 1 : 0, sens === 'sortante' ? 1 : 0)
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
    branches: brouillon.branches.map((b) => (b.code === ancien ? { ...b, code: nouveau } : b)),
    connexions: brouillon.connexions.map((c) => ({ de: renommer(c.de), vers: renommer(c.vers) })),
  }
}

export function supprimerBranche(brouillon: Brouillon, code: string): Brouillon {
  return {
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

/** Déplace l'extrémité d'une voie ou d'un passage piéton (calage sur la photo). */
export function deplacerPoignee(brouillon: Brouillon, poignee: Poignee, position: LonLat): Brouillon {
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
  return surBranche(brouillon, code, (b) => ({
    ...b,
    traversee: b.traversee
      ? null
      : genererVoies(centre, b.azimut, nombre(b, 'entrante'), nombre(b, 'sortante')).traversee,
  }))
}

/** Replace les voies (et le passage piéton) de la branche à leur position proposée. */
export function regenererVoies(brouillon: Brouillon, code: string, centre: LonLat): Brouillon {
  return surBranche(brouillon, code, (b) => {
    const generees = genererVoies(centre, b.azimut, nombre(b, 'entrante'), nombre(b, 'sortante'))
    return {
      ...b,
      voies: b.voies.map((v) => ({ ...v, geom: (v.sens === 'entrante' ? generees.entrantes : generees.sortantes)[v.rang]! })),
      traversee: b.traversee ? generees.traversee : null,
    }
  })
}

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
