import { Box, type BoxProps } from '@chakra-ui/react'
import type { StyleSpecification } from 'maplibre-gl'
import { useMemo, type ReactNode } from 'react'
import Map from 'react-map-gl/maplibre'

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

interface Props extends Omit<BoxProps, 'children'> {
  /** Points à cadrer, [lon, lat] : la carte s'ouvre sur leur emprise. */
  points: ReadonlyArray<readonly [number, number]>
  /** Zoom maximal du cadrage, pour qu'un seul point ne colle pas la carte au sol. */
  zoomMax?: number
  /** Couches et marqueurs dessinés sur la photo. */
  children?: ReactNode
}

/**
 * Petite carte sur photo aérienne, cadrée sur quelques points (un carrefour, ses feux). Elle se
 * déplace au doigt mais ne zoome pas à la molette : elle vit dans une page qui défile.
 */
export function MiniCarte({ points, zoomMax = 19.5, children, h = '240px', ...props }: Props) {
  const emprise = useMemo(() => {
    const lons = points.map(([lon]) => lon)
    const lats = points.map(([, lat]) => lat)
    return [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)] as [number, number, number, number]
  }, [points])
  if (points.length === 0) return null
  return (
    <Box h={h} borderRadius="l2" overflow="hidden" borderWidth="1px" borderColor="border.subtle" {...props}>
      <Map
        initialViewState={{ bounds: emprise, fitBoundsOptions: { padding: MARGE_PX, maxZoom: zoomMax } }}
        mapStyle={STYLE_PHOTO}
        style={{ width: '100%', height: '100%' }}
        scrollZoom={false}
        dragRotate={false}
        touchPitch={false}
        attributionControl={{ compact: true }}
      >
        {children}
      </Map>
    </Box>
  )
}
