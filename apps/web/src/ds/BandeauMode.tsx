import { createSlotRecipeContext, type HTMLChakraProps } from '@chakra-ui/react'
import type { ReactNode } from 'react'
import { bandeauMode } from '../theme/recettes-projet'

const { withProvider, withContext } = createSlotRecipeContext({ recipe: bandeauMode })

const Racine = withProvider<HTMLDivElement, HTMLChakraProps<'div'>>('div', 'root', { defaultProps: { role: 'status' } })
const Titre = withContext<HTMLSpanElement, HTMLChakraProps<'span'>>('span', 'titre')
const Aide = withContext<HTMLSpanElement, HTMLChakraProps<'span'>>('span', 'aide')

interface Props extends Omit<HTMLChakraProps<'div'>, 'title'> {
  titre: ReactNode
  /** Consignes du mode. Un `<Kbd variant="inverse">` y a sa place. */
  aides?: ReactNode[]
}

/** Pilule sombre en haut de la carte, qui rappelle le mode en cours et comment en sortir. */
export function BandeauMode({ titre, aides = [], ...props }: Props) {
  return (
    <Racine {...props}>
      <Titre>{titre}</Titre>
      {aides.map((aide, i) => (
        <Aide key={i}>{aide}</Aide>
      ))}
    </Racine>
  )
}
