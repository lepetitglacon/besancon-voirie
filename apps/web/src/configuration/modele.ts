/**
 * Brouillon de configuration d'un carrefour (branches, voies, passages piétons, connexions)
 * et opérations d'édition, sans effet de bord.
 */
import {
  cleVoie,
  codeCardinal,
  distanceArretGiratoire,
  genererVoies,
  lireCleVoie,
  normaliserAngle,
  RAYON_ANNEAU_DEFAUT_M,
  repereLocal,
  voieAdjacente,
  type LonLat,
  type Segment,
  type XY,
} from '@voirie/engine'
import type { Anneau, Branche, Connexion, PrioriteEntree, SensVoie, TypeVoie, Voie } from '@voirie/schema'

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

// ── Voies tracées à la main ──

/** Écart d'azimut (°) au-delà duquel une voie tracée ouvre une nouvelle branche. */
export const ECART_BRANCHE_MAX = 30
/** Longueur minimale (m) d'une voie tracée : en dessous, le geste est un simple clic. */
export const LONGUEUR_TRACE_MIN_M = 3
/** Rang maximal d'une voie (la clé n'a qu'un chiffre). */
const RANG_MAX = 9

const RAD = Math.PI / 180

/** Azimut (°) d'un segment, de son premier point vers le second. */
export function azimutSegment([a, b]: Segment): number {
  const [x, y] = repereLocal(a).versXY(b)
  return (Math.atan2(x, y) / RAD + 360) % 360
}

const ecartAzimut = (a: number, b: number) => Math.abs(normaliserAngle(a - b))

/**
 * Position latérale d'une voie vue par son conducteur : plus elle est grande, plus la voie est
 * à gauche. Rang 0 = la plus à gauche, donc les rangs suivent cette valeur décroissante.
 */
function aGauche(centre: LonLat, azimut: number, sens: SensVoie, geom: Segment): number {
  const repere = repereLocal(centre)
  const [ax, ay] = repere.versXY(geom[0])
  const [bx, by] = repere.versXY(geom[1])
  const u: XY = [Math.sin(azimut * RAD), Math.cos(azimut * RAD)]
  // L'entrante roule vers le centre (−u), la sortante s'en éloigne (u) ; gauche = rotation de +90°.
  const t: XY = sens === 'entrante' ? [-u[0], -u[1]] : u
  const gauche: XY = [-t[1], t[0]]
  return ((ax + bx) / 2) * gauche[0] + ((ay + by) / 2) * gauche[1]
}

/** Sens déduit de la position : vues du centre vers la branche, entrantes à gauche de l'axe. */
function sensDeduit(centre: LonLat, azimut: number, geom: Segment): SensVoie {
  return aGauche(centre, azimut, 'sortante', geom) > 0 ? 'entrante' : 'sortante'
}

/** Renomme des clés de voie dans les connexions (les clés absentes de `renommage` ne bougent pas). */
function renommerConnexions(connexions: Connexion[], renommage: Map<string, string>): Connexion[] {
  const cle = (c: string) => renommage.get(c) ?? c
  return connexions.map((c) => ({ de: cle(c.de), vers: cle(c.vers) }))
}

/**
 * Insère une voie dans une branche, au rang que donne sa position, sans déplacer les voies déjà
 * calées : les voies du même sens plus à droite prennent le rang suivant, connexions comprises.
 * Null si la branche est pleine.
 */
function insererVoie(
  brouillon: Brouillon,
  code: string,
  voie: Omit<Voie, 'rang'>,
  centre: LonLat,
): { brouillon: Brouillon; cle: string } | null {
  const branche = brouillon.branches.find((b) => b.code === code)
  if (!branche) return null
  const memeSens = voiesDe(branche, voie.sens)
  if (memeSens.length > RANG_MAX || branche.voies.length >= 16) return null
  const position = aGauche(centre, branche.azimut, voie.sens, voie.geom)
  const rang = memeSens.filter((v) => aGauche(centre, branche.azimut, voie.sens, v.geom) > position).length
  const renommage = new Map(
    memeSens.filter((v) => v.rang >= rang).map((v) => [cleVoie(code, voie.sens, v.rang), cleVoie(code, voie.sens, v.rang + 1)]),
  )
  const suivant = surBranche(brouillon, code, (b) => ({
    ...b,
    voies: [...b.voies.map((v) => (v.sens === voie.sens && v.rang >= rang ? { ...v, rang: v.rang + 1 } : v)), { ...voie, rang }],
  }))
  return { brouillon: { ...suivant, connexions: renommerConnexions(suivant.connexions, renommage) }, cle: cleVoie(code, voie.sens, rang) }
}

/** Retire une voie quelconque et ses connexions ; les voies suivantes du même sens remontent d'un rang. */
export function supprimerVoie(brouillon: Brouillon, cle: string): Brouillon {
  const lue = lireCleVoie(cle)
  const branche = lue && brouillon.branches.find((b) => b.code === lue.branche)
  if (!lue || !branche) return brouillon
  const renommage = new Map(
    voiesDe(branche, lue.sens)
      .filter((v) => v.rang > lue.rang)
      .map((v) => [cleVoie(branche.code, lue.sens, v.rang), cleVoie(branche.code, lue.sens, v.rang - 1)]),
  )
  const suivant = surBranche(brouillon, branche.code, (b) => ({
    ...b,
    voies: b.voies
      .filter((v) => !(v.sens === lue.sens && v.rang === lue.rang))
      .map((v) => (v.sens === lue.sens && v.rang > lue.rang ? { ...v, rang: v.rang - 1 } : v)),
  }))
  return { ...suivant, connexions: renommerConnexions(sansVoie(suivant.connexions, cle), renommage) }
}

/** Code libre pour une nouvelle branche : point cardinal de l'azimut, suffixé s'il est pris (N, N2…). */
function codeLibre(branches: Branche[], azimut: number): string {
  const base = codeCardinal(azimut)
  const pris = new Set(branches.map((b) => b.code))
  for (let n = 1; ; n++) {
    const code = n === 1 ? base : `${base}${n}`
    if (!pris.has(code)) return code
  }
}

/** Branche sans voie, ajoutée à la main dans la direction donnée. */
export function ajouterBranche(brouillon: Brouillon, azimut: number): { brouillon: Brouillon; code: string } {
  const code = codeLibre(brouillon.branches, azimut)
  const branche: Branche = {
    code,
    nom: null,
    azimut: Math.round(azimut * 10) / 10,
    osm_way_id: null,
    geom: null,
    voies: [],
    traversee: null,
    priorite_entree: null,
  }
  return { brouillon: { ...brouillon, branches: [...brouillon.branches, branche] }, code }
}

/**
 * Voie tracée à la main sur la photo, du bout côté carrefour vers le bout éloigné. Elle rejoint
 * la branche dont l'azimut est le plus proche (à 30° près), ou en ouvre une nouvelle ; son sens
 * se déduit de son côté de l'axe (entrante pour une nouvelle branche) et son rang de sa position.
 * Null si le trait est trop court ou la branche pleine.
 */
export function tracerVoie(brouillon: Brouillon, geom: Segment, centreCarrefour: LonLat): { brouillon: Brouillon; cle: string } | null {
  // Giratoire : les branches rayonnent depuis le centre de l'îlot.
  const { centre } = origineVoies(brouillon, centreCarrefour)
  const [x, y] = repereLocal(geom[0]).versXY(geom[1])
  if (Math.hypot(x, y) < LONGUEUR_TRACE_MIN_M) return null
  // L'azimut d'une branche se mesure depuis le centre : on vise le bout éloigné de la voie.
  const azimut = azimutSegment([centre, geom[1]])
  const proche = brouillon.branches
    .map((b) => ({ b, ecart: ecartAzimut(b.azimut, azimut) }))
    .filter(({ ecart }) => ecart <= ECART_BRANCHE_MAX)
    .sort((p, q) => p.ecart - q.ecart)[0]?.b
  if (proche) {
    return insererVoie(brouillon, proche.code, { sens: sensDeduit(centre, proche.azimut, geom), type: 'generale', geom }, centre)
  }
  const nouvelle = ajouterBranche(brouillon, azimut)
  return insererVoie(nouvelle.brouillon, nouvelle.code, { sens: 'entrante', type: 'generale', geom }, centre)
}

/** Déplace une voie vers un autre sens ou une autre branche ; ses connexions sont retirées. */
export function deplacerVoie(
  brouillon: Brouillon,
  cle: string,
  cible: { branche: string; sens: SensVoie },
  centreCarrefour: LonLat,
): { brouillon: Brouillon; cle: string } | null {
  const { centre } = origineVoies(brouillon, centreCarrefour)
  const lue = lireCleVoie(cle)
  const voie = lue && brouillon.branches.find((b) => b.code === lue.branche)?.voies.find((v) => v.sens === lue.sens && v.rang === lue.rang)
  if (!lue || !voie) return null
  if (lue.branche === cible.branche && lue.sens === cible.sens) return { brouillon, cle }
  return insererVoie(supprimerVoie(brouillon, cle), cible.branche, { sens: cible.sens, type: voie.type, geom: voie.geom }, centre)
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
