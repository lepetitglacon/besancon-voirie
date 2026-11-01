import { Box, type BoxProps } from '@chakra-ui/react'
import { useEffect, useRef, type ReactNode } from 'react'
import { PanneauBas } from '../ds'
import { largeurPanneau } from './disposition'

interface Props extends Omit<BoxProps, 'title'> {
  titre: ReactNode
  /** Contrôles à droite du titre. */
  entete?: ReactNode
  /** Hauteur occupée en bas de l'écran (px), 0 quand la bande disparaît : la carte et les barres s'écartent. */
  onHauteur: (hauteur: number) => void
  children: ReactNode
}

/**
 * Bande posée sous la carte quand le plan de feux est à droite : ce qui a besoin de largeur (une
 * timeline, un diagramme) sans cacher le panneau ni la carte. La carte et ses barres s'écartent.
 */
export function BandeBas({ titre, entete, onHauteur, children, ...props }: Props) {
  const racine = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = racine.current
    if (!element) return
    const observateur = new ResizeObserver(() => onHauteur(element.offsetHeight))
    observateur.observe(element)
    return () => {
      observateur.disconnect()
      onHauteur(0)
    }
  }, [onHauteur])

  return (
    <Box ref={racine} position="fixed" left="0" bottom="0" right={largeurPanneau} zIndex="2" {...props}>
      <PanneauBas.Root cote="bas">
        <PanneauBas.Entete titre={titre} py="1.5">
          {entete}
        </PanneauBas.Entete>
        <PanneauBas.Corps py="2" overflow="visible">
          {children}
        </PanneauBas.Corps>
      </PanneauBas.Root>
    </Box>
  )
}
