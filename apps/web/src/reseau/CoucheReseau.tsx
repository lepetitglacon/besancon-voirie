/**
 * Réseau routier sur la carte (docs/RESEAU.md) : tronçons à la largeur de leurs voies, nœuds,
 * sens de circulation, tracé en cours. En mode réseau, un clic choisit un tronçon (outil
 * Sélection) ou ajoute un point au tracé (outil Tracer), accroché au nœud ou au tronçon visé.
 */
import type { LonLat } from '@voirie/engine'
import type { ReseauGeoJson } from '@voirie/schema'
import type { ExpressionSpecification, MapLayerMouseEvent, MapMouseEvent } from 'maplibre-gl'
import { useEffect, useEffectEvent, useMemo, useState, type ReactNode } from 'react'
import { Layer, Source, useMap } from 'react-map-gl/maplibre'
import { PopupSurCarte } from '../ds'
import { COULEURS_RESEAU } from './couleurs'
import type { Cible, Trace } from './trace'

/** Outils de l'éditeur des voies quand aucun carrefour n'est ouvert. */
export type OutilReseau = 'selection' | 'tracer' | 'connecter'

/** Distance (px) à laquelle un clic accroche un nœud ou un tronçon. */
const TOLERANCE_PX = 8

interface Props {
  donnees: ReseauGeoJson | undefined
  outil: OutilReseau
  selection: string | null
  trace: Trace
  /** Clic sur la carte : position et ce qui est sous le pointeur (nœud en priorité, puis tronçon). */
  onClic: (position: LonLat, cible: Cible, memePoint: (a: LonLat, b: LonLat) => boolean) => void
  /** Popup du tronçon sélectionné, ancrée au point cliqué. */
  popup: { position: LonLat; contenu: ReactNode } | null
}

const total: ExpressionSpecification = ['+', ['get', 'voies_avant'], ['get', 'voies_arriere']]
/**
 * Largeur d'un tronçon à l'écran : ~3,25 m au sol par voie (5,4 px au zoom 18 à Besançon), au
 * moins `minimum` px. MapLibre n'accepte le zoom qu'en tête de l'expression.
 */
const largeur = (minimum: number, marge = 0): ExpressionSpecification => [
  'interpolate', ['exponential', 2], ['zoom'],
  13, ['+', ['max', minimum, ['*', total, 0.17]], marge],
  18, ['+', ['max', minimum, ['*', total, 5.4]], marge],
  21, ['+', ['max', minimum, ['*', total, 43]], marge],
]
/** Opacité qui s'efface quand les voies sont dessinées une à une (zoom 16), sans disparaître des requêtes. */
const auZoomDesVoies = (opacite: number): ExpressionSpecification => ['interpolate', ['linear'], ['zoom'], 15.5, opacite, 16, 0.02]
const sensUnique: ExpressionSpecification = ['any', ['==', ['get', 'voies_avant'], 0], ['==', ['get', 'voies_arriere'], 0]]

export function CoucheReseau({ donnees, outil, selection, trace, onClic, popup }: Props) {
  const { current: carte } = useMap()
  const [curseur, setCurseur] = useState<LonLat | null>(null)

  // Le gestionnaire lit toujours les dernières props, sans réabonner la carte à chaque rendu.
  const relayerClic = useEffectEvent(onClic)

  // Gestes propres au mode réseau : clic (sélection ou tracé), suivi du pointeur pendant le tracé.
  useEffect(() => {
    if (!carte) return
    const map = carte.getMap()
    const memePoint = (a: LonLat, b: LonLat) => {
      const pa = map.project(a)
      const pb = map.project(b)
      return Math.hypot(pa.x - pb.x, pa.y - pb.y) <= TOLERANCE_PX
    }
    const cibleSous = (e: MapMouseEvent): Cible => {
      const { x, y } = e.point
      const zone: [[number, number], [number, number]] = [
        [x - TOLERANCE_PX, y - TOLERANCE_PX],
        [x + TOLERANCE_PX, y + TOLERANCE_PX],
      ]
      const couches = ['reseau-noeuds', 'reseau-troncons'].filter((id) => map.getLayer(id))
      const objets = map.queryRenderedFeatures(zone, { layers: couches })
      const noeud = objets.find((f) => f.layer.id === 'reseau-noeuds')
      if (noeud) return { type: 'noeud', id: noeud.properties.id as string }
      const troncon = objets.find((f) => f.layer.id === 'reseau-troncons')
      return troncon ? { type: 'troncon', id: troncon.properties.id as string } : null
    }
    const cliquer = (e: MapLayerMouseEvent) => relayerClic([e.lngLat.lng, e.lngLat.lat], cibleSous(e), memePoint)
    const bouger = (e: MapMouseEvent) => setCurseur([e.lngLat.lng, e.lngLat.lat])
    map.on('click', cliquer)
    map.on('mousemove', bouger)
    // Le double-clic zoomerait pendant qu'on pose des points.
    map.doubleClickZoom.disable()
    return () => {
      map.off('click', cliquer)
      map.off('mousemove', bouger)
      map.doubleClickZoom.enable()
    }
  }, [carte])

  const apercu = useMemo(() => {
    const points = trace.map((p) => p.position)
    if (outil === 'tracer' && curseur && points.length > 0) points.push(curseur)
    return {
      type: 'FeatureCollection' as const,
      features: [
        ...(points.length >= 2 ? [{ type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates: points } }] : []),
        ...trace.map((p) => ({
          type: 'Feature' as const,
          properties: { accroche: p.accroche.type },
          geometry: { type: 'Point' as const, coordinates: p.position },
        })),
      ],
    }
  }, [trace, curseur, outil])

  const estSelection: ExpressionSpecification = ['==', ['get', 'id'], selection ?? '']

  return (
    <>
      {donnees && (
        <>
          <Source id="reseau-troncons" type="geojson" data={donnees.troncons} promoteId="id">
            <Layer
              id="reseau-troncons-halo"
              type="line"
              filter={estSelection}
              layout={{ 'line-cap': 'round', 'line-join': 'round' }}
              paint={{ 'line-color': COULEURS_RESEAU.selection, 'line-width': largeur(1.5, 6), 'line-opacity': auZoomDesVoies(0.9) }}
            />
            <Layer
              id="reseau-troncons"
              type="line"
              layout={{ 'line-cap': 'round', 'line-join': 'round' }}
              paint={{
                'line-color': [
                  'case',
                  ['==', ['get', 'source'], 'manuel'], COULEURS_RESEAU.manuel,
                  ['get', 'modifie'], COULEURS_RESEAU.modifie,
                  COULEURS_RESEAU.osm,
                ],
                'line-width': largeur(1.5),
                // Au zoom des voies, le calque SVG les dessine une à une : la ligne reste pour les clics.
                'line-opacity': auZoomDesVoies(0.75),
              }}
            />
            {/* Sens de circulation des sens uniques, et sens du tracé du tronçon sélectionné. */}
            <Layer
              id="reseau-sens"
              type="symbol"
              minzoom={15}
              filter={['any', sensUnique, estSelection]}
              layout={{
                'symbol-placement': 'line',
                'symbol-spacing': 60,
                // Glyphes ASCII : la police du fond de carte n'a pas les flèches Unicode.
                'text-field': ['case', ['==', ['get', 'voies_avant'], 0], '<', '>'],
                'text-font': ['Noto Sans Regular'],
                'text-size': 14,
                'text-keep-upright': false,
                'text-allow-overlap': true,
              }}
              paint={{ 'text-color': '#ffffff', 'text-halo-color': '#1d2330', 'text-halo-width': 1.2 }}
            />
          </Source>
          <Source id="reseau-noeuds" type="geojson" data={donnees.noeuds}>
            <Layer
              id="reseau-noeuds"
              type="circle"
              minzoom={15}
              paint={{
                'circle-radius': [
                  'interpolate', ['linear'], ['zoom'],
                  15, ['case', ['!=', ['get', 'carrefour_id'], null], 5, 1.8],
                  19, ['case', ['!=', ['get', 'carrefour_id'], null], 12, 5],
                ],
                'circle-color': [
                  'case',
                  ['!=', ['get', 'carrefour_id'], null], COULEURS_RESEAU.carrefour,
                  ['==', ['get', 'degre'], 1], COULEURS_RESEAU.culDeSac,
                  '#ffffff',
                ],
                'circle-stroke-width': 1,
                'circle-stroke-color': '#1d2330',
              }}
            />
          </Source>
        </>
      )}
      <Source id="reseau-trace" type="geojson" data={apercu}>
        <Layer
          id="reseau-trace-ligne"
          type="line"
          filter={['==', ['geometry-type'], 'LineString']}
          paint={{ 'line-color': COULEURS_RESEAU.trace, 'line-width': 3, 'line-dasharray': [2, 1.5] }}
        />
        <Layer
          id="reseau-trace-points"
          type="circle"
          filter={['==', ['geometry-type'], 'Point']}
          paint={{
            'circle-radius': ['case', ['==', ['get', 'accroche'], 'libre'], 4, 6],
            'circle-color': COULEURS_RESEAU.trace,
            'circle-stroke-width': 2,
            'circle-stroke-color': '#ffffff',
          }}
        />
      </Source>
      {popup && (
        <PopupSurCarte longitude={popup.position[0]} latitude={popup.position[1]} closeOnClick={false}>
          {popup.contenu}
        </PopupSurCarte>
      )}
    </>
  )
}
