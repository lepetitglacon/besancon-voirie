import { chakra, type HTMLChakraProps } from '@chakra-ui/react'
import { useEffect, useRef } from 'react'
import { DENSITE_ETIQUETTE, dessinerEtiquette, type ModeVehicule } from './etiquetteVehicule'

interface Props extends Omit<HTMLChakraProps<'canvas'>, 'children'> {
  mode: ModeVehicule
  ligne: string
  /** Couleurs de la ligne (GTFS), en `#rrggbb`. */
  couleur: string
  couleurTexte: string
}

/**
 * Étiquette d'un tram ou d'un bus : pictogramme et numéro de ligne, aux couleurs de la ligne.
 * Silhouette de rame pour le tram (bas plat et large, haut arrondi), carré pour le bus. La même
 * image sert de marqueur sur la carte (map/iconesVehicules).
 */
export function EtiquetteVehicule({ mode, ligne, couleur, couleurTexte, ...props }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const element = canvas.current
    if (!element) return
    const image = dessinerEtiquette(mode, ligne, couleur, couleurTexte)
    element.width = image.width
    element.height = image.height
    element.style.width = `${image.width / DENSITE_ETIQUETTE}px`
    element.style.height = `${image.height / DENSITE_ETIQUETTE}px`
    element.getContext('2d')?.putImageData(image, 0, 0)
  }, [mode, ligne, couleur, couleurTexte])
  return (
    <chakra.canvas
      ref={canvas}
      role="img"
      aria-label={`${mode === 'tram' ? 'Tram' : 'Bus'} ${ligne}`}
      flexShrink={0}
      {...props}
    />
  )
}
