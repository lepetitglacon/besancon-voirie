import { IconButton, type IconButtonProps } from '@chakra-ui/react'

interface Props extends Omit<IconButtonProps, 'aria-label'> {
  /** Libellé (aria-label et info-bulle). */
  libelle: string
  /** Enfoncé : son panneau est ouvert. */
  actif?: boolean
}

/** Bouton carré de la colonne de droite de la carte, sous le zoom (icône Lucide en enfant). */
export function BoutonCarte({ libelle, actif, ...props }: Props) {
  return (
    <IconButton
      w="9"
      h="9"
      bg={actif ? 'brand.solid' : 'bg.panel'}
      color={actif ? 'brand.contrast' : 'fg'}
      borderWidth="0"
      borderRadius="10px"
      boxShadow="carte"
      aria-label={libelle}
      title={libelle}
      aria-pressed={actif}
      {...props}
    />
  )
}
