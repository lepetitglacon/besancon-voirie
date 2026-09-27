import { Box, type BoxProps } from '@chakra-ui/react'

/**
 * Repère de couleur : point (état d'un feu), carré (ligne en conflit) ou trait (légende).
 * `couleur` accepte un token (`feu.vert`) ou une valeur CSS.
 */
export function Pastille({ couleur, forme = 'point', ...props }: BoxProps & { couleur: string; forme?: 'point' | 'carre' | 'trait' }) {
  const taille = forme === 'point' ? { w: '2', h: '2', borderRadius: 'full' } : forme === 'carre' ? { w: '10px', h: '10px', borderRadius: '3px' } : { w: '14px', h: '5px', borderRadius: '2px' }
  return <Box as="span" display="inline-block" flexShrink={0} bg={couleur} {...taille} {...props} />
}
