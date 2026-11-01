import { chakra, type HTMLChakraProps } from '@chakra-ui/react'
import type { EtatLampe } from './TeteDeFeu'

const LAMPES: EtatLampe[] = ['rouge', 'orange', 'vert']

/**
 * Tête de feu en icône, à la taille d'un glyphe de la barre d'outils : le boîtier suit la couleur du texte.
 * Sans état, les trois lampes sont allumées ; avec un état, seule la sienne l'est.
 */
export function IconeFeu({ etat, ...props }: HTMLChakraProps<'svg'> & { etat?: EtatLampe | null }) {
  return (
    <chakra.svg viewBox="0 0 12 22" w="auto" h="1.2em" display="inline-block" verticalAlign="middle" aria-hidden {...props}>
      <rect x="0.75" y="0.75" width="10.5" height="20.5" rx="3" fill="none" stroke="currentColor" strokeWidth="1.5" />
      {LAMPES.map((lampe, i) => (
        <circle
          key={lampe}
          cx="6"
          cy={5 + i * 6}
          r="2.2"
          fill={etat && etat !== lampe ? 'currentColor' : `var(--chakra-colors-feu-${lampe})`}
          opacity={etat && etat !== lampe ? 0.3 : 1}
        />
      ))}
    </chakra.svg>
  )
}
