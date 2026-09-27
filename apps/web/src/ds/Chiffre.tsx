import { createSlotRecipeContext, type HTMLChakraProps } from '@chakra-ui/react'
import type { ReactNode } from 'react'
import { chiffre } from '../theme/recettes-projet'

const { withProvider, withContext } = createSlotRecipeContext({ recipe: chiffre })

const Racine = withProvider<HTMLDivElement, HTMLChakraProps<'div'>>('div', 'root')
const Nombre = withContext<HTMLSpanElement, HTMLChakraProps<'span'>>('span', 'valeur')
const Libelle = withContext<HTMLSpanElement, HTMLChakraProps<'span'>>('span', 'libelle')

/** Chiffre clé d'un carrefour : « 4 branches », « 90 s cycle ». */
export function Chiffre({ valeur, libelle, ...props }: HTMLChakraProps<'div'> & { valeur: ReactNode; libelle: ReactNode }) {
  return (
    <Racine {...props}>
      <Nombre>{valeur}</Nombre>
      <Libelle>{libelle}</Libelle>
    </Racine>
  )
}
