/** Contrôles d'un carrefour, niveau par niveau : un état par niveau, puis ses constats. */
import { HStack, Stack, Text } from '@chakra-ui/react'
import type { MaturiteCarrefour } from '@voirie/schema'
import { Aide, Message } from '../ds'
import { COULEURS_ETAT, NIVEAUX, SYMBOLES_ETAT } from './libelles'

/** ✔ Carrefour · ⚠ Feux · ✖ SUMO, sur une ligne. */
export function EtatsNiveaux({ maturite }: { maturite: MaturiteCarrefour }) {
  return (
    <HStack gap="2.5" textStyle="xs">
      {NIVEAUX.map(({ niveau, libelle, titre }) => (
        <Text key={niveau} as="span" color={COULEURS_ETAT[maturite.niveaux[niveau]]} title={`${niveau} · ${titre}`} whiteSpace="nowrap">
          {SYMBOLES_ETAT[maturite.niveaux[niveau]]} {libelle}
        </Text>
      ))}
    </HStack>
  )
}

/** États et constats d'un carrefour (ce qui est enregistré). */
export function NiveauxCarrefour({ maturite }: { maturite: MaturiteCarrefour }) {
  return (
    <Stack gap="1">
      <EtatsNiveaux maturite={maturite} />
      {maturite.constats.length === 0 ? (
        <Aide>Rien à redire sur ce qui est enregistré.</Aide>
      ) : (
        <Stack as="ul" gap="0.5" listStyleType="none" maxH="140px" overflowY="auto">
          {maturite.constats.map((c, i) => (
            <Message as="li" key={`${c.code}-${i}`} ton={c.gravite}>
              {c.niveau} · {c.message}
            </Message>
          ))}
        </Stack>
      )}
    </Stack>
  )
}
