import { useQueryClient } from '@tanstack/react-query'
import { ETAPES_ACTIVES, type LancementSumo } from '@voirie/schema'
import { Badge, Box, Button, HStack, Progress, Stack, Text } from '@chakra-ui/react'
import { useState } from 'react'
import { api } from '../api'
import { Aide, Chiffre, Message } from '../ds'
import { etatSumo } from './etat'
import { heure } from './indicateurs'

const LIBELLES_ETAPE: Record<LancementSumo['etape'], { libelle: string; couleur: string }> = {
  preparation: { libelle: 'Préparation', couleur: 'blue' },
  simulation: { libelle: 'Simulation', couleur: 'blue' },
  archivage: { libelle: 'Archivage', couleur: 'blue' },
  fini: { libelle: 'Terminé', couleur: 'green' },
  erreur: { libelle: 'Erreur', couleur: 'red' },
  annule: { libelle: 'Arrêté', couleur: 'gray' },
}

const duree = (secondes: number) =>
  secondes < 60 ? `${Math.round(secondes)} s` : `${Math.floor(secondes / 60)} min ${String(Math.round(secondes % 60)).padStart(2, '0')}`

interface Props {
  lancement: LancementSumo
  onFermer: () => void
}

/** Avancement d'un lancement : étape, heure simulée, état de la ville, temps restant. */
export function SuiviLancement({ lancement, onFermer }: Props) {
  const queryClient = useQueryClient()
  const [arret, setArret] = useState(false)
  const actif = ETAPES_ACTIVES.includes(lancement.etape)
  const etape = LIBELLES_ETAPE[lancement.etape]
  const { progression: p, debutSimule, finSimulee } = lancement
  const fait =
    p && debutSimule !== null && finSimulee !== null ? Math.min(100, ((p.temps - debutSimule) / (finSimulee - debutSimule)) * 100) : null

  const arreter = async () => {
    if (!window.confirm(`Arrêter « ${lancement.nom} » ? La simulation en cours est perdue.`)) return
    setArret(true)
    try {
      await api.annulerLancementSumo(lancement.id)
    } finally {
      setArret(false)
      void queryClient.invalidateQueries({ queryKey: ['sumo-lancements'] })
    }
  }

  return (
    <Stack gap="2" p="2.5" borderRadius="l2" borderWidth="1px" borderColor="border.muted" bg="bg.muted">
      <HStack justify="space-between" gap="2">
        <Box minW="0">
          <Text textStyle="sm" fontWeight="semibold" truncate>
            {lancement.nom}
          </Text>
          <Aide>
            {lancement.detail || etape.libelle} · {duree(lancement.ecoule)}
            {lancement.restant !== null && ` · encore ~${duree(lancement.restant)}`}
          </Aide>
        </Box>
        <Badge colorPalette={etape.couleur} flexShrink={0}>
          {etape.libelle}
        </Badge>
      </HStack>

      {actif && (
        <Progress.Root size="xs" value={fait ?? null} colorPalette="blue">
          <Progress.Track>
            <Progress.Range />
          </Progress.Track>
        </Progress.Root>
      )}

      {p && (
        <>
          <HStack gap="1">
            <Chiffre valeur={heure(p.temps)} libelle="heure simulée" />
            <Chiffre valeur={p.enRoute.toLocaleString('fr-FR')} libelle="en route" />
            <Chiffre valeur={p.aLArret.toLocaleString('fr-FR')} libelle="à l'arrêt" />
          </HStack>
          <Aide>
            {p.inseres.toLocaleString('fr-FR')} parties · {p.arrives.toLocaleString('fr-FR')} arrivées · {p.vitesse} km/h
            de moyenne · {p.teleportations.toLocaleString('fr-FR')} téléportations
            {finSimulee !== null && ` · jusqu'à ${heure(finSimulee)}`}
          </Aide>
        </>
      )}

      {lancement.etape === 'erreur' && lancement.journal && (
        <Box as="pre" textStyle="2xs" whiteSpace="pre-wrap" maxH="140px" overflowY="auto" p="2" bg="bg.panel" borderRadius="l1">
          {lancement.journal.trim()}
        </Box>
      )}
      {lancement.etape === 'erreur' && !lancement.journal && <Message ton="erreur">{lancement.detail}</Message>}

      <HStack gap="1.5" justify="flex-end">
        {actif ? (
          <Button size="2xs" variant="outline" colorPalette="red" loading={arret} onClick={() => void arreter()}>
            Arrêter
          </Button>
        ) : (
          <>
            {lancement.essaiId && (
              <Button size="2xs" onClick={() => etatSumo.modifier({ essaiId: lancement.essaiId, troncon: null })}>
                Voir l'essai
              </Button>
            )}
            <Button size="2xs" variant="ghost" onClick={onFermer}>
              Masquer
            </Button>
          </>
        )}
      </HStack>
    </Stack>
  )
}
