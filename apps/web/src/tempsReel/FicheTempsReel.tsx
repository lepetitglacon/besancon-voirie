import { Badge, HStack, Stack, Text } from '@chakra-ui/react'
import type { CarrefourTempsReel } from '@voirie/schema'
import { Aide, TeteDeFeu, Valeur, type EtatLampe } from '../ds'
import { etatCarrefour, type EtatTempsReel } from './etats'
import { FIABILITES } from './libelles'
import { useMaintenant } from './useMaintenant'

const LAMPE: Record<EtatTempsReel, EtatLampe | null> = {
  vert: 'vert',
  jaune: 'orange',
  clignotant: 'orange',
  rouge: 'rouge',
  eteint: null,
  inconnu: null,
}

interface Props {
  /** null : carrefour sans programme saisi. */
  carrefour: CarrefourTempsReel | null
}

/** Fiche d'un carrefour en mode Temps réel : plan en vigueur, position dans le cycle, état de chaque ligne. */
export function FicheTempsReel({ carrefour }: Props) {
  const maintenant = useMaintenant(carrefour !== null)
  if (!carrefour) return <Aide>Programme pas encore saisi : ses feux ne sont pas rejoués.</Aide>

  const { plan, position, etats, fiabilite, reserves } = etatCarrefour(carrefour, maintenant)
  const { libelle, couleur, aide } = FIABILITES[fiabilite]
  return (
    <Stack gap="2.5">
      <HStack gap="1.5" wrap="wrap">
        <Badge colorPalette={couleur}>{libelle}</Badge>
        <Text textStyle="xs" color="fg.secondary">
          {plan ? `Plan « ${plan.code} »` : 'Aucun plan en vigueur'}
          {plan?.mode === 'jaune_clignotant' && ' · jaune clignotant'}
          {plan?.mode === 'eteint' && ' · éteint'}
        </Text>
        {position !== null && plan?.cycle_s && (
          <Valeur ms="auto" textStyle="xs" color="fg.secondary">
            {Math.floor(position)} s / {Math.round(plan.cycle_s)} s
          </Valeur>
        )}
      </HStack>
      <HStack gap="3" wrap="wrap" align="end">
        {carrefour.lignes.map((ligne) => (
          <Stack key={ligne.code} gap="1" align="center">
            <TeteDeFeu etat={LAMPE[etats.get(ligne.code) ?? 'inconnu']} taille={ligne.pieton ? 7 : 9} opacity={fiabilite === 'inconnue' ? 0.5 : 1} />
            <Text textStyle="2xs" fontWeight="semibold">
              {ligne.code}
            </Text>
          </Stack>
        ))}
      </HStack>
      <Aide>{aide}</Aide>
      {reserves.map((reserve) => (
        <Aide key={reserve}>⚠ {reserve}</Aide>
      ))}
    </Stack>
  )
}
