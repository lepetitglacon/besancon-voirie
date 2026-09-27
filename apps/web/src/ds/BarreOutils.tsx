import { chakra, createSlotRecipeContext, type HTMLChakraProps } from '@chakra-ui/react'
import type { ReactNode } from 'react'
import { barreOutils } from '../theme/recettes-projet'

const { withProvider, withContext } = createSlotRecipeContext({ recipe: barreOutils })

const Racine = withProvider<HTMLDivElement, HTMLChakraProps<'div'>>('div', 'root', { defaultProps: { role: 'toolbar' } })
const Bouton = withContext<HTMLButtonElement, HTMLChakraProps<'button'>>('button', 'outil')
const Glyphe = withContext<HTMLSpanElement, HTMLChakraProps<'span'>>('span', 'glyphe')
const Libelle = withContext<HTMLSpanElement, HTMLChakraProps<'span'>>('span', 'libelle')
const Raccourci = withContext<HTMLSpanElement, HTMLChakraProps<'span'>>('span', 'raccourci')
const Trait = withContext<HTMLDivElement, HTMLChakraProps<'div'>>('div', 'separateur')

/** Barre d'outils flottante : `<BarreOutils.Root>` puis des `<BarreOutils.Outil>`. */
export function Root(props: HTMLChakraProps<'div'>) {
  return <Racine {...props} />
}

interface OutilProps extends Omit<HTMLChakraProps<'button'>, 'children'> {
  glyphe: ReactNode
  libelle: string
  /** Touche du clavier qui active l'outil. */
  raccourci?: string
  actif?: boolean
}

/** Un outil : glyphe, libellé et raccourci clavier ; enfoncé quand il est actif. */
export function Outil({ glyphe, libelle, raccourci, actif = false, ...props }: OutilProps) {
  return (
    <Bouton type="button" aria-pressed={actif} title={raccourci ? `${libelle} (${raccourci})` : libelle} {...props}>
      <Glyphe>{glyphe}</Glyphe>
      <Libelle>
        {libelle}
        {raccourci && <Raccourci>{raccourci}</Raccourci>}
      </Libelle>
    </Bouton>
  )
}

/** Trait vertical entre deux groupes d'outils. */
export function Separateur(props: HTMLChakraProps<'div'>) {
  return <Trait aria-hidden {...props} />
}

/** Repousse la suite vers la droite (barre, pied de popup). */
export function Espace(props: HTMLChakraProps<'div'>) {
  return <chakra.div flex="1" {...props} />
}
