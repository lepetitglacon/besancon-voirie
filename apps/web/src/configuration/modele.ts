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
  repereLocal,
  voieAdjacente,
  type LonLat,
  type Segment,
  type XY,
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
  /** Bout d'un passage piéton : `index` dans les passages de la branche. */
  | { role: 'traversee'; branche: string; index: number; extremite: 0 | 1 }
  | { role: 'noeud'; code: string }
  /** Passage piéton entier, translaté du point de départ du geste à la position. */
  | { role: 'passage'; branche: string; index: number; depart: LonLat }
  /** Voies entières, translatées ensemble du point de départ du geste à la position. */
  | { role: 'voies'; cles: string[]; depart: LonLat }

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

/** Décale les rangs d'un sens d'une branche (`nouveauRang`, null = voie retirée) et suit les connexions. */
function renumeroter(brouillon: Brouillon, code: string, sens: SensVoie, nouveauRang: (rang: number) => number | null): Brouillon {
  const lettre = sens === 'entrante' ? 'e' : 's'
  const prefixe = `${code}:${lettre}`
  const cle = (ancienne: string): string | null => {
    if (!ancienne.startsWith(prefixe)) return ancienne
    const rang = nouveauRang(Number(ancienne.slice(prefixe.length)))
    return rang === null ? null : `${prefixe}${rang}`
  }
  const branches = brouillon.branches.map((b) =>
    b.code !== code
      ? b
      : {
          ...b,
          voies: b.voies.flatMap((v) => {
            if (v.sens !== sens) return [v]
            const rang = nouveauRang(v.rang)
            return rang === null ? [] : [{ ...v, rang }]
          }),
        },
  )
  const connexions = brouillon.connexions.flatMap((c) => {
    const de = cle(c.de)
    const vers = cle(c.vers)
    return de && vers ? [{ de, vers }] : []
  })
  return { ...brouillon, branches, connexions }
}

/**
 * Voie tracée sur la carte dans le sens de la circulation : vers le carrefour, une entrante ;
 * en s'en éloignant, une sortante. Elle rejoint la branche (hors tronçons d'anneau) dont les
 * voies sont les plus proches de son milieu, à son rang d'après sa position (0 = la plus à
 * gauche dans son sens) ; les voies à sa droite et leurs connexions sont renumérotées.
 */
export function tracerVoie(brouillon: Brouillon, trace: Segment, centre: LonLat): { brouillon: Brouillon; cle: string } | null {
  const milieu = (s: Segment): LonLat => [(s[0][0] + s[1][0]) / 2, (s[0][1] + s[1][1]) / 2]
  const repere = repereLocal(milieu(trace))
  let proche: { branche: Branche; distance: number } | null = null
  for (const b of brouillon.branches) {
    if (b.troncon) continue
    const points = b.voies.length ? b.voies.map((v) => v.geom[0]) : (b.geom ?? [])
    for (const p of points) {
      const d = Math.hypot(...repere.versXY(p))
      if (!proche || d < proche.distance) proche = { branche: b, distance: d }
    }
  }
  if (!proche) return null
  const { branche } = proche
  // Le bout le plus proche du carrefour (ou du nœud d'une rue de giratoire) est le bout côté carrefour.
  const origine = repereLocal(origineVoies(brouillon, branche, centre).centre)
  const [a, b] = trace.map((p) => origine.versXY(p)) as [XY, XY]
  const versCarrefour = Math.hypot(...b) < Math.hypot(...a)
  const sens: SensVoie = versCarrefour ? 'entrante' : 'sortante'
  const geom: Segment = versCarrefour ? [trace[1], trace[0]] : [trace[0], trace[1]]
  // Rang : nombre de voies du même sens plus à gauche, vu dans le sens de la circulation.
  const direction: XY = [b[0] - a[0], b[1] - a[1]]
  const gauche = ([x, y]: XY) => -direction[1] * x + direction[0] * y
  const cote = (s: Segment) => gauche(origine.versXY(milieu(s)))
  const rang = voiesDe(branche, sens).filter((v) => cote(v.geom) > cote(geom)).length
  const decale = renumeroter(brouillon, branche.code, sens, (r) => (r >= rang ? r + 1 : r))
  return {
    brouillon: surBranche(decale, branche.code, (br) => ({ ...br, voies: [...br.voies, { sens, rang, type: 'generale', geom }] })),
    cle: cleVoie(branche.code, sens, rang),
  }
}

/** Retire une voie (clé « S:e1 ») et ses connexions ; les voies à sa droite prennent son rang. */
export function enleverVoie(brouillon: Brouillon, cle: string): Brouillon {
  const [code, voie] = cle.split(':') as [string, string]
  const sens: SensVoie = voie.startsWith('e') ? 'entrante' : 'sortante'
  const retire = Number(voie.slice(1))
  return renumeroter(brouillon, code, sens, (r) => (r === retire ? null : r > retire ? r - 1 : r))
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
  if (poignee.role === 'passage') {
    const dLon = position[0] - poignee.depart[0]
    const dLat = position[1] - poignee.depart[1]
    return surPassage(brouillon, poignee.branche, poignee.index, (p) => p.map(([lon, lat]) => [lon + dLon, lat + dLat]) as Segment)
  }
  if (poignee.role === 'voies') {
    const dLon = position[0] - poignee.depart[0]
    const dLat = position[1] - poignee.depart[1]
    const decaler = ([lon, lat]: LonLat): LonLat => [lon + dLon, lat + dLat]
    const cles = new Set(poignee.cles)
    return {
      ...brouillon,
      branches: brouillon.branches.map((b) =>
        b.voies.some((v) => cles.has(cleVoie(b.code, v.sens, v.rang)))
          ? {
              ...b,
              voies: b.voies.map((v) =>
                cles.has(cleVoie(b.code, v.sens, v.rang)) ? { ...v, geom: [decaler(v.geom[0]), decaler(v.geom[1])] } : v,
              ),
            }
          : b,
      ),
    }
  }
  const remplacer = (segment: Segment): Segment =>
    poignee.extremite === 0 ? [position, segment[1]] : [segment[0], position]
  if (poignee.role === 'traversee') {
    return surPassage(brouillon, poignee.branche, poignee.index, remplacer)
  }
  const [code] = poignee.cle.split(':')
  return surBranche(brouillon, code!, (b) => ({
    ...b,
    voies: b.voies.map((v) => (cleVoie(b.code, v.sens, v.rang) === poignee.cle ? { ...v, geom: remplacer(v.geom) } : v)),
  }))
}

function surPassage(brouillon: Brouillon, code: string, index: number, modifier: (p: Segment) => Segment): Brouillon {
  return surBranche(brouillon, code, (b) => ({ ...b, passages: b.passages.map((p, i) => (i === index ? modifier(p) : p)) }))
}

/**
 * Passage piéton tracé sur la carte : il rejoint les passages de la branche la plus proche de
 * son milieu (bout côté carrefour de ses voies, à défaut son axe). null : aucune branche (hors
 * tronçons d'anneau) à qui le donner.
 */
export function poserTraversee(brouillon: Brouillon, segment: Segment): { brouillon: Brouillon; branche: string } | null {
  const milieu: LonLat = [(segment[0][0] + segment[1][0]) / 2, (segment[0][1] + segment[1][1]) / 2]
  const repere = repereLocal(milieu)
  const distance = (p: LonLat) => Math.hypot(...repere.versXY(p))
  let proche: { branche: Branche; distance: number } | null = null
  for (const b of brouillon.branches) {
    if (b.troncon) continue
    const points = b.voies.length ? b.voies.map((v) => v.geom[0]) : (b.geom ?? [])
    for (const p of points) {
      const d = distance(p)
      if (!proche || d < proche.distance) proche = { branche: b, distance: d }
    }
  }
  if (!proche) return null
  const { branche } = proche
  return {
    brouillon: surBranche(brouillon, branche.code, (b) => ({ ...b, passages: [...b.passages, segment] })),
    branche: branche.code,
  }
}

export function retirerTraversee(brouillon: Brouillon, code: string, index: number): Brouillon {
  return surBranche(brouillon, code, (b) => ({ ...b, passages: b.passages.filter((_, i) => i !== index) }))
}

/** Ajoute un passage piéton proposé en travers de la branche, ou retire tous ses passages. */
export function basculerTraversee(brouillon: Brouillon, code: string, centre: LonLat): Brouillon {
  return surBranche(brouillon, code, (b) => {
    if (b.troncon) return b
    const origine = origineVoies(brouillon, b, centre)
    return {
      ...b,
      passages: b.passages.length
        ? []
        : [genererVoies(origine.centre, origine.azimut, nombre(b, 'entrante'), nombre(b, 'sortante'), origine.distanceArret).traversee],
    }
  })
}

/** Replace les voies de la branche à leur position proposée ; ses passages piétons deviennent le passage proposé. */
export function regenererVoies(brouillon: Brouillon, code: string, centre: LonLat): Brouillon {
  return surBranche(brouillon, code, (b) => {
    if (b.troncon) return b
    const origine = origineVoies(brouillon, b, centre)
    const generees = genererVoies(origine.centre, origine.azimut, nombre(b, 'entrante'), nombre(b, 'sortante'), origine.distanceArret)
    return {
      ...b,
      voies: b.voies.map((v) => ({ ...v, geom: (v.sens === 'entrante' ? generees.entrantes : generees.sortantes)[v.rang]! })),
      passages: b.passages.length ? [generees.traversee] : [],
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
