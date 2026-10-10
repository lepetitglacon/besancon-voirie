/**
 * Tableau de bord de maturité (docs/pipeline-donnees.md, étape 5) : chaque carrefour, du moins
 * avancé au plus avancé, avec l'état de chaque niveau et son premier constat bloquant. Un clic
 * ouvre le carrefour.
 */
import { Badge, Box, Button, HStack, IconButton, Spinner, Stack, Text, type StackProps } from '@chakra-ui/react'
import { useQuery } from '@tanstack/react-query'
import type { MaturiteCarrefour, NiveauChaine } from '@voirie/schema'
import { useState } from 'react'
import { api } from '../api'
import { Aide, LibelleSection, Message, Segments } from '../ds'
import { EtatsNiveaux } from './NiveauxCarrefour'
import { NIVEAUX } from './libelles'

const STATUTS: Record<MaturiteCarrefour['carrefour']['statut'], { libelle: string; couleur: string }> = {
  a_confirmer: { libelle: 'à confirmer', couleur: 'gray' },
  non_releve: { libelle: 'non relevé', couleur: 'gray' },
  estime: { libelle: 'estimé', couleur: 'orange' },
  mesure: { libelle: 'mesuré', couleur: 'blue' },
  verifie: { libelle: 'vérifié', couleur: 'green' },
}

type Filtre = 'tous' | NiveauChaine

interface Props extends StackProps {
  onOuvrir: (maturite: MaturiteCarrefour) => void
  onFermer: () => void
}

export function TableauMaturite({ onOuvrir, onFermer, ...props }: Props) {
  const [filtre, setFiltre] = useState<Filtre>('tous')
  const { data, isPending, error, refetch, isFetching } = useQuery({ queryKey: ['maturite'], queryFn: api.maturite })
  const liste = (data ?? []).filter((m) => filtre === 'tous' || m.niveaux[filtre] !== 'ok')
  const complets = (data ?? []).filter((m) => NIVEAUX.every(({ niveau }) => m.niveaux[niveau] === 'ok')).length

  return (
    <Stack
      gap="2.5"
      w="380px"
      maxW="calc(100vw - 24px)"
      maxH="60vh"
      p="12px 14px"
      bg="bg.panel"
      borderRadius="l3"
      boxShadow="carte"
      aria-label="Maturité des carrefours"
      {...props}
    >
      <HStack justify="space-between">
        <LibelleSection>Maturité des carrefours{data ? ` · ${complets}/${data.length} complets` : ''}</LibelleSection>
        <HStack gap="1">
          <Button size="2xs" variant="ghost" loading={isFetching} onClick={() => void refetch()} title="Relire">
            ⟳
          </Button>
          <IconButton size="xs" variant="ghost" aria-label="Fermer le tableau" title="Fermer (M)" onClick={onFermer}>
            ×
          </IconButton>
        </HStack>
      </HStack>
      <Segments
        fitted
        size="xs"
        aria-label="Filtrer par niveau"
        valeur={filtre}
        onChange={setFiltre}
        options={[{ valeur: 'tous', libelle: 'Tous' }, ...NIVEAUX.map((n) => ({ valeur: n.niveau, libelle: `${n.libelle} à revoir` }))]}
      />
      {isPending && (
        <HStack gap="2">
          <Spinner size="xs" />
          <Aide>Contrôle de chaque carrefour…</Aide>
        </HStack>
      )}
      {error && <Message ton="erreur">{error.message}</Message>}
      {data && liste.length === 0 && <Aide>Aucun carrefour à revoir à ce niveau.</Aide>}
      <Stack gap="0" overflowY="auto">
        {liste.map((m) => {
          const bloquant = m.constats.find((c) => c.gravite === 'erreur') ?? m.constats[0]
          const statut = STATUTS[m.carrefour.statut]
          return (
            <Box
              key={m.carrefour.id}
              as="button"
              textAlign="left"
              py="2"
              borderBottomWidth="1px"
              borderColor="border.muted"
              _hover={{ bg: 'bg.muted' }}
              onClick={() => onOuvrir(m)}
              title={m.constats.map((c) => `${c.niveau} · ${c.message}`).join('\n') || 'Rien à redire'}
            >
              <HStack justify="space-between" gap="2">
                <Text textStyle="xs" fontWeight="semibold" truncate>
                  {m.carrefour.nom}
                </Text>
                <HStack gap="1" flexShrink={0}>
                  {!m.sur_le_reseau && <Badge colorPalette="gray">hors réseau</Badge>}
                  <Badge colorPalette={statut.couleur}>{statut.libelle}</Badge>
                </HStack>
              </HStack>
              <EtatsNiveaux maturite={m} />
              {bloquant && (
                <Message ton={bloquant.gravite} truncate>
                  {bloquant.niveau} · {bloquant.message}
                </Message>
              )}
            </Box>
          )
        })}
      </Stack>
    </Stack>
  )
}
