import { useEffect } from 'react'
import { Layer, Source, useMap } from 'react-map-gl/maplibre'

export type Fond = 'satellite' | 'plan'

export interface OptionsFond {
  fond: Fond
  /** Bâtiments en relief et carte inclinable. Coûteux pour la carte graphique. */
  relief3d: boolean
  batiments: boolean
}

/** Orthophotos IGN (Géoplateforme, Licence Ouverte Etalab), sans clé, 20 cm/pixel. */
const ORTHO_IGN =
  'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS' +
  '&STYLE=normal&TILEMATRIXSET=PM&FORMAT=image/jpeg&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}'
const ATTRIBUTION_IGN = 'Photos : <a href="https://geoservices.ign.fr/">IGN</a> (Licence Ouverte)'

/** Sources du style OpenFreeMap « liberty ». */
const SOURCES_PLAN = new Set(['openmaptiles', 'ne2_shaded'])
/** Couches de décor masquées sous la photo : on n'y garde que les libellés (type symbol). */
const TYPES_DECOR = new Set(['fill', 'line', 'raster'])
const BATIMENTS_2D = 'building'
const BATIMENTS_3D = 'building-3d'
const INCLINAISON_3D = 50

/**
 * Règle le fond de la carte : photo aérienne avec les libellés du plan, ou plan seul ; bâtiments
 * à plat, en relief ou masqués. Sans 3D, la carte ne s'incline pas.
 */
export function FondDeCarte({ fond, relief3d, batiments }: OptionsFond) {
  const { current: carte } = useMap()

  useEffect(() => {
    if (!carte) return
    const m = carte.getMap()
    const appliquer = () => {
      for (const couche of m.getStyle().layers) {
        if (!('source' in couche) || !SOURCES_PLAN.has(couche.source)) continue
        if (couche.id === BATIMENTS_2D || couche.id === BATIMENTS_3D || !TYPES_DECOR.has(couche.type)) continue
        m.setLayoutProperty(couche.id, 'visibility', fond === 'plan' ? 'visible' : 'none')
      }
      if (m.getLayer(BATIMENTS_2D) && m.getLayer(BATIMENTS_3D)) {
        // Sans relief, les bâtiments restent à plat à tous les zooms (le style passe en 3D dès 14).
        m.setLayerZoomRange(BATIMENTS_2D, 13, relief3d ? 14 : 24)
        m.setLayoutProperty(BATIMENTS_2D, 'visibility', batiments ? 'visible' : 'none')
        m.setLayoutProperty(BATIMENTS_3D, 'visibility', batiments && relief3d ? 'visible' : 'none')
      }
      m.setMaxPitch(relief3d ? 70 : 0)
      if (relief3d && m.getPitch() === 0) m.easeTo({ pitch: INCLINAISON_3D })
    }
    // Pas isStyleLoaded() : il reste faux tant qu'une source charge des données, ce qui arrive
    // juste après un clic sur une couche ; seules les couches du style doivent exister.
    if (m.getLayer('background')) {
      appliquer()
      return undefined
    }
    const surStyle = () => {
      if (!m.getLayer('background')) return
      m.off('styledata', surStyle)
      appliquer()
    }
    m.on('styledata', surStyle)
    return () => {
      m.off('styledata', surStyle)
    }
  }, [carte, fond, relief3d, batiments])

  return (
    <Source
      id="ign-ortho"
      type="raster"
      tiles={[ORTHO_IGN]}
      tileSize={256}
      maxzoom={19}
      attribution={ATTRIBUTION_IGN}
    >
      <Layer
        id="ign-ortho"
        type="raster"
        beforeId="natural_earth"
        layout={{ visibility: fond === 'satellite' ? 'visible' : 'none' }}
      />
    </Source>
  )
}
