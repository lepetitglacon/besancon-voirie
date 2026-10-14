import { createSlotRecipeContext, type HTMLChakraProps } from '@chakra-ui/react'
import type { ReactNode } from 'react'
import { bandeauMode } from '../theme/recettes-projet'

/** Bas de la barre d'outils flottante, en bas au centre de la carte. */
export const BAS_BARRE_OUTILS = '22px'

/** Hauteur d'une barre d'outils et de l'écart au-dessus : sous-outils et bandeau s'y empilent. */
export const HAUTEUR_BARRE_OUTILS = '66px'

const { withProvider, withContext } = createSlotRecipeContext({ recipe: bandeauMode })

const Racine = withProvider<HTMLDivElement, HTMLChakraProps<'div'>>('div', 'root', { defaultProps: { role: 'status' } })
const Titre = withContext<HTMLSpanElement, HTMLChakraProps<'span'>>('span', 'titre')
const Aide = withContext<HTMLSpanElement, HTMLChakraProps<'span'>>('span', 'aide')

interface Props extends Omit<HTMLChakraProps<'div'>, 'title'> {
  titre: ReactNode
  /** Consignes du mode. Un `<Kbd variant="inverse">` y a sa place. */
  aides?: ReactNode[]
}

/** Pilule sombre posée au-dessus de la barre d'outils, qui rappelle le mode en cours et comment en sortir. */
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
