import { Box, Stack, type StackProps } from '@chakra-ui/react'

export type EtatLampe = 'rouge' | 'orange' | 'vert'
const LAMPES: EtatLampe[] = ['rouge', 'orange', 'vert']

/** Tête de feu tricolore ; seule la lampe de l'état donné est allumée. */
export function TeteDeFeu({ etat, taille = 9, ...props }: StackProps & { etat: EtatLampe | null; taille?: number }) {
  return (
    <Stack gap="3px" p="1" bg="gray.900" borderRadius="6px" flexShrink={0} aria-hidden {...props}>
      {LAMPES.map((lampe) => (
        <Box
          key={lampe}
          w={`${taille}px`}
          h={`${taille}px`}
          borderRadius="full"
          bg={etat === lampe ? `feu.${lampe}` : 'feu.eteint'}
          boxShadow={etat === lampe ? `0 0 6px var(--chakra-colors-feu-${lampe})` : undefined}
        />
      ))}
    </Stack>
  )
}
