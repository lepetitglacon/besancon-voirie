import { Stack, type StackProps } from '@chakra-ui/react'
import type { ReactNode } from 'react'
import { LibelleSection } from './Texte'

/** Bloc d'une popup ou d'un panneau : libellé en petites capitales, puis son contenu. */
export function Section({ libelle, children, ...props }: StackProps & { libelle: ReactNode }) {
  return (
    <Stack gap="1.5" {...props}>
      <LibelleSection>{libelle}</LibelleSection>
      {children}
    </Stack>
  )
}
