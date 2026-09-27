import { SegmentGroup, type SegmentGroupRootProps } from '@chakra-ui/react'
import type { ReactNode } from 'react'

export interface OptionSegment<V extends string> {
  valeur: V
  libelle: ReactNode
  desactive?: boolean
}

interface Props<V extends string> extends Omit<SegmentGroupRootProps, 'value' | 'onValueChange' | 'defaultValue' | 'onChange'> {
  /** null : aucun segment choisi. */
  valeur: V | null
  onChange: (valeur: V) => void
  options: OptionSegment<V>[]
}

/** Contrôle segmenté : un seul choix parmi quelques options courtes. */
export function Segments<V extends string>({ valeur, onChange, options, ...props }: Props<V>) {
  return (
    <SegmentGroup.Root value={valeur} onValueChange={(e) => e.value !== null && onChange(e.value as V)} {...props}>
      <SegmentGroup.Indicator />
      {options.map((option) => (
        <SegmentGroup.Item key={option.valeur} value={option.valeur} disabled={option.desactive}>
          <SegmentGroup.ItemText>{option.libelle}</SegmentGroup.ItemText>
          <SegmentGroup.ItemHiddenInput />
        </SegmentGroup.Item>
      ))}
    </SegmentGroup.Root>
  )
}
