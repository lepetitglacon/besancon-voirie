import type { Bbox, CarrefoursGeoJson } from '@voirie/schema'
import type { Map as CarteMapLibre } from 'maplibre-gl'
import type { ReactNode } from 'react'
import Map, {
  Layer,
  NavigationControl,
  Source,
  type CircleLayerSpecification,
} from 'react-map-gl/maplibre'
import { FondDeCarte, type OptionsFond } from './FondDeCarte'

/** Centre de Besançon (Pont Battant). */
const VUE_INITIALE = { longitude: 6.0241, latitude: 47.2378, zoom: 13.5 }

/** Style vectoriel libre, sans clé d'API. Attribution OSM incluse dans le style. */
const STYLE_CARTE = 'https://tiles.openfreemap.org/styles/liberty'

const coucheCarrefours: CircleLayerSpecification = {
  id: 'carrefours',
  type: 'circle',
  source: 'carrefours',
  paint: {
    'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 3, 16, 8],
    'circle-stroke-width': 1.5,
    'circle-stroke-color': '#ffffff',
    'circle-color': [
      'match',
      ['get', 'statut'],
      'a_confirmer', '#9aa1ad',
      'estime', '#e08a1e',
      'mesure', '#2f6fd6',
      'verifie', '#1f8a4c',
      /* non_releve */ '#6b7280',
    ],
  },
}

function emprise(carte: CarteMapLibre): Bbox {
  const limites = carte.getBounds()
  return [limites.getWest(), limites.getSouth(), limites.getEast(), limites.getNorth()]
}

interface Props {
  carrefours: CarrefoursGeoJson | undefined
  afficherCarrefours: boolean
  fond: OptionsFond
  onEmprise: (bbox: Bbox) => void
  /** Couches supplémentaires (trams…). */
  children?: ReactNode
}

export function CarteCarrefours({ carrefours, afficherCarrefours, fond, onEmprise, children }: Props) {
  return (
    <Map
      initialViewState={VUE_INITIALE}
      mapStyle={STYLE_CARTE}
      style={{ width: '100%', height: '100%' }}
      onLoad={(evenement) => onEmprise(emprise(evenement.target))}
      onMoveEnd={(evenement) => onEmprise(emprise(evenement.target))}
    >
      <NavigationControl position="top-right" visualizePitch={fond.relief3d} />
      <FondDeCarte {...fond} />
      {children}
      {carrefours && (
        <Source id="carrefours" type="geojson" data={carrefours}>
          <Layer {...coucheCarrefours} layout={{ visibility: afficherCarrefours ? 'visible' : 'none' }} />
        </Source>
      )}
    </Map>
  )
}
