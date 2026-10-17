import { createSlotRecipeContext, type HTMLChakraProps, type RecipeVariantProps } from '@chakra-ui/react'
import type { ReactNode } from 'react'
import { panneauBas } from '../theme/recettes-projet'

/** Panneau ancré en bas ou à droite de l'écran (plan de feux) : Root, Entete, Corps. */

const { withProvider, withContext } = createSlotRecipeContext({ recipe: panneauBas })

const Racine = withProvider<HTMLDivElement, HTMLChakraProps<'section'> & RecipeVariantProps<typeof panneauBas>>('section', 'root')
const EnteteBase = withContext<HTMLDivElement, HTMLChakraProps<'header'>>('header', 'entete')
const Titre = withContext<HTMLHeadingElement, HTMLChakraProps<'h2'>>('h2', 'titre')
const Contenu = withContext<HTMLDivElement, HTMLChakraProps<'div'>>('div', 'corps')

export function Root(props: HTMLChakraProps<'section'> & RecipeVariantProps<typeof panneauBas>) {
  return <Racine {...props} />
}

/** Zone défilante sous l'en-tête. */
export function Corps(props: HTMLChakraProps<'div'>) {
  return <Contenu {...props} />
}

/** En-tête : titre à gauche, puis les contrôles passés en enfants. */
export function Entete({ titre, children, ...props }: Omit<HTMLChakraProps<'header'>, 'title'> & { titre: ReactNode }) {
  return (
    <EnteteBase {...props}>
      <Titre>{titre}</Titre>
      {children}
    </EnteteBase>
  )
}
