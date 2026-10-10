import type { LonLat } from '@voirie/engine'
import { useMemo } from 'react'
import { Layer, Source } from 'react-map-gl/maplibre'
import { distancesMesure, formaterDistance } from './mesure'

const COULEUR = '#f59e0b'

/** Tracé de la mesure de distance : ligne, points numérotés, longueur de chaque tronçon. */
export function CoucheMesure({ points }: { points: LonLat[] }) {
  const donnees = useMemo(() => {
    const { troncons } = distancesMesure(points)
    return {
      type: 'FeatureCollection' as const,
      features: [
        ...(points.length > 1
          ? [{ type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates: points } }]
          : []),
        ...points.slice(1).map((p, i) => ({
          type: 'Feature' as const,
          properties: { troncon: formaterDistance(troncons[i + 1]!) },
          geometry: {
            type: 'Point' as const,
            coordinates: [(points[i]![0] + p[0]) / 2, (points[i]![1] + p[1]) / 2],
          },
        })),
        ...points.map((p, i) => ({
          type: 'Feature' as const,
          properties: { numero: String(i + 1) },
          geometry: { type: 'Point' as const, coordinates: p },
        })),
      ],
    }
  }, [points])

  return (
    <Source id="mesure" type="geojson" data={donnees}>
      <Layer
        id="mesure-ligne"
        type="line"
        filter={['==', ['geometry-type'], 'LineString']}
        layout={{ 'line-cap': 'round', 'line-join': 'round' }}
        paint={{ 'line-color': COULEUR, 'line-width': 3, 'line-dasharray': [2, 1.5] }}
      />
      <Layer
        id="mesure-points"
        type="circle"
        filter={['has', 'numero']}
        paint={{ 'circle-radius': 8, 'circle-color': COULEUR, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 }}
      />
      <Layer
        id="mesure-numeros"
        type="symbol"
        filter={['has', 'numero']}
        layout={{ 'text-field': ['get', 'numero'], 'text-size': 11, 'text-font': ['Noto Sans Regular'], 'text-allow-overlap': true }}
        paint={{ 'text-color': '#ffffff' }}
      />
      <Layer
        id="mesure-troncons"
        type="symbol"
        filter={['has', 'troncon']}
        layout={{ 'text-field': ['get', 'troncon'], 'text-size': 12, 'text-font': ['Noto Sans Regular'], 'text-offset': [0, -1], 'text-allow-overlap': true }}
        paint={{ 'text-color': '#ffffff', 'text-halo-color': '#7c4a03', 'text-halo-width': 1.5 }}
      />
    </Source>
  )
}
