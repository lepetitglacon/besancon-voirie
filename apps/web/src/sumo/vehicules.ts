import type { EssaiSumo, TronconsSumoGeoJson } from '@voirie/schema'

/** Couleurs des voitures : par état, ou par motif de déplacement (les flux ajoutés en vert). */
export const COULEURS_ETAT = { roule: '#2563eb', arretee: '#dc2626' }
export const COULEURS_MOTIF: Record<string, string> = {
  matin: '#2563eb',
  midi: '#f59e0b',
  'midi-retour': '#d97706',
  soir: '#7c3aed',
}
export const COULEUR_FLUX = '#059669'
export const LIBELLES_MOTIF: Record<string, string> = {
  matin: 'Aller du matin',
  midi: 'Sortie du midi',
  'midi-retour': 'Retour du midi',
  soir: 'Retour du soir',
}

/** Temps perdu inconnu : la voiture n'était pas arrivée à la fin de la simulation. */
const NON_ARRIVEE = 65535
/** Place d'une voiture dans une file (gabarit + écart), en m. */
const PLACE = 7.5
/** Recul de la tête de file derrière la fin du tronçon (ligne d'arrêt), en m. */
const RECUL = 3
/** Vitesse minimale supposée sur un tronçon, en m/s. */
const VITESSE_MIN = 2

export interface VoitureVue {
  /** Rang de la voiture dans le fichier. */
  i: number
  lon: number
  lat: number
  /** Cap, en degrés depuis le nord. */
  cap: number
  arretee: boolean
  motif: number
}

/** Géométrie d'un tronçon : points, distances cumulées (m) et longueur SUMO. */
interface Trace {
  points: [number, number][]
  cumul: number[]
  longueurSumo: number
  vitesseLibre: number
}

const RAYON_TERRE = 6_371_000
function distance([lon1, lat1]: [number, number], [lon2, lat2]: [number, number]): number {
  const x = ((lon2 - lon1) * Math.PI) / 180 * Math.cos((((lat1 + lat2) / 2) * Math.PI) / 180)
  const y = ((lat2 - lat1) * Math.PI) / 180
  return Math.hypot(x, y) * RAYON_TERRE
}

/**
 * Voitures d'un essai (vehicules.bin.gz) : pour chacune, son itinéraire et l'heure de sortie de
 * chaque tronçon. La position à un instant se reconstitue ainsi : la voiture roule à la vitesse
 * autorisée depuis son entrée sur le tronçon, puis attend au bout jusqu'à son heure de sortie ;
 * les voitures qui attendent sur un même tronçon se rangent en file, dans l'ordre d'arrivée.
 */
export class Vehicules {
  readonly nombre: number
  readonly motifs: string[]
  readonly depart: Float32Array
  private readonly premier: Uint32Array
  private readonly etapes: Uint16Array
  private readonly pertes: Uint16Array
  private readonly aretes: Uint16Array
  private readonly sorties: Uint16Array
  private readonly codes: Uint8Array
  private readonly traces: Trace[]
  private readonly noms: string[]

  constructor(donnees: ArrayBuffer, essai: EssaiSumo, troncons: TronconsSumoGeoJson) {
    const [n, m] = new Uint32Array(donnees, 0, 2) as unknown as [number, number]
    let decalage = 8
    const lire = <T>(Type: new (b: ArrayBuffer, o: number, l: number) => T, longueur: number, taille: number): T => {
      const tableau = new Type(donnees, decalage, longueur)
      decalage += longueur * taille
      return tableau
    }
    this.nombre = n
    this.motifs = essai.vehicules?.motifs ?? []
    this.depart = lire(Float32Array, n, 4)
    this.premier = lire(Uint32Array, n, 4)
    this.etapes = lire(Uint16Array, n, 2)
    this.pertes = lire(Uint16Array, n, 2)
    this.aretes = lire(Uint16Array, m, 2)
    this.sorties = lire(Uint16Array, m, 2)
    this.codes = lire(Uint8Array, n, 1)
    this.noms = troncons.features.map((f) => f.properties.nom)
    this.traces = troncons.features.map(({ geometry, properties }) => {
      const cumul = [0]
      for (let k = 1; k < geometry.coordinates.length; k++) {
        cumul.push(cumul[k - 1]! + distance(geometry.coordinates[k - 1]!, geometry.coordinates[k]!))
      }
      return {
        points: geometry.coordinates,
        cumul,
        longueurSumo: properties.longueur,
        vitesseLibre: Math.max(VITESSE_MIN, properties.vmax / 3.6),
      }
    })
  }

  private sortie(v: number, k: number): number {
    return this.depart[v]! + this.sorties[this.premier[v]! + k]!
  }

  arrivee(v: number): number {
    return this.sortie(v, this.etapes[v]! - 1)
  }

  /** Rang du tronçon où se trouve la voiture à l'instant t (première sortie après t). */
  private etape(v: number, t: number): number {
    let bas = 0
    let haut = this.etapes[v]! - 1
    while (bas < haut) {
      const milieu = (bas + haut) >> 1
      if (this.sortie(v, milieu) > t) haut = milieu
      else bas = milieu + 1
    }
    return bas
  }

  /** Point à `metres` du début d'un tronçon (longueur SUMO ramenée à la géométrie). */
  private point(arete: number, metres: number): { lon: number; lat: number; cap: number } {
    const { points, cumul, longueurSumo } = this.traces[arete]!
    const total = cumul[cumul.length - 1]!
    const d = Math.min(total, Math.max(0, (metres / longueurSumo) * total))
    let k = 1
    while (k < cumul.length - 1 && cumul[k]! < d) k++
    const [a, b] = [points[k - 1]!, points[k]!]
    const segment = cumul[k]! - cumul[k - 1]!
    const f = segment > 0 ? (d - cumul[k - 1]!) / segment : 0
    const cap = (Math.atan2((b[0] - a[0]) * Math.cos((a[1] * Math.PI) / 180), b[1] - a[1]) * 180) / Math.PI
    return { lon: a[0] + (b[0] - a[0]) * f, lat: a[1] + (b[1] - a[1]) * f, cap }
  }

  /** Voitures en route à l'instant t, avec leur position. */
  positions(t: number): VoitureVue[] {
    // Départs triés : seules les voitures parties avant t peuvent être en route.
    let fin = 0
    let haut = this.nombre
    while (fin < haut) {
      const milieu = (fin + haut) >> 1
      if (this.depart[milieu]! <= t) fin = milieu + 1
      else haut = milieu
    }
    // Par tronçon : les voitures présentes, avec leur heure d'entrée et la distance parcourue sans attendre.
    const parArete = new Map<number, { v: number; entree: number }[]>()
    for (let v = 0; v < fin; v++) {
      if (this.arrivee(v) <= t) continue
      const k = this.etape(v, t)
      const arete = this.aretes[this.premier[v]! + k]!
      const entree = k === 0 ? this.depart[v]! : this.sortie(v, k - 1)
      const liste = parArete.get(arete)
      if (liste) liste.push({ v, entree })
      else parArete.set(arete, [{ v, entree }])
    }
    const vues: VoitureVue[] = []
    for (const [arete, liste] of parArete) {
      const { longueurSumo, vitesseLibre } = this.traces[arete]!
      // Les premières entrées sont devant ; la file grandit depuis la ligne d'arrêt.
      liste.sort((a, b) => a.entree - b.entree)
      let queue = longueurSumo - RECUL
      for (const { v, entree } of liste) {
        const libre = vitesseLibre * (t - entree)
        const arretee = libre >= queue
        const position = arretee ? Math.max(0, queue) : libre
        if (arretee) queue -= PLACE
        vues.push({ i: v, ...this.point(arete, position), arretee, motif: this.codes[v]! })
      }
    }
    return vues
  }

  /** Fiche d'une voiture : motif, horaires, temps perdu, itinéraire. */
  fiche(v: number, t: number) {
    const debut = this.premier[v]!
    const aretes = Array.from(this.aretes.subarray(debut, debut + this.etapes[v]!))
    const perte = this.pertes[v]!
    const enRoute = this.depart[v]! <= t && t < this.arrivee(v)
    return {
      motif: this.motifs[this.codes[v]!] ?? '?',
      depart: this.depart[v]!,
      arrivee: this.arrivee(v),
      perte: perte === NON_ARRIVEE ? null : perte,
      distance: aretes.reduce((somme, a) => somme + this.traces[a]!.longueurSumo, 0),
      aretes,
      /** Rang du tronçon en cours, ou null hors de la route. */
      etape: enRoute ? this.etape(v, t) : null,
      rue: enRoute ? (this.noms[aretes[this.etape(v, t)]!] ?? '') : '',
    }
  }

  /** Tracé de l'itinéraire : déjà parcouru jusqu'à l'étape, puis à venir. */
  itineraire(aretes: number[], etape: number | null) {
    const ligne = (morceau: number[]) => morceau.flatMap((a) => this.traces[a]!.points)
    const coupure = etape ?? 0
    return {
      fait: ligne(aretes.slice(0, coupure + (etape === null ? 0 : 1))),
      reste: ligne(aretes.slice(coupure)),
    }
  }
}
