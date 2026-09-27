/**
 * Brouillon de configuration d'un carrefour (branches, voies, passages piétons, connexions)
 * et opérations d'édition, sans effet de bord.
 */
import {
  azimutSegment,
  branchesTroncons,
  cleVoie,
  codeNoeudLibre,
  distanceArretNoeud,
  genererVoies,
  insererNoeud,
  NOEUDS_MIN,
  noeudDeVoie,
  proposerLiaisonsNoeuds,
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

/** Poignée déplaçable sur la carte : extrémité d'une voie ou d'un passage piéton, nœud d'anneau. */
export type Poignee =
  | { role: 'voie'; cle: string; sens: SensVoie; extremite: 0 | 1 }
  | { role: 'traversee'; branche: string; extremite: 0 | 1 }
  | { role: 'noeud'; code: string }

/**
 * Où générer les voies d'une branche : depuis le centre du carrefour, ligne d'arrêt à 15 m ;
 * pour une rue de giratoire, depuis son nœud, ligne d'arrêt au bord de l'anneau.
 */
function origineVoies(brouillon: Brouillon, branche: Branche, centre: LonLat): { centre: LonLat; azimut: number; distanceArret?: number } {
  const noeud = !branche.troncon && brouillon.anneau?.noeuds.find((n) => n.code === branche.noeud)
  if (!noeud) return { centre, azimut: branche.azimut }
  // Axe : du nœud vers le bout de la rue (son axe OSM, ou ses voies), à défaut son azimut.
  const bout = branche.geom?.at(-1) ?? branche.voies[0]?.geom[1]
  const azimut = bout ? azimutSegment([noeud.position, bout]) : branche.azimut
  const voiesAnneau = Math.max(1, ...brouillon.branches.filter((b) => b.troncon).map((b) => voiesDe(b, 'sortante').length))
  return { centre: noeud.position, azimut, distanceArret: distanceArretNoeud(voiesAnneau) }
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
  return surBranche(brouillon, code, (b) => {
    const origine = origineVoies(brouillon, b, centre)
    const existantes = voiesDe(b, sens)
    const derniere = existantes.at(-1)
    const generees = genererVoies(origine.centre, origine.azimut, sens === 'entrante' ? 1 : 0, sens === 'sortante' ? 1 : 0, origine.distanceArret)
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

/** Déplace l'extrémité d'une voie ou d'un passage piéton, ou un nœud d'anneau (calage sur la photo). */
export function deplacerPoignee(brouillon: Brouillon, poignee: Poignee, position: LonLat): Brouillon {
  if (poignee.role === 'noeud') {
    const { anneau } = brouillon
    if (!anneau) return brouillon
    return appliquerAnneau(brouillon, { noeuds: anneau.noeuds.map((n) => (n.code === poignee.code ? { ...n, position } : n)) })
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
  return surBranche(brouillon, code, (b) => {
    if (b.troncon) return b
    const origine = origineVoies(brouillon, b, centre)
    return {
      ...b,
      traversee: b.traversee
        ? null
        : genererVoies(origine.centre, origine.azimut, nombre(b, 'entrante'), nombre(b, 'sortante'), origine.distanceArret).traversee,
    }
  })
}

/** Replace les voies (et le passage piéton) de la branche à leur position proposée. */
export function regenererVoies(brouillon: Brouillon, code: string, centre: LonLat): Brouillon {
  return surBranche(brouillon, code, (b) => {
    if (b.troncon) return b
    const origine = origineVoies(brouillon, b, centre)
    const generees = genererVoies(origine.centre, origine.azimut, nombre(b, 'entrante'), nombre(b, 'sortante'), origine.distanceArret)
    return {
      ...b,
      voies: b.voies.map((v) => ({ ...v, geom: (v.sens === 'entrante' ? generees.entrantes : generees.sortantes)[v.rang]! })),
      traversee: b.traversee ? generees.traversee : null,
    }
  })
}

// ── Giratoire : nœuds et tronçons d'anneau (docs/CONFIGURATION.md §7) ──

type AnneauBrouillon = Brouillon['anneau'] & {}

/** Nombre de voies de chaque tronçon d'anneau (code → voies). */
const voiesTroncons = (brouillon: Brouillon) =>
  new Map(brouillon.branches.filter((b) => b.troncon).map((b) => [b.code, Math.max(voiesDe(b, 'sortante').length, 1)]))

/**
 * Recalcule les tronçons d'anneau d'après les nœuds (en gardant leur nombre de voies), et ne
 * garde que les liaisons encore valides : voies existantes, au même nœud. `renommer` : clés de
 * voie à réécrire d'abord (un tronçon qui change de nœud de départ change de code).
 */
function appliquerAnneau(
  brouillon: Brouillon,
  anneau: AnneauBrouillon | null,
  voies: ReadonlyMap<string, number> = voiesTroncons(brouillon),
  renommer: (cle: string) => string = (cle) => cle,
): Brouillon {
  const codes = new Set(anneau?.noeuds.map((n) => n.code))
  const rues = brouillon.branches
    .filter((b) => !b.troncon)
    .map((b) => (b.noeud && !codes.has(b.noeud) ? { ...b, noeud: null } : b))
    .map((b) => (anneau ? b : { ...b, priorite_entree: null }))
  const troncons = anneau && anneau.noeuds.length >= NOEUDS_MIN ? branchesTroncons(anneau, voies) : []
  const branches: Branche[] = [...rues, ...troncons]
  const cles = new Set(branches.flatMap((b) => b.voies.map((v) => cleVoie(b.code, v.sens, v.rang))))
  const vues = new Set<string>()
  const connexions = brouillon.connexions
    .map((c) => ({ de: renommer(c.de), vers: renommer(c.vers) }))
    .filter((c) => cles.has(c.de) && cles.has(c.vers))
    .filter((c) => !anneau || troncons.length === 0 || noeudDeVoie(c.de, branches, anneau) === noeudDeVoie(c.vers, branches, anneau))
    .filter((c) => !vues.has(`${c.de}>${c.vers}`) && vues.add(`${c.de}>${c.vers}`))
  return { branches, connexions, anneau }
}

/** Ajoute les liaisons par défaut d'un nœud (continuer, sortir, s'insérer) qui manquent. */
function completerLiaisons(brouillon: Brouillon, noeud: string, rue?: string): Brouillon {
  const { anneau } = brouillon
  if (!anneau) return brouillon
  const existantes = new Set(brouillon.connexions.map((c) => `${c.de}>${c.vers}`))
  const nouvelles = proposerLiaisonsNoeuds(brouillon.branches, anneau).filter(
    (c) =>
      noeudDeVoie(c.de, brouillon.branches, anneau) === noeud &&
      (!rue || c.de.startsWith(`${rue}:`) || c.vers.startsWith(`${rue}:`)) &&
      !existantes.has(`${c.de}>${c.vers}`),
  )
  return { ...brouillon, connexions: [...brouillon.connexions, ...nouvelles] }
}

/**
 * Pose un nœud d'anneau : il s'insère dans la boucle là où il l'allonge le moins. Le tronçon
 * qu'il coupe en deux garde ses liaisons au départ ; celles de l'arrivée passent au nouveau
 * tronçon, et le nouveau nœud reçoit les liaisons par défaut.
 */
export function poserNoeud(brouillon: Brouillon, position: LonLat): Brouillon {
  const avant = brouillon.anneau ?? { noeuds: [] }
  const code = codeNoeudLibre(avant)
  const apres = { noeuds: [...insererNoeud(avant, { code, position }).noeuds] }
  const index = apres.noeuds.findIndex((n) => n.code === code)
  const precedent = apres.noeuds[(index - 1 + apres.noeuds.length) % apres.noeuds.length]!
  const voies = new Map(voiesTroncons(brouillon))
  voies.set(`R${code}`, voies.get(`R${precedent.code}`) ?? 1)
  const coupe = avant.noeuds.length >= NOEUDS_MIN
  const suivant = appliquerAnneau(brouillon, apres, voies, (cle) =>
    coupe && cle.startsWith(`R${precedent.code}:e`) ? `R${code}${cle.slice(`R${precedent.code}`.length)}` : cle,
  )
  // La boucle se ferme au troisième nœud : chaque nœud reçoit ses liaisons ; ensuite, seul le nouveau.
  if (avant.noeuds.length === NOEUDS_MIN - 1) return apres.noeuds.reduce((b, n) => completerLiaisons(b, n.code), suivant)
  return coupe ? completerLiaisons(suivant, code) : suivant
}

/**
 * Retire un nœud : le tronçon qui y arrivait va jusqu'au nœud suivant et reprend les liaisons
 * de celui qui en partait ; les rues raccordées au nœud ne le sont plus.
 */
export function supprimerNoeud(brouillon: Brouillon, code: string): Brouillon {
  const { anneau } = brouillon
  if (!anneau) return brouillon
  const index = anneau.noeuds.findIndex((n) => n.code === code)
  if (index < 0) return brouillon
  const precedent = anneau.noeuds[(index - 1 + anneau.noeuds.length) % anneau.noeuds.length]!
  const reste = { noeuds: anneau.noeuds.filter((n) => n.code !== code) }
  // Les liaisons au nœud retiré partent avec lui : sans renommage, leurs voies n'existent plus.
  const sansNoeud = {
    ...brouillon,
    connexions: brouillon.connexions.filter((c) => noeudDeVoie(c.de, brouillon.branches, anneau) !== code),
  }
  return appliquerAnneau(sansNoeud, reste, voiesTroncons(brouillon), (cle) =>
    cle.startsWith(`R${code}:e`) ? `R${precedent.code}${cle.slice(`R${code}`.length)}` : cle,
  )
}

/** Retire l'anneau : il n'y a plus de nœuds ni de tronçons, les rues ne sont plus raccordées. */
export const retirerAnneau = (brouillon: Brouillon): Brouillon => appliquerAnneau(brouillon, null)

/** Nombre de voies du tronçon d'anneau qui part d'un nœud. */
export function changerVoiesTroncon(brouillon: Brouillon, code: string, voies: number): Brouillon {
  if (!brouillon.anneau) return brouillon
  return appliquerAnneau(brouillon, brouillon.anneau, new Map(voiesTroncons(brouillon)).set(code, voies))
}

/** Raccorde une rue à un nœud (null : à aucun, pour le tram qui traverse l'îlot) et lui propose ses liaisons. */
export function raccorderBranche(brouillon: Brouillon, code: string, noeud: string | null): Brouillon {
  const raccordee = appliquerAnneau(surBranche(brouillon, code, (b) => ({ ...b, noeud })), brouillon.anneau)
  return noeud ? completerLiaisons(raccordee, noeud, code) : raccordee
}

/** Remplace les liaisons d'un nœud par celles proposées par défaut. */
export function reproposerLiaisons(brouillon: Brouillon, noeud: string): Brouillon {
  const { anneau } = brouillon
  if (!anneau) return brouillon
  const autres = brouillon.connexions.filter((c) => noeudDeVoie(c.de, brouillon.branches, anneau) !== noeud)
  return completerLiaisons({ ...brouillon, connexions: autres }, noeud)
}

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
