import { createSlotRecipeContext, type HTMLChakraProps } from '@chakra-ui/react'
import type { ReactNode } from 'react'
import { carteEnTete } from '../theme/recettes-projet'

const { withProvider, withContext } = createSlotRecipeContext({ recipe: carteEnTete })

const Racine = withProvider<HTMLDivElement, HTMLChakraProps<'div'>>('div', 'root')
const Surtitre = withContext<HTMLDivElement, HTMLChakraProps<'div'>>('div', 'surtitre')
const Titre = withContext<HTMLDivElement, HTMLChakraProps<'div'>>('div', 'titre')
const Badges = withContext<HTMLDivElement, HTMLChakraProps<'div'>>('div', 'badges')

interface Props extends Omit<HTMLChakraProps<'div'>, 'title'> {
  surtitre?: ReactNode
  titre: ReactNode
  /** Badges d'état : sélection, modifications, synchronisation OSM. */
  badges?: ReactNode
}

/** Carte d'en-tête posée en haut à gauche de la carte. */
export function CarteEnTete({ surtitre, titre, badges, children, ...props }: Props) {
  return (
    <Racine {...props}>
      {surtitre && <Surtitre>{surtitre}</Surtitre>}
      <Titre>{titre}</Titre>
      {badges && <Badges>{badges}</Badges>}
      {children}
    </Racine>
  )
}
