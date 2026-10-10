import { chakra, HStack, type StackProps } from '@chakra-ui/react'
import { useState } from 'react'

interface Props extends Omit<StackProps, 'onChange'> {
  /** null : champ vide (la valeur par défaut s'applique, affichée en `placeholder`). */
  valeur: number | null
  onChange: (valeur: number | null) => void
  min?: number
  max?: number
  pas?: number
  /** Unité affichée après la valeur : « s », « m ». */
  unite?: string
  placeholder?: string
  'aria-label': string
  taille?: 'xs' | 'sm'
}

const borner = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

const Bouton = chakra('button', {
  base: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    color: 'fg.secondary',
    cursor: 'pointer',
    _hover: { bg: 'bg.muted' },
    _disabled: { opacity: 0.4, cursor: 'default', _hover: { bg: 'transparent' } },
    focusVisibleRing: 'inside',
  },
})

/** Saisie d'un nombre avec − et + : durées, nombre de voies. Flèches haut / bas au clavier. */
export function Compteur({ valeur, onChange, min = 0, max = Infinity, pas = 1, unite, placeholder, taille = 'sm', ...props }: Props) {
  // Texte en cours de saisie : « 1 » en route vers « 12 » ne doit pas être corrigé à chaque frappe.
  const [saisie, setSaisie] = useState<string | null>(null)

  const cote = taille === 'xs' ? '6' : '7'
  const changer = (v: number) => onChange(borner(v, min, max))
  const actuelle = valeur ?? (placeholder !== undefined ? Number(placeholder) : min)

  return (
    <HStack
      gap="0"
      display="inline-flex"
      borderWidth="1px"
      borderColor="border"
      borderRadius="l2"
      bg="bg.panel"
      overflow="hidden"
      flexShrink={0}
      {...props}
    >
      <Bouton type="button" w={cote} h={cote} aria-label="Diminuer" disabled={actuelle <= min} onClick={() => changer(actuelle - pas)}>
        −
      </Bouton>
      <chakra.input
        value={saisie ?? (valeur === null ? '' : String(valeur))}
        placeholder={placeholder}
        inputMode={min < 0 || pas % 1 !== 0 ? 'decimal' : 'numeric'}
        aria-label={props['aria-label']}
        // Assez large pour la plus longue valeur : borne, valeur courante (décimales, signe).
        w={`${Math.max(2, String(max === Infinity ? 999 : max).length, String(valeur ?? '').length) + 1}ch`}
        textAlign="center"
        fontFamily="mono"
        textStyle={taille === 'xs' ? 'xs' : 'sm'}
        bg="transparent"
        outline="none"
        _placeholder={{ color: 'fg.subtle' }}
        onChange={(e) => {
          const texte = e.target.value.replace(',', '.').replace(min < 0 ? /[^0-9.-]/g : /[^0-9.]/g, '')
          setSaisie(texte)
          if (texte === '') onChange(null)
          else if (texte !== '-' && !Number.isNaN(Number(texte))) changer(Number(texte))
        }}
        onBlur={() => setSaisie(null)}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
          e.preventDefault()
          setSaisie(null)
          changer(actuelle + (e.key === 'ArrowUp' ? pas : -pas))
        }}
      />
      {unite && (
        <chakra.span pe="1" textStyle={taille === 'xs' ? 'xs' : 'sm'} fontFamily="mono" color="fg.muted">
          {unite}
        </chakra.span>
      )}
      <Bouton type="button" w={cote} h={cote} aria-label="Augmenter" disabled={actuelle >= max} onClick={() => changer(actuelle + pas)}>
        +
      </Bouton>
    </HStack>
  )
}
