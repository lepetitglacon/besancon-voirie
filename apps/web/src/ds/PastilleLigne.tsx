import { chakra, type HTMLChakraProps } from '@chakra-ui/react'

interface Props extends Omit<HTMLChakraProps<'button'>, 'children' | 'onChange'> {
  ligne: string
  /** Couleurs de la ligne (GTFS), en `#rrggbb`. */
  couleur: string
  couleurTexte: string
  /** Ligne affichée : pastille pleine ; masquée : contour seul. */
  affichee: boolean
  onChange: (affichee: boolean) => void
}

/** Numéro de ligne de transport à afficher ou masquer, aux couleurs de la ligne. */
export function PastilleLigne({ ligne, couleur, couleurTexte, affichee, onChange, ...props }: Props) {
  return (
    <chakra.button
      type="button"
      aria-pressed={affichee}
      onClick={() => onChange(!affichee)}
      minW="7"
      px="1.5"
      py="0.5"
      borderRadius="sm"
      borderWidth="1.5px"
      borderColor={couleur}
      bg={affichee ? couleur : 'transparent'}
      color={affichee ? couleurTexte : 'fg.muted'}
      textStyle="2xs"
      fontWeight="semibold"
      cursor="pointer"
      opacity={affichee ? 1 : 0.7}
      {...props}
    >
      {ligne}
    </chakra.button>
  )
}
