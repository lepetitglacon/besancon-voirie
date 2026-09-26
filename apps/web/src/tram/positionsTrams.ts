import {
  estimerPositionTram,
  extraire,
  lisserDistance,
  pointADistance,
  preparerPolyligne,
  type Coordonnees,
  type Polyligne,
} from '@voirie/engine'
import type { ParcoursTram, ReseauTram, TramEnCirculation, TramsTempsReel } from '@voirie/schema'

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
}

export interface ReseauPrepare {
  parcours: Map<string, { infos: ParcoursTram; ligne: Polyligne }>
  lignes: Collection<Ligne, { couleur: string }>
  arrets: Collection<Point, { nom: string; couleur: string }>
}

export function preparerReseau(reseau: ReseauTram): ReseauPrepare {
  return {
    parcours: new Map(
      reseau.parcours.map((infos) => [infos.id, { infos, ligne: preparerPolyligne(infos.coordonnees) }]),
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

/**
 * Position estimée de chaque rame, et sa zone probable, à l'instant `maintenant` (ms epoch).
 * Avec `suivi`, la position affichée est lissée d'une image à l'autre, et `suivi` mis à jour.
 */
export function positionnerRames(
  reseau: ReseauPrepare,
  { horodatage, trams }: TramsTempsReel,
  maintenant: number,
  suivi?: SuiviRames,
): { zones: Collection<Ligne, { couleur: string }>; rames: Collection<Point, ProprietesRame> } {
  const zones: Collection<Ligne, { couleur: string }> = { type: 'FeatureCollection', features: [] }
  const rames: Collection<Point, ProprietesRame> = { type: 'FeatureCollection', features: [] }
  const age = (maintenant - horodatage) / 1000

  for (const tram of trams) {
    const parcours = reseau.parcours.get(tram.parcours)
    if (!parcours) continue
    const restant = (tram.arrivee - maintenant) / 1000
    const position = estimerPositionTram(
      { longueur: tram.fin - tram.debut, duree: tram.duree },
      restant,
      age,
    )
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
        destination: parcours.infos.destination,
        etat: tram.etat,
        arretPrecedent: tram.arretPrecedent,
        arretSuivant: tram.arretSuivant,
        restant: Math.round(restant),
        vitesse: Math.round(position.vitesse * 3.6),
        zone: Math.round(finZone - debutZone),
        ...(position.aQuai && { aQuai: position.aQuai }),
        ...(position.departDans !== undefined && { departDans: Math.ceil(position.departDans) }),
      },
    })
  }
  if (suivi) {
    const presents = new Set(trams.map((tram) => tram.vehicule))
    for (const vehicule of suivi.keys()) if (!presents.has(vehicule)) suivi.delete(vehicule)
  }
  return { zones, rames }
}
