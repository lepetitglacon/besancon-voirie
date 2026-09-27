/**
 * Voies des rues à dessiner avec celles des carrefours (docs/RESEAU.md §7) : chaque tronçon
 * donne ses voies tout du long, reculées aux nœuds pour laisser la place aux liaisons, et chaque
 * nœud connaît les bouts de voies qui y arrivent et qui en repartent.
 */
import { retraitAuNoeud, voiesTroncon, type LonLat } from '@voirie/engine'
import type { ReseauGeoJson } from '@voirie/schema'

export interface VoieRue {
  /** `<tronçon>:a<rang>` (sens du tracé) ou `<tronçon>:r<rang>` (sens inverse). */
  cle: string
  troncon: string
  rang: number
  /** Dans le sens de circulation. */
  points: LonLat[]
}

/** Bout d'une voie à un nœud : `bout` est au nœud, `suivant` le point d'à côté (pour la tangente). */
export interface BoutVoie {
  troncon: string
  rang: number
  bout: LonLat
  suivant: LonLat
}

export interface GeometrieRues {
  voies: VoieRue[]
  /** Par nœud : les voies qui y arrivent (bout = fin de la voie). */
  arrivees: Map<string, BoutVoie[]>
  /** Par nœud : les voies qui en repartent (bout = début de la voie). */
  departs: Map<string, BoutVoie[]>
}

type Troncon = ReseauGeoJson['troncons']['features'][number]
type Noeud = ReseauGeoJson['noeuds']['features'][number]

const ajouter = (carte: Map<string, BoutVoie[]>, noeud: string, bout: BoutVoie) => carte.set(noeud, [...(carte.get(noeud) ?? []), bout])

export function geometrieRues(troncons: readonly Troncon[], noeuds: readonly Noeud[]): GeometrieRues {
  const parId = new Map(noeuds.map((n) => [n.id, n.properties]))
  // Voies les plus nombreuses qui arrivent à chaque nœud : plus il y en a, plus on recule.
  const voiesMax = new Map<string, number>()
  for (const t of troncons) {
    for (const n of [t.properties.noeud_de, t.properties.noeud_vers]) {
      voiesMax.set(n, Math.max(voiesMax.get(n) ?? 0, t.properties.voies_avant + t.properties.voies_arriere))
    }
  }
  // Au bord d'un carrefour configuré, le tronçon s'arrête déjà sur son cercle : pas de recul.
  const retrait = (noeud: string) => {
    const n = parId.get(noeud)
    if (n?.carrefour_id) return 0
    return retraitAuNoeud(n?.degre ?? 2, voiesMax.get(noeud) ?? 1)
  }

  const voies: VoieRue[] = []
  const arrivees = new Map<string, BoutVoie[]>()
  const departs = new Map<string, BoutVoie[]>()
  for (const t of troncons) {
    const p = t.properties
    const { avant, arriere } = voiesTroncon(t.geometry.coordinates, p.voies_avant, p.voies_arriere, retrait(p.noeud_de), retrait(p.noeud_vers))
    const enregistrer = (liste: LonLat[][], lettre: 'a' | 'r', depuis: string, jusqua: string) =>
      liste.forEach((points, rang) => {
        voies.push({ cle: `${t.id}:${lettre}${rang}`, troncon: t.id, rang, points })
        ajouter(departs, depuis, { troncon: t.id, rang, bout: points[0]!, suivant: points[1]! })
        ajouter(arrivees, jusqua, { troncon: t.id, rang, bout: points.at(-1)!, suivant: points.at(-2)! })
      })
    enregistrer(avant, 'a', p.noeud_de, p.noeud_vers)
    enregistrer(arriere, 'r', p.noeud_vers, p.noeud_de)
  }
  return { voies, arrivees, departs }
}
