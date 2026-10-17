import { chakra, createSlotRecipeContext, type HTMLChakraProps } from '@chakra-ui/react'
import { useRef, type PointerEvent, type ReactNode } from 'react'
import { usePreference } from '../preferences'
import { carteEnTete } from '../theme/recettes-projet'

const { withProvider, withContext } = createSlotRecipeContext({ recipe: carteEnTete })

const Racine = withProvider<HTMLDivElement, HTMLChakraProps<'div'>>('div', 'root')
const Surtitre = withContext<HTMLDivElement, HTMLChakraProps<'div'>>('div', 'surtitre')
const Titre = withContext<HTMLDivElement, HTMLChakraProps<'div'>>('div', 'titre')
const Badges = withContext<HTMLDivElement, HTMLChakraProps<'div'>>('div', 'badges')

/** Bornes du redimensionnement, en pixels. */
const LARGEUR_MIN = 280
const HAUTEUR_MIN = 160

interface Props extends Omit<HTMLChakraProps<'div'>, 'title'> {
  surtitre?: ReactNode
  titre: ReactNode
  /** Badges d'état : sélection, modifications, synchronisation OSM. */
  badges?: ReactNode
  /**
   * Clé sous laquelle mémoriser la taille choisie : la carte se redimensionne alors par ses bords
   * droit et bas (double-clic : taille d'origine). Le dernier enfant défile si la hauteur est fixée.
   */
  redimensionnable?: string
}

/** Carte d'en-tête posée en haut à gauche de la carte. */
export function CarteEnTete({ surtitre, titre, badges, redimensionnable, children, ...props }: Props) {
  return (
    <Cadre cle={redimensionnable} {...props}>
      {surtitre && <Surtitre>{surtitre}</Surtitre>}
      <Titre>{titre}</Titre>
      {badges && <Badges>{badges}</Badges>}
      {children}
    </Cadre>
  )
}

type Taille = { largeur: number | null; hauteur: number | null }

function Cadre({ cle, children, ...props }: HTMLChakraProps<'div'> & { cle?: string }) {
  if (!cle) return <Racine {...props}>{children}</Racine>
  return (
    <Redimensionnable cle={cle} {...props}>
      {children}
    </Redimensionnable>
  )
}

function Redimensionnable({ cle, children, ...props }: HTMLChakraProps<'div'> & { cle: string }) {
  const [taille, setTaille] = usePreference<Taille>(`taille-${cle}`, { largeur: null, hauteur: null })
  const racine = useRef<HTMLDivElement>(null)
  /** Taille et pointeur au début du glisser. */
  const depart = useRef<{ x: number; y: number; largeur: number; hauteur: number } | null>(null)

  const commencer = (e: PointerEvent<HTMLElement>) => {
    const cadre = racine.current?.getBoundingClientRect()
    if (!cadre) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    depart.current = { x: e.clientX, y: e.clientY, largeur: cadre.width, hauteur: cadre.height }
  }
  const tirer = (sens: 'largeur' | 'hauteur') => (e: PointerEvent<HTMLElement>) => {
    const d = depart.current
    if (!d || !e.currentTarget.hasPointerCapture(e.pointerId)) return
    setTaille((t) =>
      sens === 'largeur'
        ? { ...t, largeur: Math.round(Math.min(window.innerWidth - 24, Math.max(LARGEUR_MIN, d.largeur + e.clientX - d.x))) }
        : { ...t, hauteur: Math.round(Math.min(window.innerHeight - 24, Math.max(HAUTEUR_MIN, d.hauteur + e.clientY - d.y))) },
    )
  }
  const poignee = (sens: 'largeur' | 'hauteur') => ({
    'aria-hidden': true,
    title: 'Tirer pour redimensionner, double-clic pour revenir à la taille d’origine',
    onPointerDown: commencer,
    onPointerMove: tirer(sens),
    onPointerUp: () => (depart.current = null),
    onDoubleClick: () => setTaille((t) => ({ ...t, [sens]: null })),
  })

  return (
    <Racine
      ref={racine}
      {...props}
      position={props.position ?? 'relative'}
      {...(taille.largeur !== null && { w: `${taille.largeur}px` })}
      {...(taille.hauteur !== null && {
        h: `${taille.hauteur}px`,
        // Hauteur imposée : le contenu (dernier enfant avant les poignées) occupe le reste et défile
        // (les deux poignées viennent après lui).
        css: { '& > :nth-last-child(3)': { flex: '1 1 auto', minHeight: 0, maxHeight: 'none', overflowY: 'auto' } },
      })}
    >
      {children}
      <chakra.div position="absolute" top="3" bottom="3" right="-1" w="2" cursor="ew-resize" {...poignee('largeur')} />
      <chakra.div position="absolute" left="3" right="3" bottom="-1" h="2" cursor="ns-resize" {...poignee('hauteur')} />
    </Racine>
  )
}
