import { Badge, Button, HStack, IconButton, Stack, Table, Text } from '@chakra-ui/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { cycleObserve, planEnVigueur, positionCycle, type ResultatProgramme } from '@voirie/engine'
import type { ConfianceSynchro, PlanEtapes, PlanSaisi, TopsCarrefour } from '@voirie/schema'
import { useEffect, useState } from 'react'
import { api } from '../api'
import { Aide, Bascule, Message, Selecteur, Valeur } from '../ds'
import { useMaintenant } from '../tempsReel/useMaintenant'

const CONFIANCE: Record<ConfianceSynchro, { libelle: string; couleur: string }> = {
  inconnue: { libelle: 'Phase inconnue', couleur: 'gray' },
  estimee: { libelle: 'Estimé (un jour)', couleur: 'blue' },
  synchronisee: { libelle: 'Synchronisé', couleur: 'green' },
  incoherente: { libelle: 'Tops discordants', couleur: 'orange' },
}

const horodatage = (iso: string) => new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'medium' })

interface Props {
  carrefourId: string
  plans: PlanSaisi[]
  plan: PlanEtapes
  resultat: ResultatProgramme
  /** Programme modifié et pas encore enregistré : le décalage vaut pour le plan enregistré. */
  modifie: boolean
  onInstant: (t: number) => void
  onVitesse: (vitesse: number | null) => void
}

/**
 * Cale le plan sur l'heure réelle : on tape « Top » au carrefour à chaque passage au vert d'une
 * ligne ; l'API en déduit le décalage du plan (docs/ARCHITECTURE.md §6.1).
 */
export function SynchroPlan({ carrefourId, plans, plan, resultat, modifie, onInstant, onVitesse }: Props) {
  const queryClient = useQueryClient()
  const tops = useQuery({ queryKey: ['tops', carrefourId], queryFn: () => api.tops(carrefourId) })
  const lignes = [...new Set(plan.etapes.filter((e) => !e.hors_cycle).flatMap((e) => e.lignes))]
  const [ligne, setLigne] = useState<string | null>(null)
  const ligneTop = ligne && lignes.includes(ligne) ? ligne : (lignes[0] ?? null)
  /** Tops tapés pendant la séance, pas encore enregistrés (ms epoch). */
  const [seance, setSeance] = useState<number[]>([])
  const [suivre, setSuivre] = useState(false)

  const maj = (resultat: TopsCarrefour) => {
    queryClient.setQueryData(['tops', carrefourId], resultat)
    return queryClient.invalidateQueries({ queryKey: ['feux-temps-reel'] })
  }
  const enregistrer = useMutation({
    mutationFn: () => api.ajouterTops(carrefourId, { ligne: ligneTop!, instants: seance.map((t) => new Date(t).toISOString()) }),
    onSuccess: async (resultat) => {
      setSeance([])
      await maj(resultat)
    },
  })
  const supprimer = useMutation({
    mutationFn: (id: string) => api.supprimerTop(carrefourId, id),
    onSuccess: maj,
    onError: (erreur) => window.alert(erreur.message),
  })

  const synchro = tops.data?.plans[plan.code]
  const decalage = synchro?.decalage_s ?? null
  const cycle = resultat.cycle_s

  // Suivre l'heure réelle : le curseur du diagramme se place où en est le carrefour.
  useEffect(() => {
    if (!suivre || decalage === null) return
    onVitesse(null)
    let image = requestAnimationFrame(function avancer() {
      onInstant(positionCycle(Date.now(), cycle, decalage))
      image = requestAnimationFrame(avancer)
    })
    return () => cancelAnimationFrame(image)
  }, [suivre, decalage, cycle, onInstant, onVitesse])

  const maintenant = useMaintenant(true, 10_000)
  const enVigueur = planEnVigueur(plans, maintenant)
  const observe = cycleObserve(seance, cycle)
  const sesTops = (tops.data?.tops ?? []).filter((t) => t.plan === plan.code).slice(-20).reverse()

  return (
    <Stack as="section" gap="2" p="2.5" borderWidth="1px" borderColor="border.subtle" borderRadius="l2">
      <HStack gap="1.5" wrap="wrap">
        <Text textStyle="sm" fontWeight="semibold">
          Heure réelle
        </Text>
        {synchro ? (
          <Badge colorPalette={CONFIANCE[synchro.confiance].couleur}>{CONFIANCE[synchro.confiance].libelle}</Badge>
        ) : (
          <Badge colorPalette="gray">Plan pas encore enregistré</Badge>
        )}
        {synchro && decalage !== null && (
          <Valeur ms="auto" textStyle="xs" color="fg.secondary">
            décalage {decalage} s · {synchro.tops} top(s) · {synchro.jours} jour(s) · écart {synchro.ecart_s} s
          </Valeur>
        )}
      </HStack>
      <Aide>
        Au carrefour, taper « Top » à chaque passage au vert de la ligne choisie. Le cycle se cale sur l'heure légale (base de temps
        à 3 h, comme les contrôleurs coordonnés) : des tops pris deux jours différents qui concordent confirment le calage.
      </Aide>
      {modifie && <Message ton="avertissement">Programme modifié : le décalage vaut pour le plan enregistré.</Message>}
      {enVigueur?.code !== plan.code && (
        <Message ton="avertissement">
          {enVigueur ? `C'est le plan « ${enVigueur.code} » qui est en vigueur maintenant : les tops tapés iront à lui.` : 'Aucun plan en vigueur maintenant : les tops tapés ne serviront à aucun plan.'}
        </Message>
      )}

      <HStack gap="1.5" wrap="wrap">
        <Selecteur size="xs" w="auto" aria-label="Ligne observée" valeur={ligneTop ?? ''} onChange={setLigne}>
          {lignes.map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </Selecteur>
        <Button size="sm" bg="feu.vert" color="white" disabled={!ligneTop} onClick={() => setSeance((s) => [...s, Date.now()])}>
          Top : {ligneTop} passe au vert
        </Button>
        {seance.length > 0 && (
          <>
            <Button size="xs" variant="solid" loading={enregistrer.isPending} onClick={() => enregistrer.mutate()}>
              Enregistrer {seance.length} top(s)
            </Button>
            <Button size="xs" variant="ghost" onClick={() => setSeance([])}>
              Effacer
            </Button>
          </>
        )}
      </HStack>
      {observe && (
        <Aide>
          Cycle observé {observe.cycle_s} s sur {observe.cycles} cycles (programme : {Math.round(cycle * 10) / 10} s)
          {Math.abs(observe.cycle_s - cycle) > 0.5 && ' : écart à corriger dans les étapes, sinon le calage dérivera.'}
        </Aide>
      )}
      {enregistrer.error && <Message ton="erreur">{enregistrer.error.message}</Message>}

      <Bascule coche={suivre} onChange={setSuivre} disabled={decalage === null}>
        Suivre l'heure réelle dans le diagramme
      </Bascule>

      {sesTops.length > 0 && (
        <Table.Root size="sm" width="auto">
          <Table.Body>
            {sesTops.map((top) => (
              <Table.Row key={top.id}>
                <Table.Cell whiteSpace="nowrap">{horodatage(top.instant)}</Table.Cell>
                <Table.Cell fontWeight="semibold">{top.ligne}</Table.Cell>
                <Table.Cell color="fg.muted">{top.decalage_s === null ? 'hors plan' : `${top.decalage_s} s`}</Table.Cell>
                <Table.Cell>
                  <IconButton variant="ghost" colorPalette="red" size="2xs" aria-label="Supprimer le top" title="Supprimer le top" onClick={() => supprimer.mutate(top.id)}>
                    ✕
                  </IconButton>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      )}
    </Stack>
  )
}
