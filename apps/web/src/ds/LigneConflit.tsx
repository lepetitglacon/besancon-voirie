import { Badge, HStack, type StackProps } from '@chakra-ui/react'
import type { ReactNode } from 'react'
import { Pastille } from './Pastille'

const GRAVITES = { incompatible: { palette: 'red', libelle: 'Incompatible' }, cede: { palette: 'orange', libelle: 'Cède' }, admis: { palette: 'green', libelle: 'Admis' } } as const

interface Props extends StackProps {
  /** Couleur de la liaison en conflit (token ou valeur CSS). */
  couleur: string
  libelle: ReactNode
  gravite: keyof typeof GRAVITES
}

/** Ligne de la liste des conflits d'une liaison : repère coloré, mouvement, gravité. */
export function LigneConflit({ couleur, libelle, gravite, ...props }: Props) {
  const { palette, libelle: texte } = GRAVITES[gravite]
  return (
    <HStack justify="space-between" textStyle="sm" py="1.5" {...props}>
      <HStack gap="2">
        <Pastille forme="carre" couleur={couleur} />
        {libelle}
      </HStack>
      <Badge colorPalette={palette}>{texte}</Badge>
    </HStack>
  )
}
