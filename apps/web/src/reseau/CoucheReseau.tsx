/**
 * Réseau routier sur la carte (docs/RESEAU.md) : tronçons à la largeur de leurs voies, nœuds
 * (feux, passages piétons, carrefours), sens de circulation, tracé en cours. Un clic vise le
 * nœud ou le tronçon sous le pointeur ; l'outil actif décide quoi en faire (popup, point du
 * tracé, coupe, nœud du carrefour). Au zoom des voies, la couche des voies (CoucheVoies) prend
 * le relais : le clic y cherche aussi la voie ou le nœud visé.
 */
import { largeurTroncon, type LonLat } from '@voirie/engine'
import type { ReseauGeoJson, SensTroncon } from '@voirie/schema'
import type { ExpressionSpecification, MapLayerMouseEvent, MapMouseEvent } from 'maplibre-gl'
import { useEffect, useEffectEvent, useMemo, useState, type ReactNode } from 'react'
import { Layer, Source, useMap } from 'react-map-gl/maplibre'
import { PopupSurCarte } from '../ds'
import { COULEURS_RESEAU } from './couleurs'
import { COUCHE_COEUR, useCoucheDessous, ZONES } from './couchesVoies'
import { metresEnPixels } from './largeurs'
import { ZOOM_VOIES } from './modeReseau'
import type { Cible, Trace } from './trace'

/**
 * Outils de l'éditeur des voies (`noeuds` seulement avec un carrefour ouvert). Voie, passage et
 * emprise : docs/pipeline-donnees.md, étapes 1 et 3.
 */
export type OutilReseau = 'selection' | 'tracer' | 'couper' | 'connecter' | 'noeuds' | 'voie' | 'passage' | 'emprise'

/** Distance (px) à laquelle un clic accroche un nœud ou un tronçon. */
const TOLERANCE_PX = 8

interface Props {
  donnees: ReseauGeoJson | undefined
  outil: OutilReseau
  selection: string | null
  trace: Trace
  /** Sommets de l'emprise de voie en cours de dessin ; null : aucune. */
  emprise: LonLat[] | null
  /** Clic sur la carte : position et ce qui est sous le pointeur (nœud en priorité, puis tronçon). */
  onClic: (position: LonLat, cible: Cible, memePoint: (a: LonLat, b: LonLat) => boolean) => void
  /** Popup du tronçon sélectionné, ancrée au point cliqué. */
  popup: { position: LonLat; contenu: ReactNode } | null
}

/** Largeur d'un tronçon à l'écran : celle de sa chaussée au sol (voies vélo moins larges), au moins `minimum` px. */
const largeur = (minimum: number, marge = 0) => metresEnPixels(['get', 'largeur_m'], minimum, marge)
/** Opacité qui s'efface quand les voies sont dessinées une à une (CoucheVoies apparaît au même moment). */
const auZoomDesVoies = (opacite: number): ExpressionSpecification => ['interpolate', ['linear'], ['zoom'], ZOOM_VOIES - 0.5, opacite, ZOOM_VOIES, 0]
const sensUnique: ExpressionSpecification = ['any', ['==', ['get', 'voies_avant'], 0], ['==', ['get', 'voies_arriere'], 0]]

export function CoucheReseau({ donnees, outil, selection, trace, emprise, onClic, popup }: Props) {
  const { current: carte } = useMap()
  const dessous = useCoucheDessous()
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
      // Au zoom des voies, les couches de CoucheVoies ; en dessous, celles des tronçons.
      const couches = [ZONES.noeuds, 'reseau-noeuds', 'reseau-voies', COUCHE_COEUR, 'reseau-troncons'].filter((id) => map.getLayer(id))
      const objets = map.queryRenderedFeatures(zone, { layers: couches })
      const noeud = objets.find((f) => f.layer.id === ZONES.noeuds || f.layer.id === 'reseau-noeuds')
      if (noeud) return { type: 'noeud', id: noeud.properties.id as string }
      const voie = objets.find((f) => f.layer.id === 'reseau-voies' || f.layer.id === COUCHE_COEUR)
      if (voie?.layer.id === 'reseau-voies') {
        const { troncon, sens, rang } = voie.properties as { troncon: string; sens: SensTroncon; rang: number }
        return { type: 'troncon', id: troncon, voie: { sens, rang } }
      }
      if (voie) return { type: 'troncon', id: voie.properties.troncon as string }
      const troncon = objets.find((f) => f.layer.id === 'reseau-troncons')
      return troncon ? { type: 'troncon', id: troncon.properties.id as string } : null
    }
    const cliquer = (e: MapLayerMouseEvent) => {
      // Un feu (sa popup) ou le disque d'un carrefour (il s'ouvre) : le réseau ne répond pas en même
      // temps. Au zoom des voies, les voies et les nœuds sont dessinés par-dessus le disque et passent avant.
      const couches = ['feux', 'carrefours', ZONES.noeuds, 'reseau-voies'].filter((id) => map.getLayer(id))
      const dessus = couches.length > 0 ? map.queryRenderedFeatures(e.point, { layers: couches })[0] : undefined
      if (dessus?.layer.id === 'feux' || dessus?.layer.id === 'carrefours') return
      relayerClic([e.lngLat.lng, e.lngLat.lat], cibleSous(e), memePoint)
    }
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
    // Emprise : le polygone se referme sur le premier sommet ; tracé : la rue suit le pointeur.
    const sommets: Array<{ position: LonLat; accroche: string }> = emprise
      ? emprise.map((position) => ({ position, accroche: 'libre' }))
      : trace.map((p) => ({ position: p.position, accroche: p.accroche.type }))
    const points = sommets.map((p) => p.position)
    if ((outil === 'tracer' || emprise) && curseur && points.length > 0) points.push(curseur)
    if (emprise && points.length >= 3) points.push(points[0]!)
    return {
      type: 'FeatureCollection' as const,
      features: [
        ...(points.length >= 2 ? [{ type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates: points } }] : []),
        ...sommets.map((p) => ({
          type: 'Feature' as const,
          properties: { accroche: p.accroche },
          geometry: { type: 'Point' as const, coordinates: p.position },
        })),
      ],
    }
  }, [trace, emprise, curseur, outil])

  // Largeur de chaussée de chaque tronçon, pour le dessiner à sa largeur au sol.
  const troncons = useMemo(
    () =>
      donnees && {
        ...donnees.troncons,
        features: donnees.troncons.features.map((t) => ({ ...t, properties: { ...t.properties, largeur_m: largeurTroncon(t.properties) } })),
      },
    [donnees],
  )

  const estSelection: ExpressionSpecification = ['==', ['get', 'id'], selection ?? '']

  return (
    <>
      {donnees && troncons && (
        <>
          <Source id="reseau-troncons" type="geojson" data={troncons} promoteId="id">
            <Layer
              id="reseau-troncons-halo"
              type="line"
              maxzoom={ZOOM_VOIES}
              beforeId={dessous}
              filter={estSelection}
              layout={{ 'line-cap': 'round', 'line-join': 'round' }}
              paint={{ 'line-color': COULEURS_RESEAU.selection, 'line-width': largeur(1.5, 6), 'line-opacity': auZoomDesVoies(0.9) }}
            />
            <Layer
              id="reseau-troncons"
              type="line"
              maxzoom={ZOOM_VOIES}
              beforeId={dessous}
              layout={{ 'line-cap': 'round', 'line-join': 'round' }}
              paint={{
                'line-color': [
                  'case',
                  ['==', ['get', 'source'], 'manuel'], COULEURS_RESEAU.manuel,
                  ['get', 'modifie'], COULEURS_RESEAU.modifie,
                  COULEURS_RESEAU.osm,
                ],
                'line-width': largeur(1.5),
                'line-opacity': auZoomDesVoies(0.75),
              }}
            />
            {/* Sens de circulation des sens uniques, et sens du tracé du tronçon sélectionné. */}
            <Layer
              id="reseau-sens"
              type="symbol"
              minzoom={15}
              beforeId={dessous}
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
              maxzoom={ZOOM_VOIES}
              beforeId={dessous}
              paint={{
                'circle-radius': [
                  'interpolate', ['linear'], ['zoom'],
                  15, ['case', ['!=', ['get', 'carrefour_id'], null], 5, 1.8],
                  19, ['case', ['!=', ['get', 'carrefour_id'], null], 12, 5],
                ],
                'circle-color': [
                  'case',
                  ['get', 'feux'], COULEURS_RESEAU.feux,
                  ['!=', ['get', 'pieton'], null], COULEURS_RESEAU.pieton,
                  ['!=', ['get', 'carrefour_id'], null], COULEURS_RESEAU.carrefour,
                  ['==', ['get', 'degre'], 1], COULEURS_RESEAU.culDeSac,
                  '#ffffff',
                ],
                'circle-stroke-width': ['case', ['!=', ['get', 'carrefour_id'], null], 2.5, 1],
                'circle-stroke-color': ['case', ['!=', ['get', 'carrefour_id'], null], COULEURS_RESEAU.carrefour, '#1d2330'],
                'circle-opacity': auZoomDesVoies(1),
                'circle-stroke-opacity': auZoomDesVoies(1),
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
