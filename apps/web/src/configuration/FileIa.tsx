import { Badge, Button, HStack, IconButton, Spinner, Stack, Text } from '@chakra-ui/react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { AnalyseIa } from '@voirie/schema'
import { useEffect, useState } from 'react'
import { api } from '../api'
import { Aide, LibelleSection, notifications } from '../ds'
import { enFile } from './analysesIa'

const secondesDepuis = (depuis: string) => Math.max(0, Math.round((Date.now() - Date.parse(depuis)) / 1000))

/** Secondes écoulées depuis une date ISO, mises à jour chaque seconde. */
export function Chrono({ depuis }: { depuis: string }) {
  const [secondes, setSecondes] = useState(() => secondesDepuis(depuis))
  useEffect(() => {
    const minuterie = window.setInterval(() => setSecondes(secondesDepuis(depuis)), 1000)
    return () => window.clearInterval(minuterie)
  }, [depuis])
  return <>{secondes} s</>
}

/** État d'une analyse en quelques mots. */
export function EtatAnalyse({ analyse }: { analyse: AnalyseIa }) {
  switch (analyse.statut) {
    case 'en_attente':
      return <Badge colorPalette="gray" alignSelf="start">en attente{analyse.rang ? ` · n° ${analyse.rang}` : ''}</Badge>
    case 'en_cours':
      return (
        <HStack gap="1.5">
          <Spinner size="xs" color="fg.muted" />
          <Aide>analyse… {analyse.commencee_le && <Chrono depuis={analyse.commencee_le} />}</Aide>
        </HStack>
      )
    case 'terminee':
      return <Badge colorPalette={analyse.consultee_le ? 'gray' : 'green'} alignSelf="start">{analyse.consultee_le ? 'ouverte' : 'prête'}</Badge>
    case 'echec':
      return (
        <Badge colorPalette="red" alignSelf="start" title={analyse.erreur ?? undefined}>
          échec
        </Badge>
      )
  }
}

interface Props {
  analyses: AnalyseIa[]
  onOuvrir: (analyse: AnalyseIa) => void
}

/** Liste des propositions OSM + IA en file, en cours ou prêtes, pour y revenir à tout moment. */
export function FileIa({ analyses, onOuvrir }: Props) {
  const queryClient = useQueryClient()
  const retrait = useMutation({
    mutationFn: api.retirerAnalyseIa,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['analyses-ia'] }),
    onError: (erreur) => notifications.create({ type: 'error', title: 'Retrait impossible', description: erreur.message }),
  })
  if (analyses.length === 0) return null
  const enCours = analyses.filter(enFile).length

  return (
    <Stack gap="1.5">
      <LibelleSection>
        ✦ Propositions IA{enCours > 0 && ` · ${enCours} en file`}
      </LibelleSection>
      {analyses.map((analyse) => (
        <HStack key={analyse.id} gap="2" justify="space-between">
          <Stack gap="0.5" minW="0" flex="1">
            <Text textStyle="xs" truncate title={analyse.carrefour.nom}>
              {analyse.carrefour.nom}
            </Text>
            <EtatAnalyse analyse={analyse} />
          </Stack>
          {analyse.statut === 'terminee' && (
            <Button size="xs" variant={analyse.consultee_le ? 'outline' : 'solid'} onClick={() => onOuvrir(analyse)}>
              Ouvrir
            </Button>
          )}
          {analyse.statut !== 'en_cours' && (
            <IconButton
              size="xs"
              variant="ghost"
              aria-label={analyse.statut === 'en_attente' ? 'Annuler la demande' : 'Retirer de la liste'}
              title={analyse.statut === 'en_attente' ? 'Annuler la demande' : 'Retirer de la liste'}
              onClick={() => retrait.mutate(analyse.id)}
              disabled={retrait.isPending}
            >
              ×
            </IconButton>
          )}
        </HStack>
      ))}
    </Stack>
  )
}
