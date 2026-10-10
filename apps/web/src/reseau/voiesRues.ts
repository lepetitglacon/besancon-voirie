/**
 * Voies des rues à dessiner avec celles des carrefours (docs/RESEAU.md §7) : chaque tronçon
 * donne ses voies tout du long, reculées aux nœuds pour laisser la place aux liaisons, et chaque
 * nœud connaît les bouts de voies qui y arrivent et qui en repartent. Le bout d'une voie peut être
 * placé à la main sur la photo (docs/voies-position-visuelle.md) : seul le dessin le suit.
 */
import {
  clePlacement,
  largeurTroncon,
  largeurVoie,
  LARGEUR_VOIE_M,
  placerVoiesTroncon,
  retraitAuNoeud,
  typesVoies,
  voiesTroncon,
  type LonLat,
  type TypeVoieReseau,
} from '@voirie/engine'
import type { ReseauGeoJson } from '@voirie/schema'

export interface VoieRue {
  /** `<tronçon>:a<rang>` (sens du tracé) ou `<tronçon>:r<rang>` (sens inverse). */
  cle: string
  troncon: string
  rang: number
  type: TypeVoieReseau
  /** Largeur au sol (m) : moindre pour une voie vélo. */
  largeur: number
  /** Dans le sens de circulation, bouts placés. */
  points: LonLat[]
}

/** Bout d'une voie à un nœud : `bout` est au nœud, `suivant` le point d'à côté (pour la tangente). */
export interface BoutVoie {
  troncon: string
  rang: number
  bout: LonLat
  suivant: LonLat
}

/**
 * Bout d'une voie à un nœud, à placer (outil Placer) : `voie` est la voie à sa place automatique
 * (sens de circulation), `bout` dit lequel de ses bouts est au nœud, `place` où il est dessiné.
 */
export interface BoutAPlacer {
  noeud: string
  troncon: string
  /** Clé du placement au nœud : `<tronçon>:avant:0`… */
  cle: string
  /** Largeur au sol de la voie (m). */
  largeur: number
  extremite: 'debut' | 'fin'
  voie: LonLat[]
  place: LonLat
}

export interface GeometrieRues {
  voies: VoieRue[]
  /** Par nœud : les voies qui y arrivent (bout = fin de la voie). */
  arrivees: Map<string, BoutVoie[]>
  /** Par nœud : les voies qui en repartent (bout = début de la voie). */
  departs: Map<string, BoutVoie[]>
  /** Par nœud : largeur (m) de la plus large des rues qui y arrivent. */
  largeurs: Map<string, number>
  /** Tous les bouts de voies, à leur nœud, pour l'outil Placer. */
  bouts: BoutAPlacer[]
}

type Troncon = ReseauGeoJson['troncons']['features'][number]
type Noeud = ReseauGeoJson['noeuds']['features'][number]

const ajouter = (carte: Map<string, BoutVoie[]>, noeud: string, bout: BoutVoie) => carte.set(noeud, [...(carte.get(noeud) ?? []), bout])

export function geometrieRues(troncons: readonly Troncon[], noeuds: readonly Noeud[]): GeometrieRues {
  const parId = new Map(noeuds.map((n) => [n.id, n.properties]))
  // Rue la plus large qui arrive à chaque nœud : plus elle l'est, plus on recule.
  const largeurs = new Map<string, number>()
  for (const t of troncons) {
    for (const n of [t.properties.noeud_de, t.properties.noeud_vers]) {
      largeurs.set(n, Math.max(largeurs.get(n) ?? 0, largeurTroncon(t.properties)))
    }
  }
  const retrait = (noeud: string) => retraitAuNoeud(parId.get(noeud)?.degre ?? 2, largeurs.get(noeud) ?? LARGEUR_VOIE_M)

  const voies: VoieRue[] = []
  const arrivees = new Map<string, BoutVoie[]>()
  const departs = new Map<string, BoutVoie[]>()
  const bouts: BoutAPlacer[] = []
  for (const t of troncons) {
    const p = t.properties
    const auto = voiesTroncon(t.geometry.coordinates, p.voies_avant, p.voies_arriere, retrait(p.noeud_de), retrait(p.noeud_vers), {
      avant: p.types_avant,
      arriere: p.types_arriere,
    })
    const { avant, arriere } = placerVoiesTroncon(auto, t.id, parId.get(p.noeud_de)?.placements_voies, parId.get(p.noeud_vers)?.placements_voies)
    const enregistrer = (liste: LonLat[][], lettre: 'a' | 'r', depuis: string, jusqua: string) =>
      liste.forEach((points, rang) => {
        const sens = lettre === 'a' ? 'avant' : 'arriere'
        const types = lettre === 'a' ? typesVoies(p.voies_avant, p.types_avant) : typesVoies(p.voies_arriere, p.types_arriere)
        const type = types[rang] ?? 'generale'
        voies.push({ cle: `${t.id}:${lettre}${rang}`, troncon: t.id, rang, type, largeur: largeurVoie(type), points })
        ajouter(departs, depuis, { troncon: t.id, rang, bout: points[0]!, suivant: points[1]! })
        ajouter(arrivees, jusqua, { troncon: t.id, rang, bout: points.at(-1)!, suivant: points.at(-2)! })
        const voie = auto[sens][rang]!
        const cle = clePlacement(t.id, sens, rang)
        const commun = { troncon: t.id, cle, largeur: largeurVoie(type), voie }
        bouts.push({ ...commun, noeud: depuis, extremite: 'debut', place: points[0]! })
        bouts.push({ ...commun, noeud: jusqua, extremite: 'fin', place: points.at(-1)! })
      })
    enregistrer(avant, 'a', p.noeud_de, p.noeud_vers)
    enregistrer(arriere, 'r', p.noeud_vers, p.noeud_de)
  }
  return { voies, arrivees, departs, largeurs, bouts }
}
