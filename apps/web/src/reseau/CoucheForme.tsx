/**
 * Outil Forme (docs/pipeline-donnees.md, étape 8) : le tracé du tronçon visé, ses sommets et le
 * milieu de chaque segment. Glisser un sommet le déplace ; glisser un milieu crée un sommet ; un
 * clic sur un sommet le sélectionne (Suppr ou ⌫ le retire). Les bouts restent sur leurs nœuds.
 * Chaque geste terminé part aussitôt à l'API.
 */
import type { LonLat } from '@voirie/engine'
import type { MapLayerMouseEvent, MapMouseEvent } from 'maplibre-gl'
import { useEffect, useEffectEvent, useMemo, useState } from 'react'
import { Layer, Source, useMap } from 'react-map-gl/maplibre'
import { TOLERANCE_CLIC_PX } from '../configuration/calque/relais'
import { COULEURS_RESEAU } from './couleurs'
import { ZONES_FORME } from './couchesVoies'

interface Props {
  /** Tracé du tronçon, de `noeud_de` à `noeud_vers`. */
  points: LonLat[]
  /** Sommet sélectionné (index dans `points`), null : aucun. */
  sommet: number | null
  onSommet: (sommet: number | null) => void
  onChanger: (points: LonLat[]) => void
}

/** Sommet saisi (ou milieu, qui en devient un) : où il a été pris, où il est maintenant. */
interface Glisse {
  index: number
  /** Milieu d'un segment : le sommet est inséré à `index` quand on le lâche. */
  insertion: boolean
  appui: [number, number]
  position: LonLat
  bouge: boolean
}

const collection = (features: unknown[]) => ({ type: 'FeatureCollection' as const, features })

export function CoucheForme({ points, sommet, onSommet, onChanger }: Props) {
  const { current: carte } = useMap()
  const [glisse, setGlisse] = useState<Glisse | null>(null)

  // Tracé pendant le geste : le sommet suit le pointeur.
  const trace = useMemo(() => {
    if (!glisse?.bouge) return points
    return glisse.insertion
      ? [...points.slice(0, glisse.index), glisse.position, ...points.slice(glisse.index)]
      : points.map((p, i) => (i === glisse.index ? glisse.position : p))
  }, [points, glisse])

  const donnees = useMemo(
    () => ({
      ligne: collection([{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: trace } }]),
      // Les bouts sont les nœuds : on les montre, sans les rendre déplaçables ici.
      sommets: collection(
        trace.map((p, i) => ({
          type: 'Feature',
          properties: { index: i, bout: i === 0 || i === trace.length - 1, choisi: i === sommet },
          geometry: { type: 'Point', coordinates: p },
        })),
      ),
      milieux: collection(
        glisse?.bouge
          ? []
          : trace.slice(1).map((p, i) => ({
              type: 'Feature',
              properties: { index: i + 1 },
              geometry: { type: 'Point', coordinates: [(trace[i]![0] + p[0]) / 2, (trace[i]![1] + p[1]) / 2] },
            })),
      ),
    }),
    [trace, sommet, glisse?.bouge],
  )

  const appuyer = (insertion: boolean) => (e: MapLayerMouseEvent) => {
    if (e.originalEvent.button !== 0) return
    const index = e.features?.[0]?.properties.index as number | undefined
    if (index === undefined || (!insertion && (index === 0 || index === points.length - 1))) return
    e.preventDefault() // la carte ne se déplace pas
    setGlisse({ index, insertion, appui: [e.point.x, e.point.y], position: [e.lngLat.lng, e.lngLat.lat], bouge: false })
  }
  const surAppuiSommet = useEffectEvent(appuyer(false))
  const surAppuiMilieu = useEffectEvent(appuyer(true))
  const surMouvement = useEffectEvent((e: MapMouseEvent) => {
    if (!glisse) return
    const bouge = glisse.bouge || Math.hypot(e.point.x - glisse.appui[0], e.point.y - glisse.appui[1]) > TOLERANCE_CLIC_PX
    setGlisse({ ...glisse, position: [e.lngLat.lng, e.lngLat.lat], bouge })
  })
  const surRelache = useEffectEvent(() => {
    if (!glisse) return
    setGlisse(null)
    if (glisse.bouge) {
      onChanger(trace)
      onSommet(null)
    } else if (!glisse.insertion) onSommet(glisse.index === sommet ? null : glisse.index)
  })

  useEffect(() => {
    const map = carte?.getMap()
    if (!map) return
    const relache = () => surRelache()
    map.on('mousedown', ZONES_FORME.sommets, surAppuiSommet)
    map.on('mousedown', ZONES_FORME.milieux, surAppuiMilieu)
    map.on('mousemove', surMouvement)
    window.addEventListener('mouseup', relache)
    return () => {
      map.off('mousedown', ZONES_FORME.sommets, surAppuiSommet)
      map.off('mousedown', ZONES_FORME.milieux, surAppuiMilieu)
      map.off('mousemove', surMouvement)
      window.removeEventListener('mouseup', relache)
    }
  }, [carte])

  return (
    <>
      <Source id="reseau-forme-ligne" type="geojson" data={donnees.ligne}>
        <Layer id="reseau-forme-ligne" type="line" paint={{ 'line-color': COULEURS_RESEAU.trace, 'line-width': 2.5 }} />
      </Source>
      <Source id="reseau-forme-milieux" type="geojson" data={donnees.milieux}>
        <Layer
          id="reseau-forme-milieux"
          type="circle"
          paint={{ 'circle-radius': 3.5, 'circle-color': '#ffffff', 'circle-opacity': 0.7, 'circle-stroke-color': COULEURS_RESEAU.trace, 'circle-stroke-width': 1.5 }}
        />
        <Layer id={ZONES_FORME.milieux} type="circle" paint={{ 'circle-radius': 9, 'circle-opacity': 0 }} />
      </Source>
      <Source id="reseau-forme-sommets" type="geojson" data={donnees.sommets}>
        <Layer
          id="reseau-forme-sommets"
          type="circle"
          paint={{
            'circle-radius': ['case', ['get', 'bout'], 4, ['get', 'choisi'], 7, 5.5],
            'circle-color': ['case', ['get', 'bout'], '#1d2330', ['get', 'choisi'], '#ffffff', COULEURS_RESEAU.trace],
            'circle-stroke-color': ['case', ['get', 'choisi'], COULEURS_RESEAU.trace, '#ffffff'],
            'circle-stroke-width': ['case', ['get', 'choisi'], 3, 2],
          }}
        />
        <Layer id={ZONES_FORME.sommets} type="circle" filter={['!', ['get', 'bout']]} paint={{ 'circle-radius': 11, 'circle-opacity': 0 }} />
      </Source>
    </>
  )
}
