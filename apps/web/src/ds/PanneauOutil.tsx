import { Popover } from '@chakra-ui/react'
import type { ReactNode } from 'react'

interface Props {
  /** Panneau affiché ; c'est le bouton qui l'ouvre et le ferme. */
  ouvert: boolean
  /** Bouton de la colonne de contrôles (`<BoutonCarte>`). */
  bouton: ReactNode
  /** Le panneau, déjà habillé (`<CarteEnTete>`). */
  children: ReactNode
}

/**
 * Panneau d'un outil de la carte, accroché à gauche de son bouton et aligné sur son bas.
 * Non modal : la carte reste utilisable, ni un clic ailleurs ni Échap ne le ferment. Sans
 * portail : en dev, StrictMode laisse un double du portail quand le panneau est ouvert au chargement.
 */
export function PanneauOutil({ ouvert, bouton, children }: Props) {
  return (
    <Popover.Root
      open={ouvert}
      positioning={{ placement: 'left-end', gutter: 10 }}
      modal={false}
      autoFocus={false}
      closeOnInteractOutside={false}
      closeOnEscape={false}
      lazyMount
      unmountOnExit
    >
      <Popover.Anchor>{bouton}</Popover.Anchor>
      <Popover.Positioner>
        <Popover.Content w="auto" maxW="none" p="0" bg="transparent" borderWidth="0" boxShadow="none">
          {children}
        </Popover.Content>
      </Popover.Positioner>
    </Popover.Root>
  )
}
