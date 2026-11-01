import { Box, chakra, type BoxProps } from '@chakra-ui/react'
import { useRef, type PointerEvent, type ReactNode } from 'react'

/** Hauteur de la poignée, seule visible tiroir fermé (px). */
export const HAUTEUR_POIGNEE_TIROIR = 44
/** Glisser du pouce au-delà duquel le tiroir s'ouvre ou se ferme (px) ; en deçà, c'est un appui. */
const SEUIL_GLISSER_PX = 24

interface Props extends Omit<BoxProps, 'title'> {
  titre: ReactNode
  ouvert: boolean
  onOuvert: (ouvert: boolean) => void
  children: ReactNode
}

/**
 * Tiroir posé en bas de l'écran, pour le pouce : sa poignée reste visible ; un appui l'ouvre ou le
 * ferme, un glisser vers le haut l'ouvre, vers le bas le ferme. Ouvert, il recouvre le bas de la
 * page sans déplacer ce qui est au-dessus.
 */
export function TiroirBas({ titre, ouvert, onOuvert, children, ...props }: Props) {
  const depart = useRef<number | null>(null)

  const relacher = (e: PointerEvent<HTMLButtonElement>) => {
    const y0 = depart.current
    depart.current = null
    if (y0 === null) return
    const glisse = e.clientY - y0
    if (Math.abs(glisse) < SEUIL_GLISSER_PX) onOuvert(!ouvert)
    else onOuvert(glisse < 0)
  }

  return (
    <Box
      position="fixed"
      left="50%"
      bottom="0"
      w="full"
      zIndex="2"
      bg="bg.panel"
      borderTopRadius="l3"
      boxShadow={{ _light: '0 -8px 24px rgba(20, 24, 33, 0.18)', _dark: '0 -8px 24px rgba(0, 0, 0, 0.6)' }}
      // Fermé, seule la poignée dépasse.
      transform={ouvert ? 'translate(-50%, 0)' : `translate(-50%, calc(100% - ${HAUTEUR_POIGNEE_TIROIR}px))`}
      transition="transform 220ms ease-out"
      {...props}
    >
      <chakra.button
        type="button"
        w="full"
        h={`${HAUTEUR_POIGNEE_TIROIR}px`}
        display="flex"
        flexDirection="column"
        alignItems="center"
        justifyContent="center"
        gap="1"
        touchAction="none"
        cursor="grab"
        aria-expanded={ouvert}
        onPointerDown={(e) => {
          depart.current = e.clientY
          e.currentTarget.setPointerCapture(e.pointerId)
        }}
        onPointerUp={relacher}
        onPointerCancel={() => (depart.current = null)}
        onKeyDown={(e) => {
          // Clavier : Entrée et Espace passent par le clic, que l'appui au pointeur remplace ici.
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onOuvert(!ouvert)
          }
        }}
      >
        <Box w="10" h="1" borderRadius="full" bg="border.emphasized" />
        <chakra.span textStyle="xs" color="fg.secondary" fontWeight="medium">
          {titre} {ouvert ? '▾' : '▴'}
        </chakra.span>
      </chakra.button>
      <Box px="3" pb="3">
        {children}
      </Box>
    </Box>
  )
}
