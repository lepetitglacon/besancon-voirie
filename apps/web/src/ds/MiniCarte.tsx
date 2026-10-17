import { Box, type BoxProps } from '@chakra-ui/react'
import type { StyleSpecification } from 'maplibre-gl'
import { useMemo, type ReactNode } from 'react'
import Map, { NavigationControl } from 'react-map-gl/maplibre'

/** Orthophotos IGN (Géoplateforme, Licence Ouverte Etalab), sans clé : de quoi reconnaître les lieux. */
const STYLE_PHOTO: StyleSpecification = {
  version: 8,
  sources: {
    photo: {
      type: 'raster',
      tiles: [
        'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS' +
          '&STYLE=normal&TILEMATRIXSET=PM&FORMAT=image/jpeg&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}',
      ],
      tileSize: 256,
      maxzoom: 21,
      attribution: 'Photos : IGN',
    },
  },
  layers: [{ id: 'photo', type: 'raster', source: 'photo' }],
}

/** Marge autour des points cadrés, en pixels. */
const MARGE_PX = 24
/** Jeu autour de l'emprise des points, où l'on peut encore se déplacer : sa taille, mais au moins ~150 m. */
const JEU_RELATIF = 1
const JEU_MIN_DEG = 0.002

interface Props extends Omit<BoxProps, 'children'> {
  /** Points à cadrer, [lon, lat] : la carte s'ouvre sur leur emprise. */
  points: ReadonlyArray<readonly [number, number]>
  /** Zoom maximal du cadrage, pour qu'un seul point ne colle pas la carte au sol. */
  zoomMax?: number
  /** Couches et marqueurs dessinés sur la photo. */
  children?: ReactNode
}

/**
 * Petite carte sur photo aérienne, cadrée sur quelques points (un carrefour, ses feux). On y zoome,
 * on s'y déplace et on l'incline (clic droit ou deux doigts), sans sortir des abords des points.
 */
export function MiniCarte({ points, zoomMax = 19.5, children, h = '240px', ...props }: Props) {
  const emprise = useMemo(() => {
    const lons = points.map(([lon]) => lon)
    const lats = points.map(([, lat]) => lat)
    return [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)] as [number, number, number, number]
  }, [points])
  const limites = useMemo(() => {
    const [ouest, sud, est, nord] = emprise
    const jeuLon = Math.max(JEU_MIN_DEG, (est - ouest) * JEU_RELATIF)
    const jeuLat = Math.max(JEU_MIN_DEG, (nord - sud) * JEU_RELATIF)
    return [ouest - jeuLon, sud - jeuLat, est + jeuLon, nord + jeuLat] as [number, number, number, number]
  }, [emprise])
  if (points.length === 0) return null
  return (
    <Box h={h} borderRadius="l2" overflow="hidden" borderWidth="1px" borderColor="border.subtle" {...props}>
      <Map
        initialViewState={{ bounds: emprise, fitBoundsOptions: { padding: MARGE_PX, maxZoom: zoomMax } }}
        mapStyle={STYLE_PHOTO}
        style={{ width: '100%', height: '100%' }}
        maxBounds={limites}
        maxPitch={70}
        attributionControl={{ compact: true }}
      >
        {/* Boussole : un clic remet le nord en haut et la carte à plat. */}
        <NavigationControl position="top-right" showZoom={false} visualizePitch />
        {children}
      </Map>
    </Box>
  )
}
