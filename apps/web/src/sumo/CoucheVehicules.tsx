import type { GeoJSONSource, MapLayerMouseEvent } from 'maplibre-gl'
import { useEffect } from 'react'
import { Layer, Source, useMap, type CircleLayerSpecification } from 'react-map-gl/maplibre'
import { etatSumo, useDonneesEssai, useEtatSumo } from './etat'
import { COULEUR_FLUX, COULEURS_ETAT, COULEURS_MOTIF, type VoitureVue } from './vehicules'

const SOURCE = 'sumo-vehicules'
const SOURCE_ITINERAIRE = 'sumo-itineraire'
const VIDE = { type: 'FeatureCollection' as const, features: [] }

function couche(couleur: 'etat' | 'motif', motifs: string[]): CircleLayerSpecification {
  const parMotif = [
    'match',
    ['get', 'motif'],
    ...motifs.flatMap((m, k) => [k, COULEURS_MOTIF[m] ?? COULEUR_FLUX]),
    COULEUR_FLUX,
  ]
  return {
    id: SOURCE,
    type: 'circle',
    source: SOURCE,
    paint: {
      'circle-color': (couleur === 'etat'
        ? ['case', ['get', 'arretee'], COULEURS_ETAT.arretee, COULEURS_ETAT.roule]
        : motifs.length
          ? parMotif
          : COULEUR_FLUX) as unknown as string,
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 1.2, 14, 2.5, 17, 6] as unknown as number,
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 13, 0, 16, 1] as unknown as number,
    },
  }
}

/** Positions à l'heure de la timeline, en GeoJSON. */
function donnees(vues: VoitureVue[]) {
  return {
    type: 'FeatureCollection' as const,
    features: vues.map((v) => ({
      type: 'Feature' as const,
      id: v.i,
      properties: { arretee: v.arretee, motif: v.motif },
      geometry: { type: 'Point' as const, coordinates: [v.lon, v.lat] },
    })),
  }
}

/**
 * Voitures de l'essai, une par une, à l'heure de la timeline. Mises à jour hors de React : la
 * couche s'abonne à l'heure et remplace les données de la source à chaque changement (une fois par
 * image pendant la lecture).
 */
export function CoucheVehicules() {
  const { current: carte } = useMap()
  const { essai, vehicules } = useDonneesEssai()
  const afficher = useEtatSumo((e) => e.afficherVehicules)
  const couleur = useEtatSumo((e) => e.couleurVehicules)
  const choisi = useEtatSumo((e) => e.vehicule)

  useEffect(() => {
    const map = carte?.getMap()
    if (!map || !vehicules || !afficher) return
    let image = 0
    let dernier = Number.NaN
    const dessiner = () => {
      image = 0
      const { temps, vehicule, suivre } = etatSumo.lire()
      dernier = temps
      const source = map.getSource<GeoJSONSource>(SOURCE)
      if (!source) return
      const vues = vehicules.positions(temps)
      source.setData(donnees(vues))
      const itineraire = map.getSource<GeoJSONSource>(SOURCE_ITINERAIRE)
      if (vehicule === null || vehicule >= vehicules.nombre) {
        itineraire?.setData(VIDE)
        return
      }
      const fiche = vehicules.fiche(vehicule, temps)
      const { fait, reste } = vehicules.itineraire(fiche.aretes, fiche.etape)
      itineraire?.setData({
        type: 'FeatureCollection',
        features: [
          { type: 'Feature', properties: { fait: true }, geometry: { type: 'LineString', coordinates: fait } },
          { type: 'Feature', properties: { fait: false }, geometry: { type: 'LineString', coordinates: reste } },
        ],
      })
      if (suivre && fiche.etape !== null) {
        const position = vues.find((v) => v.i === vehicule)
        if (position) map.jumpTo({ center: [position.lon, position.lat] })
      }
    }
    // Une mise à jour par image au plus, même si l'heure change plus souvent.
    const auChangement = () => {
      const { temps } = etatSumo.lire()
      if (temps !== dernier && !image) image = requestAnimationFrame(dessiner)
    }
    const desabonner = etatSumo.abonner(auChangement)
    // Source pas encore créée au premier rendu : un tour de plus.
    image = requestAnimationFrame(dessiner)
    return () => {
      desabonner()
      cancelAnimationFrame(image)
    }
  }, [carte, vehicules, afficher, choisi])

  useEffect(() => {
    if (!carte) return
    const auClic = (evenement: MapLayerMouseEvent) => {
      const i = evenement.features?.[0]?.id
      if (typeof i === 'number') etatSumo.modifier({ vehicule: i })
    }
    carte.on('click', SOURCE, auClic)
    return () => {
      carte.off('click', SOURCE, auClic)
    }
  }, [carte])

  if (!vehicules || !afficher) return null
  return (
    <>
      <Source id={SOURCE_ITINERAIRE} type="geojson" data={VIDE}>
        <Layer
          id={SOURCE_ITINERAIRE}
          type="line"
          layout={{ 'line-join': 'round', 'line-cap': 'round' }}
          paint={{
            'line-color': ['case', ['get', 'fait'], '#64748b', '#0ea5e9'],
            'line-width': ['interpolate', ['linear'], ['zoom'], 12, 3, 17, 8],
            'line-opacity': 0.85,
          }}
        />
      </Source>
      <Source id={SOURCE} type="geojson" data={VIDE}>
        <Layer {...couche(couleur, essai?.vehicules?.motifs ?? [])} />
        <Layer
          id={`${SOURCE}-choisi`}
          type="circle"
          filter={['==', ['id'], choisi ?? -1]}
          paint={{
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 5, 17, 11] as unknown as number,
            'circle-color': 'rgba(0,0,0,0)',
            'circle-stroke-color': '#0ea5e9',
            'circle-stroke-width': 3,
          }}
        />
      </Source>
    </>
  )
}
