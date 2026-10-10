import type { FluxSumo } from '@voirie/schema'
import type { MapMouseEvent } from 'maplibre-gl'
import { useEffect, useMemo } from 'react'
import { Layer, Source, useMap } from 'react-map-gl/maplibre'
import { etatSumo, useEtatSumo } from './etat'

const COULEURS = { origine: '#2563eb', destination: '#dc2626' } as const

/** Cercle de `rayon` m autour d'un point, en polygone (assez précis à l'échelle d'une ville). */
function cercle([lon, lat]: [number, number], rayon: number): [number, number][] {
  const dLat = rayon / 111_320
  const dLon = rayon / (111_320 * Math.cos((lat * Math.PI) / 180))
  return Array.from({ length: 49 }, (_, k) => {
    const a = (k / 48) * 2 * Math.PI
    return [lon + dLon * Math.cos(a), lat + dLat * Math.sin(a)]
  })
}

function geojson(flux: FluxSumo[]) {
  return {
    type: 'FeatureCollection' as const,
    features: flux.flatMap((f, k) => [
      ...(['origine', 'destination'] as const).map((bout) => ({
        type: 'Feature' as const,
        properties: { couleur: COULEURS[bout], libelle: `${k + 1}` },
        geometry: { type: 'Polygon' as const, coordinates: [cercle(f[bout], f.rayon)] },
      })),
      {
        type: 'Feature' as const,
        properties: { couleur: '#111827', libelle: `${k + 1}` },
        geometry: { type: 'LineString' as const, coordinates: [f.origine, f.destination] },
      },
    ]),
  }
}

/**
 * Flux du formulaire de lancement : cercle d'origine (bleu), de destination (rouge), trait entre
 * les deux. Pendant un choix de point, le prochain clic sur la carte place ce bout du flux.
 */
export function CoucheFlux() {
  const { current: carte } = useMap()
  const flux = useEtatSumo((e) => e.flux)
  const choixPoint = useEtatSumo((e) => e.choixPoint)
  const donnees = useMemo(() => geojson(flux), [flux])

  useEffect(() => {
    const map = carte?.getMap()
    if (!map || !choixPoint) return
    const curseur = map.getCanvas().style.cursor
    map.getCanvas().style.cursor = 'crosshair'
    const auClic = (e: MapMouseEvent) => {
      const point: [number, number] = [Number(e.lngLat.lng.toFixed(6)), Number(e.lngLat.lat.toFixed(6))]
      etatSumo.modifier((etat) => ({
        flux: etat.flux.map((f, k) => (k === choixPoint.flux ? { ...f, [choixPoint.bout]: point } : f)),
        choixPoint: null,
      }))
    }
    map.once('click', auClic)
    return () => {
      map.off('click', auClic)
      map.getCanvas().style.cursor = curseur
    }
  }, [carte, choixPoint])

  if (flux.length === 0) return null
  return (
    <Source id="sumo-flux" type="geojson" data={donnees}>
      <Layer
        id="sumo-flux-zones"
        type="fill"
        filter={['==', ['geometry-type'], 'Polygon']}
        paint={{ 'fill-color': ['get', 'couleur'], 'fill-opacity': 0.18 }}
      />
      <Layer
        id="sumo-flux-bords"
        type="line"
        filter={['==', ['geometry-type'], 'Polygon']}
        paint={{ 'line-color': ['get', 'couleur'], 'line-width': 2 }}
      />
      <Layer
        id="sumo-flux-traits"
        type="line"
        filter={['==', ['geometry-type'], 'LineString']}
        paint={{ 'line-color': ['get', 'couleur'], 'line-width': 2, 'line-dasharray': [2, 2] }}
      />
      <Layer
        id="sumo-flux-numeros"
        type="symbol"
        filter={['==', ['geometry-type'], 'Polygon']}
        layout={{ 'text-field': ['get', 'libelle'], 'text-size': 14, 'text-font': ['Noto Sans Regular'] }}
        paint={{ 'text-color': ['get', 'couleur'], 'text-halo-color': '#ffffff', 'text-halo-width': 2 }}
      />
    </Source>
  )
}
