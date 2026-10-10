import type { LonLat } from '@voirie/engine'
import type { MapLayerMouseEvent } from 'maplibre-gl'
import { useEffect, useEffectEvent, useMemo } from 'react'
import { Layer, Source, useMap } from 'react-map-gl/maplibre'
import { COULEUR_MESURE, COULEUR_MESURE_VISEE, distancesMesure, formaterDistance } from './mesure'


interface Props {
  points: LonLat[]
  visee: number | null
  onViser: (i: number | null) => void
  onDeplacer: (i: number, position: LonLat) => void
  /** Début et fin d'un glisser de point (pour le curseur). */
  onGlisse: (actif: boolean) => void
}

/**
 * Tracé de la mesure de distance : ligne, points numérotés, longueur de chaque tronçon.
 * Un point se déplace en le glissant ; le survol le désigne (même couleur dans la frise).
 */
export function CoucheMesure({ points, visee, onViser, onDeplacer, onGlisse }: Props) {
  const { current } = useMap()

  const viser = useEffectEvent(onViser)
  const deplacer = useEffectEvent(onDeplacer)
  const glisse = useEffectEvent(onGlisse)
  useEffect(() => {
    const carte = current?.getMap()
    if (!carte) return
    let enCours: number | null = null
    const indice = (e: MapLayerMouseEvent) => e.features?.[0]?.properties.indice as number | undefined
    const survoler = (e: MapLayerMouseEvent) => {
      if (enCours === null) viser(indice(e) ?? null)
    }
    const quitter = () => {
      if (enCours === null) viser(null)
    }
    const suivre = (e: MapLayerMouseEvent) => {
      if (enCours !== null) deplacer(enCours, [e.lngLat.lng, e.lngLat.lat])
    }
    const lacher = () => {
      if (enCours === null) return
      enCours = null
      glisse(false)
      window.removeEventListener('mouseup', lacher)
      carte.off('mousemove', suivre)
    }
    const saisir = (e: MapLayerMouseEvent) => {
      const i = indice(e)
      if (e.originalEvent.button !== 0 || i === undefined) return
      // Empêche le déplacement de la carte pendant ce geste.
      e.preventDefault()
      enCours = i
      viser(i)
      glisse(true)
      carte.on('mousemove', suivre)
      window.addEventListener('mouseup', lacher)
    }
    carte.on('mousemove', 'mesure-points', survoler)
    carte.on('mouseleave', 'mesure-points', quitter)
    carte.on('mousedown', 'mesure-points', saisir)
    return () => {
      lacher()
      carte.off('mousemove', 'mesure-points', survoler)
      carte.off('mouseleave', 'mesure-points', quitter)
      carte.off('mousedown', 'mesure-points', saisir)
    }
  }, [current])

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
          properties: { indice: i, numero: String(i + 1), vise: i === visee },
          geometry: { type: 'Point' as const, coordinates: p },
        })),
      ],
    }
  }, [points, visee])

  return (
    <Source id="mesure" type="geojson" data={donnees}>
      <Layer
        id="mesure-ligne"
        type="line"
        filter={['==', ['geometry-type'], 'LineString']}
        layout={{ 'line-cap': 'round', 'line-join': 'round' }}
        paint={{ 'line-color': COULEUR_MESURE, 'line-width': 3, 'line-dasharray': [2, 1.5] }}
      />
      <Layer
        id="mesure-points"
        type="circle"
        filter={['has', 'numero']}
        paint={{
          'circle-radius': ['case', ['get', 'vise'], 10, 8] as unknown as number,
          'circle-color': ['case', ['get', 'vise'], COULEUR_MESURE_VISEE, COULEUR_MESURE] as unknown as string,
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
        }}
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
