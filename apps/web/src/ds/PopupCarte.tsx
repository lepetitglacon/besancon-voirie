import { createSlotRecipeContext, type HTMLChakraProps, type RecipeVariantProps } from '@chakra-ui/react'
import { Children, type ReactNode } from 'react'
import { Popup, type PopupProps } from 'react-map-gl/maplibre'
import { popupCarte } from '../theme/recettes-projet'

const { withProvider, withContext } = createSlotRecipeContext({ recipe: popupCarte })

type RacineProps = HTMLChakraProps<'div'> & RecipeVariantProps<typeof popupCarte>
const Racine = withProvider<HTMLDivElement, RacineProps>('div', 'root', { defaultProps: { role: 'dialog' } })
const Entete = withContext<HTMLDivElement, HTMLChakraProps<'div'>>('div', 'entete')
const Icone = withContext<HTMLDivElement, HTMLChakraProps<'div'>>('div', 'icone')
const Titres = withContext<HTMLDivElement, HTMLChakraProps<'div'>>('div', 'titres')
const Titre = withContext<HTMLSpanElement, HTMLChakraProps<'span'>>('span', 'titre')
const SousTitre = withContext<HTMLSpanElement, HTMLChakraProps<'span'>>('span', 'soustitre')
const Fermer = withContext<HTMLButtonElement, HTMLChakraProps<'button'>>('button', 'fermer')
const Corps = withContext<HTMLDivElement, HTMLChakraProps<'div'>>('div', 'corps')
const Pied = withContext<HTMLDivElement, HTMLChakraProps<'div'>>('div', 'pied')

interface Props extends Omit<RacineProps, 'title'> {
  titre: ReactNode
  soustitre?: ReactNode
  icone?: ReactNode
  onFermer?: () => void
  /** Actions : « Supprimer » à gauche, puis un `<BarreOutils.Espace>` et les actions à droite. */
  pied?: ReactNode
}

/** Popup d'un élément de la carte : en-tête, sections, pied d'actions. */
export function PopupCarte({ titre, soustitre, icone, onFermer, pied, children, ...props }: Props) {
  return (
    <Racine {...props}>
      <Entete>
        {icone && <Icone>{icone}</Icone>}
        <Titres>
          <Titre>{titre}</Titre>
          {soustitre && <SousTitre>{soustitre}</SousTitre>}
        </Titres>
        {onFermer && (
          <Fermer type="button" aria-label="Fermer" onClick={onFermer}>
            ×
          </Fermer>
        )}
      </Entete>
      {Children.toArray(children).length > 0 && <Corps>{children}</Corps>}
      {pied && <Pied>{pied}</Pied>}
    </Racine>
  )
}

/**
 * Ancre une `PopupCarte` à une position de la carte : la popup MapLibre suit les mouvements,
 * son habillage est retiré (voir `.popup-carte-ancre` dans index.css).
 */
export function PopupSurCarte({ children, className, ...props }: PopupProps) {
  return (
    <Popup closeButton={false} maxWidth="none" offset={12} className={['popup-carte-ancre', className].filter(Boolean).join(' ')} {...props}>
      {children}
    </Popup>
  )
}
