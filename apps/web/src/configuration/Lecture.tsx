import { Button, HStack } from '@chakra-ui/react'
import { Segments, Valeur } from '../ds'

const VITESSES = ['1', '4', '10']

const secondes = (s: number) => `${Math.round(s * 10) / 10} s`

interface Props {
  instant: number
  vitesse: number | null
  onVitesse: (vitesse: number | null) => void
}

/** Lecture du cycle ou de la simulation : lecture / pause, vitesse, instant lu. */
export function Lecture({ instant, vitesse, onVitesse }: Props) {
  return (
    <HStack gap="2">
      <Button variant="encre" size="xs" onClick={() => onVitesse(vitesse ? null : 1)} aria-pressed={vitesse !== null}>
        {vitesse ? '⏸ Pause' : '▶ Lecture'}
      </Button>
      <Segments
        size="xs"
        aria-label="Vitesse de lecture"
        valeur={vitesse === null ? null : String(vitesse)}
        onChange={(v) => onVitesse(Number(v))}
        options={VITESSES.map((v) => ({ valeur: v, libelle: `×${v}` }))}
      />
      <Valeur ms="auto" textStyle="xs" color="fg.secondary">
        t = {secondes(Math.floor(instant * 10) / 10)}
      </Valeur>
    </HStack>
  )
}
