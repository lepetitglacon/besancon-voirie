import {
  estimerPositionTram,
  extraire,
  lisserDistance,
  PARAMETRES_TRAM,
  pointADistance,
  preparerPolyligne,
  type Coordonnees,
  type ParametresPosition,
  type Polyligne,
} from '@voirie/engine'
import type {
  HistoriqueTroncons,
  ParcoursTram,
  ReseauTram,
  TramEnCirculation,
  TramsTempsReel,
} from '@voirie/schema'

interface Entite<G, P> {
  type: 'Feature'
  geometry: G
  properties: P
}

export interface Collection<G, P> {
  type: 'FeatureCollection'
  features: Array<Entite<G, P>>
}

type Ligne = { type: 'LineString'; coordinates: Coordonnees[] }
type Point = { type: 'Point'; coordinates: Coordonnees }

export interface ProprietesRame {
  vehicule: string
  ligne: string
  couleur: string
  couleurTexte: string
  destination: string
  etat: TramEnCirculation['etat']
  arretPrecedent: string | null
  arretSuivant: string
  /** Temps avant l'arrivée à l'arrêt suivant (ou le départ du terminus), en s. */
  restant: number
  /** Vitesse de roulage moyenne du tronçon, en km/h. */
  vitesse: number
  /** Longueur de la zone où la rame peut se trouver, en m. */
  zone: number
  /** Rame à quai à l'arrêt précédent (arrêt en station) ou suivant (arrivée prévue passée). */
  aQuai?: 'precedent' | 'suivant'
  /** Temps avant le départ d'une rame à quai à l'arrêt précédent, en s. */
  departDans?: number
  sourceDuree: TramEnCirculation['sourceDuree']
  /** Passages observés derrière la durée du tronçon (`historique`). */
  echantillons?: number
}

export interface ReseauPrepare {
  parcours: Map<string, { infos: ParcoursTram; ligne: Polyligne; distances: Map<string, number> }>
  lignes: Collection<Ligne, { couleur: string }>
  arrets: Collection<Point, { nom: string; couleur: string }>
}

export function preparerReseau(reseau: ReseauTram): ReseauPrepare {
  return {
    parcours: new Map(
      reseau.parcours.map((infos) => [
        infos.id,
        {
          infos,
          ligne: preparerPolyligne(infos.coordonnees),
          distances: new Map(infos.arrets.map((arret) => [arret.id, arret.distance])),
        },
      ]),
    ),
    lignes: {
      type: 'FeatureCollection',
      features: reseau.parcours.map((infos) => ({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: infos.coordonnees },
        properties: { couleur: infos.couleur },
      })),
    },
    arrets: {
      type: 'FeatureCollection',
      features: reseau.parcours.flatMap((infos) =>
        infos.arrets.map((arret) => ({
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: arret.coordonnees },
          properties: { nom: arret.nom, couleur: infos.couleur },
        })),
      ),
    },
  }
}

/** Dernière position affichée de chaque rame (par véhicule), pour lisser la suivante. */
export type SuiviRames = Map<string, { parcours: string; distance: number; instant: number }>

/** Position estimée d'une rame dans son tronçon, à l'instant `maintenant` (ms epoch). */
function estimer(
  tram: TramEnCirculation,
  maintenant: number,
  age: number,
  calibration: TramsTempsReel['calibration'],
  parametres: ParametresPosition = PARAMETRES_TRAM,
) {
  const restant = (tram.arrivee - maintenant) / 1000
  const position = estimerPositionTram(
    {
      longueur: tram.fin - tram.debut,
      duree: tram.duree,
      dureeRapide: tram.dureeRapide,
      dureeLente: tram.dureeLente,
    },
    restant,
    age,
    calibration,
    parametres,
  )
  return { restant, position }
}

/** Rame repérée par sa distance le long de son parcours (priorité tram aux carrefours). */
export interface RameSurParcours {
  vehicule: string
  parcours: string
  /** Distance estimée depuis le début du tracé, en m. */
  distance: number
  /** Vitesse de roulage du tronçon, en m/s. */
  vitesse: number
  etat: TramEnCirculation['etat']
  /** Temps avant le départ d'une rame à quai, en s. */
  departDans?: number
}

/** Distance estimée de chaque rame le long de son parcours, sans lissage. */
export function rames(reseau: ReseauPrepare, { horodatage, trams, calibration }: TramsTempsReel, maintenant: number): RameSurParcours[] {
  const age = (maintenant - horodatage) / 1000
  return trams.flatMap((tram) => {
    if (!reseau.parcours.has(tram.parcours)) return []
    const { position } = estimer(tram, maintenant, age, calibration)
    return [
      {
        vehicule: tram.vehicule,
        parcours: tram.parcours,
        distance: tram.debut + position.distance,
        vitesse: position.vitesse,
        etat: tram.etat,
        ...(position.departDans !== undefined && { departDans: position.departDans }),
      },
    ]
  })
}

/**
 * Position estimée de chaque rame, et sa zone probable, à l'instant `maintenant` (ms epoch).
 * Avec `suivi`, la position affichée est lissée d'une image à l'autre, et `suivi` mis à jour.
 * Sert aussi aux bus, avec leurs `parametres` ; un véhicule hors de `reseau` est ignoré.
 */
export function positionnerRames(
  reseau: ReseauPrepare,
  { horodatage, trams, calibration }: TramsTempsReel,
  maintenant: number,
  suivi?: SuiviRames,
  parametres?: ParametresPosition,
): { zones: Collection<Ligne, { couleur: string }>; rames: Collection<Point, ProprietesRame> } {
  const zones: Collection<Ligne, { couleur: string }> = { type: 'FeatureCollection', features: [] }
  const rames: Collection<Point, ProprietesRame> = { type: 'FeatureCollection', features: [] }
  const age = (maintenant - horodatage) / 1000

  for (const tram of trams) {
    const parcours = reseau.parcours.get(tram.parcours)
    if (!parcours) continue
    const { restant, position } = estimer(tram, maintenant, age, calibration, parametres)
    const debutZone = tram.debut + position.distanceMin
    const finZone = tram.debut + position.distanceMax
    if (tram.etat === 'en_ligne' && finZone - debutZone > 1) {
      zones.features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: extraire(parcours.ligne, debutZone, finZone) },
        properties: { couleur: parcours.infos.couleur },
      })
    }
    let distance = tram.debut + position.distance
    if (suivi) {
      const precedente = suivi.get(tram.vehicule)
      if (precedente?.parcours === tram.parcours) {
        distance = lisserDistance(precedente.distance, distance, (maintenant - precedente.instant) / 1000)
      }
      suivi.set(tram.vehicule, { parcours: tram.parcours, distance, instant: maintenant })
    }
    rames.features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: pointADistance(parcours.ligne, distance) },
      properties: {
        vehicule: tram.vehicule,
        ligne: parcours.infos.ligne,
        couleur: parcours.infos.couleur,
        couleurTexte: parcours.infos.couleurTexte,
        destination: parcours.infos.destination,
        etat: tram.etat,
        arretPrecedent: tram.arretPrecedent,
        arretSuivant: tram.arretSuivant,
        restant: Math.round(restant),
        vitesse: Math.round(position.vitesse * 3.6),
        zone: Math.round(finZone - debutZone),
        ...(position.aQuai && { aQuai: position.aQuai }),
        ...(position.departDans !== undefined && { departDans: Math.ceil(position.departDans) }),
        sourceDuree: tram.sourceDuree,
        ...(tram.echantillons !== undefined && { echantillons: tram.echantillons }),
      },
    })
  }
  if (suivi) {
    const presents = new Set(trams.map((tram) => tram.vehicule))
    for (const vehicule of suivi.keys()) if (!presents.has(vehicule)) suivi.delete(vehicule)
  }
  return { zones, rames }
}

export interface ProprietesTroncon {
  ligne: string
  depart: string
  arrivee: string
  n: number
  /** Durées observées (s) : médiane, rapide (p10), lente (p90), et quand ça roule bien. */
  p50: number
  p10: number
  p90: number
  reference: number
  /** Temps perdu habituel : médiane moins référence, en s. */
  perte: number
  /** Vitesse commerciale médiane, en km/h. */
  vitesse: number
}

/** Tronçons observés, tracés le long de la voie, avec leur temps perdu. */
export function tronconsObserves(
  reseau: ReseauPrepare,
  { troncons }: HistoriqueTroncons,
): Collection<Ligne, ProprietesTroncon> {
  const features: Collection<Ligne, ProprietesTroncon>['features'] = []
  for (const troncon of troncons) {
    const parcours = reseau.parcours.get(troncon.parcours)
    const debut = parcours?.distances.get(troncon.depart)
    const fin = parcours?.distances.get(troncon.arrivee)
    if (!parcours || debut === undefined || fin === undefined || fin <= debut) continue
    const nom = (id: string) => parcours.infos.arrets.find((arret) => arret.id === id)?.nom ?? id
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: extraire(parcours.ligne, debut, fin) },
      properties: {
        ligne: parcours.infos.ligne,
        depart: nom(troncon.depart),
        arrivee: nom(troncon.arrivee),
        n: troncon.n,
        p50: Math.round(troncon.p50),
        p10: Math.round(troncon.p10),
        p90: Math.round(troncon.p90),
        reference: Math.round(troncon.reference),
        perte: Math.max(Math.round(troncon.p50 - troncon.reference), 0),
        vitesse: Math.round(((fin - debut) / troncon.p50) * 3.6),
      },
    })
  }
  return { type: 'FeatureCollection', features }
}
