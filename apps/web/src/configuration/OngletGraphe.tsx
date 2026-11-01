import { Button, Grid, Heading, HStack, IconButton, List, Stack, Table, Text } from '@chakra-ui/react'
import {
  arcsDuGraphe,
  degagementsRetenus,
  validerGraphe,
  type ContexteProgramme,
  type Demande,
  type ResultatSimulation,
} from '@voirie/engine'
import type { PlanEtapes, PlanSaisi } from '@voirie/schema'
import { useState } from 'react'
import { Aide, Case, Compteur, Message, Segments, Selecteur } from '../ds'
import { Chronogramme } from './Chronogramme'
import { GrapheEtapes } from './GrapheEtapes'
import { Lecture } from './Lecture'
import { ajouterArc, ajouterPriorite, basculerHorsCycle, changerAppel, modifierArc, retirerArc } from './programme'
import { colonnes } from './disposition'

export interface Scenario {
  demandes: Demande[]
  duree_s: number
}

interface Props {
  contexte: ContexteProgramme
  plans: PlanSaisi[]
  onChanger: (plans: PlanSaisi[]) => void
  planActif: number
  onPlanActif: (index: number) => void
  scenario: Scenario
  onScenario: (scenario: Scenario) => void
  simulation: ResultatSimulation | null
  /** La simulation est dessinée dans la bande sous la carte : pas ici. */
  diagrammeEnBande?: boolean
  instant: number
  onInstant: (t: number) => void
  vitesse: number | null
  onVitesse: (vitesse: number | null) => void
}

const secondes = (s: number) => `${Math.round(s * 10) / 10} s`

/** Étape 4 : graphe des étapes (appels, priorité tram) et simulation d'un scénario de demandes. */
export function OngletGraphe(props: Props) {
  const { contexte, plans, onChanger, planActif, onPlanActif, scenario, onScenario, simulation, diagrammeEnBande, instant, onInstant, vitesse, onVitesse } = props
  const [lignePriorite, setLignePriorite] = useState('')
  const plan = plans[planActif]
  const codes = contexte.lignes.map((l) => l.code)
  const vehicules = contexte.lignes.filter((l) => l.type !== 'pieton').map((l) => l.code)

  if (plans.length === 0) return <Aide>Créez d'abord un plan à cycle dans l'onglet Programme : le graphe relie ses étapes.</Aide>

  const selecteur = (
    <Segments
      alignSelf="start"
      aria-label="Plans de feux"
      valeur={String(planActif)}
      onChange={(v) => onPlanActif(Number(v))}
      options={plans.map((p, i) => ({ valeur: String(i), libelle: p.code }))}
    />
  )
  if (!plan || plan.mode !== 'cycle') {
    return (
      <>
        {selecteur}
        <Aide>Ce plan n'a pas de cycle : pas de graphe d'étapes.</Aide>
      </>
    )
  }

  const changerPlan = (suivant: PlanEtapes) => onChanger(plans.map((p, i) => (i === planActif ? suivant : p)))
  const entree = {
    ...contexte,
    etapes: plan.etapes,
    jaune_s: plan.jaune_s,
    degagements: degagementsRetenus(contexte.degagements, plan.degagements),
  }
  const arcs = arcsDuGraphe(entree, plan.arcs)
  const controles = validerGraphe(plan.etapes, plan.arcs, codes)
  const enCours = simulation?.etapes.find((e) => instant >= e.debut_s && instant < e.fin_s)
  const derniereTransition = simulation?.transitions.filter((t) => t.debut_s <= instant).at(-1)
  const etapeLue = enCours?.index ?? (derniereTransition ? derniereTransition.vers : null)
  const changerDemande = (k: number, demande: Demande) =>
    onScenario({ ...scenario, demandes: scenario.demandes.map((d, j) => (j === k ? demande : d)) })

  return (
    <Grid {...colonnes('minmax(0, 1fr) minmax(0, 1fr)')} gap="6" alignItems="start">
      <Stack gap="3">
        {selecteur}
        <GrapheEtapes
          etapes={plan.etapes}
          arcs={arcs}
          courante={etapeLue}
          arcCourant={derniereTransition ? { de: derniereTransition.de, vers: derniereTransition.vers } : null}
        />
        <Aide>
          — suite du cycle ·{' '}
          <Text as="span" color="brand.fg">
            - - saut d'une étape sur appel
          </Text>{' '}
          ·{' '}
          <Text as="span" color="statut.estime">
            — arc sur demande (priorité)
          </Text>{' '}
          · durée de la transition sur chaque arc
        </Aide>
        {controles.map((c) => (
          <Message key={c.message} ton={c.niveau === 'erreur' ? 'erreur' : 'avertissement'}>
            {c.message}
          </Message>
        ))}

        <Heading as="h3" textStyle="sm" fontWeight="semibold">
          Étapes
        </Heading>
        <Table.Root width="auto">
          <Table.Body>
            {plan.etapes.map((etape, i) => (
              <Table.Row key={i}>
                <Table.Cell fontWeight="semibold">É{i + 1}</Table.Cell>
                <Table.Cell>{etape.lignes.join(' ') || '—'}</Table.Cell>
                <Table.Cell>
                  <Selecteur
                    size="xs"
                    valeur={etape.appel ?? ''}
                    disabled={etape.hors_cycle}
                    aria-label={`Appel de l'étape ${i + 1}`}
                    onChange={(valeur) => changerPlan(changerAppel(plan, i, valeur || null))}
                  >
                    <option value="">toujours servie</option>
                    {etape.lignes.map((code) => (
                      <option key={code} value={code}>
                        sur appel {code}
                      </option>
                    ))}
                  </Selecteur>
                </Table.Cell>
                <Table.Cell>
                  <Case coche={etape.hors_cycle ?? false} disabled={i === 0} onChange={() => changerPlan(basculerHorsCycle(plan, i))}>
                    hors cycle
                  </Case>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
        <HStack gap="1.5">
          <Selecteur size="xs" valeur={lignePriorite} onChange={setLignePriorite} aria-label="Ligne prioritaire">
            <option value="">ligne prioritaire…</option>
            {vehicules.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </Selecteur>
          <Button size="xs" disabled={!lignePriorite || plan.etapes.length >= 16} onClick={() => changerPlan(ajouterPriorite(plan, lignePriorite))}>
            Ajouter une étape prioritaire
          </Button>
        </HStack>
        <Aide>
          Crée une étape hors cycle pour la ligne (tram, bus), atteinte depuis chaque étape du cycle dès sa demande en
          écourtant l'étape en cours après son vert minimal ; le cycle reprend ensuite après l'étape interrompue (ou
          suit un arc sans condition ajouté ci-dessous). Ses lignes compatibles se cochent dans l'onglet Programme.
        </Aide>

        <Heading as="h3" textStyle="sm" fontWeight="semibold">
          Arcs ajoutés ({plan.arcs.length})
        </Heading>
        {plan.arcs.map((arc, k) => (
          <HStack key={k} gap="1.5" wrap="wrap" textStyle="xs">
            <Selecteur size="xs" valeur={arc.de} aria-label="Depuis" onChange={(valeur) => changerPlan(modifierArc(plan, k, { de: Number(valeur) }))}>
              {plan.etapes.map((_, i) => (
                <option key={i} value={i}>
                  É{i + 1}
                </option>
              ))}
            </Selecteur>
            →
            <Selecteur size="xs" valeur={arc.vers} aria-label="Vers" onChange={(valeur) => changerPlan(modifierArc(plan, k, { vers: Number(valeur) }))}>
              {plan.etapes.map((_, i) => (
                <option key={i} value={i}>
                  É{i + 1}
                </option>
              ))}
            </Selecteur>
            <Selecteur size="xs" valeur={arc.demande ?? ''} aria-label="Condition" onChange={(valeur) => changerPlan(modifierArc(plan, k, { demande: valeur || null }))}>
              <option value="">sans condition</option>
              {codes.map((code) => (
                <option key={code} value={code}>
                  si {code} demandé
                </option>
              ))}
            </Selecteur>
            <Case
              coche={arc.anticipe}
              disabled={arc.demande === null}
              title="Écourter l'étape de départ dès son vert minimal"
              onChange={(anticipe) => changerPlan(modifierArc(plan, k, { anticipe }))}
            >
              écourte
            </Case>
            <IconButton variant="ghost" size="2xs" aria-label="Retirer l'arc" title="Retirer l'arc" onClick={() => changerPlan(retirerArc(plan, k))}>
              ✕
            </IconButton>
          </HStack>
        ))}
        <Button
          size="xs"
          alignSelf="start"
          onClick={() => changerPlan(ajouterArc(plan, { de: 0, vers: Math.min(1, plan.etapes.length - 1), demande: codes[0] ?? null, anticipe: false }))}
        >
          + Arc
        </Button>

      </Stack>
      <Stack gap="3">
        <Heading as="h3" textStyle="sm" fontWeight="semibold">
          Simulation
        </Heading>
        <Aide>
          Déroule le graphe à partir du début de l'étape 1 avec des demandes : appui sur un bouton piéton, détection d'un
          véhicule, arrivée d'un tram. Une demande attend que sa ligne passe au vert.
        </Aide>
        {scenario.demandes.map((demande, k) => (
          <HStack key={k} gap="1.5" textStyle="xs">
            <Selecteur size="xs" valeur={demande.ligne} aria-label="Ligne demandée" onChange={(ligne) => changerDemande(k, { ...demande, ligne })}>
              {codes.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </Selecteur>
            demandé à
            <Compteur
              taille="xs"
              min={0}
              max={scenario.duree_s}
              unite="s"
              valeur={demande.t}
              aria-label="Instant de la demande"
              onChange={(t) => changerDemande(k, { ...demande, t: Math.max(0, t ?? 0) })}
            />
            <IconButton
              variant="ghost"
              size="2xs"
              aria-label="Retirer la demande"
              title="Retirer la demande"
              onClick={() => onScenario({ ...scenario, demandes: scenario.demandes.filter((_, j) => j !== k) })}
            >
              ✕
            </IconButton>
          </HStack>
        ))}
        <HStack gap="2" textStyle="xs">
          <Button size="xs" onClick={() => onScenario({ ...scenario, demandes: [...scenario.demandes, { ligne: codes[0] ?? '', t: Math.round(instant) }] })}>
            + Demande
          </Button>
          sur
          <Compteur
            taille="xs"
            min={30}
            max={900}
            pas={10}
            unite="s"
            valeur={scenario.duree_s}
            aria-label="Durée de la simulation"
            onChange={(duree) => onScenario({ ...scenario, duree_s: Math.min(900, Math.max(30, duree ?? 30)) })}
          />
        </HStack>

        {simulation && simulation.etapes.length > 0 && (
          <>
            {!diagrammeEnBande && (
              <>
                <Lecture instant={instant} vitesse={vitesse} onVitesse={onVitesse} />
                <Chronogramme chronologie={simulation} lignes={contexte.lignes} instant={instant} onInstant={onInstant} demandes={scenario.demandes} />
              </>
            )}
            {simulation.attentes.length > 0 && (
              <Table.Root width="auto">
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeader>Demande</Table.ColumnHeader>
                    <Table.ColumnHeader>à</Table.ColumnHeader>
                    <Table.ColumnHeader>attente du vert</Table.ColumnHeader>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {simulation.attentes.map((a, k) => (
                    <Table.Row key={k}>
                      <Table.Cell fontWeight="semibold">{a.ligne}</Table.Cell>
                      <Table.Cell>{secondes(a.t)}</Table.Cell>
                      <Table.Cell>{a.attente_s === null ? 'pas servie' : secondes(a.attente_s)}</Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Root>
            )}
            <List.Root gap="0.5" ps="4" textStyle="xs">
              {simulation.evenements.map((e, k) => (
                <List.Item key={k}>
                  <Button variant="lien" size="xs" fontFamily="mono" onClick={() => onInstant(e.t)}>
                    {secondes(e.t)}
                  </Button>{' '}
                  {e.message}
                </List.Item>
              ))}
            </List.Root>
          </>
        )}
      </Stack>
    </Grid>
  )
}
