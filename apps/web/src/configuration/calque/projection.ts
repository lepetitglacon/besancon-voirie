import type { LonLat, XY } from '@voirie/engine'
import { useEffect, useState } from 'react'
import { useMap } from 'react-map-gl/maplibre'

/** Circonférence équatoriale (m) : sert à convertir un zoom MapLibre en mètres par pixel. */
const CIRCONFERENCE_M = 40_075_016.686
/** MapLibre découpe la Terre en tuiles de 512 px. */
const TAILLE_TUILE_PX = 512

export interface Projection {
  /** lon/lat → pixels dans le conteneur de la carte. */
  px: (point: LonLat) => XY
  /** Pixels dans le conteneur de la carte → lon/lat. */
  lonLat: (x: number, y: number) => LonLat
  /** Échelle au centre de la vue, pour dessiner les voies à leur largeur réelle. */
  metresParPixel: number
}

/**
 * Projection de la carte, recalculée à chaque déplacement (au plus une fois par image) :
 * le composant qui l'utilise se redessine en suivant la carte.
 */
export function useProjection(): Projection | null {
  const { current: carte } = useMap()
  const [, setVersion] = useState(0)

  useEffect(() => {
    const map = carte?.getMap()
    if (!map) return
    let image = 0
    const planifier = () => {
      if (image) return
      image = requestAnimationFrame(() => {
        image = 0
        setVersion((v) => v + 1)
      })
    }
    map.on('move', planifier)
    map.on('resize', planifier)
    return () => {
      map.off('move', planifier)
      map.off('resize', planifier)
      cancelAnimationFrame(image)
    }
  }, [carte])

  if (!carte) return null
  const latitude = carte.getCenter().lat
  return {
    px: (point) => {
      const { x, y } = carte.project(point)
      return [x, y]
    },
    lonLat: (x, y) => {
      const { lng, lat } = carte.unproject([x, y])
      return [lng, lat]
    },
    metresParPixel: (CIRCONFERENCE_M * Math.cos((latitude * Math.PI) / 180)) / (TAILLE_TUILE_PX * 2 ** carte.getZoom()),
  }
}
