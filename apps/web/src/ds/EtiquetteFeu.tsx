import { chakra, type HTMLChakraProps } from '@chakra-ui/react'
import type { EtatLampe } from './TeteDeFeu'

interface Props extends Omit<HTMLChakraProps<'span'>, 'children'> {
  /** Codes des lignes de feux que ce feu physique affiche (F1, P2…) ; vide : feu sans ligne. */
  lignes: readonly string[]
  /** Couleur affichée en ce moment ; null : inconnue. */
  etat?: EtatLampe | null
  /** Mis en avant (ligne survolée ou choisie). */
  actif?: boolean
  /** Position déduite (aucun feu physique connu) : bord en pointillés. */
  deduit?: boolean
}

/**
 * Étiquette d'un feu posée sur la carte : le code de sa ligne de feux, pour savoir sur place quel
 * feu est F1 ou P2. Bordée de la couleur du feu quand elle est connue, en pointillés quand la
 * position est déduite de la voie faute de feu physique rattaché.
 */
export function EtiquetteFeu({ lignes, etat = null, actif = false, deduit = false, ...props }: Props) {
  return (
    <chakra.span
      display="inline-flex"
      alignItems="center"
      px="1.5"
      minW="6"
      h="5"
      justifyContent="center"
      borderRadius="full"
      bg={actif ? 'brand.solid' : 'gray.900'}
      color="white"
      fontSize="11px"
      fontWeight="bold"
      lineHeight="1"
      borderWidth="2px"
      borderStyle={deduit ? 'dashed' : 'solid'}
      borderColor={etat ? `feu.${etat}` : 'white'}
      boxShadow="0 1px 3px rgba(0, 0, 0, 0.5)"
      whiteSpace="nowrap"
      opacity={lignes.length === 0 ? 0.6 : 1}
      title={
        lignes.length === 0
          ? 'Feu sans ligne de feux'
          : deduit
            ? `${lignes.join(', ')} : position déduite de la voie (aucun feu physique rattaché)`
            : `Feu de ${lignes.join(', ')}`
      }
      {...props}
    >
      {lignes.length === 0 ? '?' : lignes.join(' ')}
    </chakra.span>
  )
}
