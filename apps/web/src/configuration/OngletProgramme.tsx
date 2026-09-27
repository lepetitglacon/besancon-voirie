import { Badge, Button, Collapsible, Grid, Heading, HStack, IconButton, Input, Stack, Table, Text } from '@chakra-ui/react'
import { cleDegagement, proposerEtapes, type ContexteProgramme, type ResultatProgramme } from '@voirie/engine'
import type { PlanSaisi } from '@voirie/schema'
import { Aide, Compteur, Message, Segments, Selecteur } from '../ds'
import { Chronogramme } from './Chronogramme'
import { Lecture } from './Lecture'
import { SynchroPlan } from './SynchroPlan'
import {
  basculerJour,
  basculerLigneEtape,
  changerMode,
  deplacerEtape,
  retirerEtape,
  JOURS,
  nouveauPlan,
  saisirDegagement,
} from './programme'

const MODES: Record<PlanSaisi['mode'], string> = {
  cycle: 'Cycle par étapes',
  jaune_clignotant: 'Jaune clignotant',
  eteint: 'Éteint',
}

interface Props {
  carrefourId: string
  /** Programme modifié depuis le dernier enregistrement. */
  modifie: boolean
  contexte: ContexteProgramme
  plans: PlanSaisi[]
  onChanger: (plans: PlanSaisi[]) => void
  planActif: number
  onPlanActif: (index: number) => void
  /** Calcul du plan actif (null si ce n'est pas un plan à cycle). */
  resultat: ResultatProgramme | null
  instant: number
  onInstant: (t: number) => void
  vitesse: number | null
  onVitesse: (vitesse: number | null) => void
}

const secondes = (s: number) => `${Math.round(s * 10) / 10} s`

/** Étape 3 : plans de feux, programme par étapes, transitions et diagramme de feux. */
export function OngletProgramme(props: Props) {
  const { carrefourId, modifie, contexte, plans, onChanger, planActif, onPlanActif, resultat, instant, onInstant, vitesse, onVitesse } = props
  const plan = plans[planActif]
  const codes = contexte.lignes.map((l) => l.code)
  const enConflit = (a: string, b: string) => contexte.conflits.some(([x, y]) => (x === a && y === b) || (x === b && y === a))

  const changerPlan = (suivant: PlanSaisi) => onChanger(plans.map((p, i) => (i === planActif ? suivant : p)))

  if (contexte.lignes.length === 0) {
    return <Aide>Enregistrez d'abord les lignes de feux (onglet Lignes de feux) : les étapes les mettent au vert.</Aide>
  }

  return (
    <Grid templateColumns={{ base: '1fr', lg: 'minmax(0, 1fr) minmax(0, 1.3fr)' }} gap="6" alignItems="start">
      <Stack gap="3">
        <HStack gap="1.5" wrap="wrap">
          {plans.length > 0 && (
            <Segments
              aria-label="Plans de feux"
              valeur={String(planActif)}
              onChange={(v) => onPlanActif(Number(v))}
              options={plans.map((p, i) => ({ valeur: String(i), libelle: p.code }))}
            />
          )}
          <Button
            size="xs"
            onClick={() => {
              onChanger([...plans, nouveauPlan(plans, contexte)])
              onPlanActif(plans.length)
            }}
          >
            + Plan
          </Button>
        </HStack>

        {!plan ? (
          <Aide>
            Un plan décrit le fonctionnement du carrefour sur des plages horaires : cycle par étapes le jour, jaune clignotant la nuit…
          </Aide>
        ) : (
          <>
            <Stack as="section" gap="2" p="2.5" borderWidth="1px" borderColor="border.subtle" borderRadius="l2">
              <HStack gap="1.5">
                <Input
                  size="xs"
                  flex="0 1 140px"
                  fontWeight="bold"
                  value={plan.code}
                  aria-label="Nom du plan"
                  onChange={(e) => changerPlan({ ...plan, code: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 32) })}
                />
                <Selecteur size="xs" flex="1" valeur={plan.mode} aria-label="Mode" onChange={(valeur) => changerPlan(changerMode(plan, valeur as PlanSaisi['mode'], contexte))}>
                  {(Object.keys(MODES) as PlanSaisi['mode'][]).map((m) => (
                    <option key={m} value={m}>
                      {MODES[m]}
                    </option>
                  ))}
                </Selecteur>
                <IconButton
                  variant="ghost"
                  colorPalette="red"
                  size="xs"
                  aria-label="Supprimer le plan"
                  title="Supprimer le plan"
                  onClick={() => {
                    onChanger(plans.filter((_, i) => i !== planActif))
                    onPlanActif(Math.max(0, planActif - 1))
                  }}
                >
                  ✕
                </IconButton>
              </HStack>

              {plan.plages.map((plage, k) => (
                <HStack key={k} gap="1.5" wrap="wrap" textStyle="xs">
                  <HStack gap="2px" role="group" aria-label="Jours">
                    {JOURS.map(({ jour, lettre, nom }) => {
                      const actif = plage.jours === 'tous' || plage.jours.includes(jour)
                      return (
                        <Button
                          key={jour}
                          size="2xs"
                          minW="6"
                          px="0"
                          title={nom}
                          aria-pressed={actif}
                          variant={actif ? 'solid' : 'outline'}
                          onClick={() => changerPlan({ ...plan, plages: plan.plages.map((p, i) => (i === k ? basculerJour(p, jour) : p)) })}
                        >
                          {lettre}
                        </Button>
                      )
                    })}
                  </HStack>
                  <Input
                    size="xs"
                    w="auto"
                    type="time"
                    value={plage.de}
                    aria-label="Début"
                    onChange={(e) => e.target.value && changerPlan({ ...plan, plages: plan.plages.map((p, i) => (i === k ? { ...p, de: e.target.value } : p)) })}
                  />
                  →
                  <Input
                    size="xs"
                    w="auto"
                    type="time"
                    value={plage.a}
                    aria-label="Fin"
                    onChange={(e) => e.target.value && changerPlan({ ...plan, plages: plan.plages.map((p, i) => (i === k ? { ...p, a: e.target.value } : p)) })}
                  />
                  <IconButton
                    variant="ghost"
                    size="2xs"
                    aria-label="Retirer la plage"
                    title="Retirer la plage"
                    disabled={plan.plages.length === 1}
                    onClick={() => changerPlan({ ...plan, plages: plan.plages.filter((_, i) => i !== k) })}
                  >
                    ✕
                  </IconButton>
                </HStack>
              ))}
              <HStack gap="2">
                <Button variant="lien" size="xs" onClick={() => changerPlan({ ...plan, plages: [...plan.plages, { jours: 'tous', de: '00:00', a: '00:00' }] })}>
                  + plage horaire
                </Button>
                <Aide>de 00:00 à 00:00 : toute la journée</Aide>
              </HStack>
            </Stack>

            {plan.mode === 'cycle' && (
              <>
                <HStack gap="2" wrap="wrap">
                  <Text textStyle="xs" color="fg.muted">
                    jaune
                  </Text>
                  <Compteur
                    taille="xs"
                    aria-label="Durée du jaune"
                    min={2}
                    max={6}
                    unite="s"
                    valeur={plan.jaune_s}
                    onChange={(v) => changerPlan({ ...plan, jaune_s: v ?? 3 })}
                  />
                  <Button
                    size="xs"
                    onClick={() => {
                      if (window.confirm('Remplacer les étapes par une proposition ?')) {
                        changerPlan({ ...plan, etapes: proposerEtapes(contexte.lignes, contexte.conflits) })
                      }
                    }}
                  >
                    Proposer des étapes
                  </Button>
                </HStack>

                <Heading as="h3" textStyle="sm" fontWeight="semibold">
                  Étapes
                </Heading>
                {plan.etapes.map((etape, i) => {
                  const calculee = resultat?.etapes.find((e) => e.index === i)
                  const courante = calculee !== undefined && instant >= calculee.debut_s && instant < calculee.fin_s
                  const transition = resultat?.transitions.find((tr) => tr.de === i)
                  const inconnues = etape.lignes.filter((c) => !codes.includes(c))
                  return (
                    <Stack key={i} gap="1">
                      <Stack
                        as="section"
                        gap="1.5"
                        px="2.5"
                        py="2"
                        borderWidth="1px"
                        borderRadius="l2"
                        borderColor={courante ? 'feu.vert' : 'border.subtle'}
                        boxShadow={courante ? '0 0 0 1px var(--chakra-colors-feu-vert)' : undefined}
                      >
                        <HStack gap="1.5">
                          <Button variant="lien" size="xs" color="fg" fontWeight="bold" title="Placer le curseur sur cette étape" onClick={() => calculee && onInstant(calculee.debut_s)}>
                            Étape {i + 1}
                          </Button>
                          {etape.hors_cycle && <Badge colorPalette="orange">hors cycle</Badge>}
                          {etape.appel && !etape.hors_cycle && <Badge colorPalette="green">sur appel {etape.appel}</Badge>}
                          <Compteur
                            taille="xs"
                            aria-label={`Durée de l'étape ${i + 1}`}
                            min={1}
                            max={300}
                            unite="s"
                            valeur={etape.duree_s}
                            onChange={(v) =>
                              changerPlan({
                                ...plan,
                                etapes: plan.etapes.map((x, j) => (j === i ? { ...x, duree_s: Math.max(1, v ?? 1) } : x)),
                              })
                            }
                          />
                          <HStack gap="0.5" ms="auto">
                            <IconButton variant="ghost" size="2xs" aria-label="Monter" title="Monter" disabled={i === 0} onClick={() => changerPlan(deplacerEtape(plan, i, -1))}>
                              ↑
                            </IconButton>
                            <IconButton variant="ghost" size="2xs" aria-label="Descendre" title="Descendre" disabled={i === plan.etapes.length - 1} onClick={() => changerPlan(deplacerEtape(plan, i, 1))}>
                              ↓
                            </IconButton>
                            <IconButton
                              variant="ghost"
                              colorPalette="red"
                              size="2xs"
                              aria-label="Supprimer l'étape"
                              title="Supprimer l'étape"
                              disabled={plan.etapes.length === 1}
                              onClick={() => changerPlan(retirerEtape(plan, i))}
                            >
                              ✕
                            </IconButton>
                          </HStack>
                        </HStack>
                        <HStack gap="1" wrap="wrap">
                          {[...codes, ...inconnues].map((code) => {
                            const auVert = etape.lignes.includes(code)
                            const bloquante = auVert ? undefined : etape.lignes.find((autre) => enConflit(code, autre))
                            const inconnue = inconnues.includes(code)
                            return (
                              <Button
                                key={code}
                                size="2xs"
                                minW="38px"
                                borderRadius="full"
                                fontWeight="semibold"
                                variant={auVert && !inconnue ? 'solid' : 'outline'}
                                colorPalette={inconnue ? 'red' : undefined}
                                color={inconnue ? 'fg.error' : undefined}
                                bg={auVert && !inconnue ? 'feu.vert' : undefined}
                                textDecoration={bloquante ? 'line-through' : undefined}
                                aria-pressed={auVert}
                                disabled={bloquante !== undefined}
                                title={
                                  inconnue
                                    ? `${code} n'existe plus : cliquer pour le retirer`
                                    : bloquante
                                      ? `${code} est en conflit avec ${bloquante}`
                                      : auVert
                                        ? `Retirer ${code} de l'étape`
                                        : `Mettre ${code} au vert`
                                }
                                onClick={() => changerPlan(basculerLigneEtape(plan, i, code, codes))}
                              >
                                {code}
                              </Button>
                            )
                          })}
                        </HStack>
                      </Stack>
                      {transition && plan.etapes.length > 1 && (
                        <Aide ps="2.5">
                          ↓ transition {secondes(transition.duree_s)}
                          {transition.contrainte &&
                            ` · ${transition.contrainte.vers} attend ${transition.contrainte.de} : ${
                              transition.contrainte.jaune_s ? `jaune ${transition.contrainte.jaune_s} s + ` : ''
                            }dégagement ${transition.contrainte.rouge_s} s`}
                          {transition.vers !== i + 1 && ` · puis étape ${transition.vers + 1}`}
                        </Aide>
                      )}
                    </Stack>
                  )
                })}
                <Button
                  size="xs"
                  alignSelf="start"
                  onClick={() => changerPlan({ ...plan, etapes: [...plan.etapes, { lignes: [], duree_s: 20 }] })}
                  disabled={plan.etapes.length >= 16}
                >
                  + Étape
                </Button>

                <Collapsible.Root>
                  <Collapsible.Trigger asChild>
                    <Button variant="lien" size="xs" color="fg" fontWeight="semibold">
                      ▸ Rouges de dégagement ({contexte.degagements.length})
                    </Button>
                  </Collapsible.Trigger>
                  <Collapsible.Content>
                    <Stack gap="2" pt="2">
                      <Aide>
                        Calculés sur la géométrie : (trajet du dernier usager qui dégage + 6 m) / vitesse − trajet du premier qui
                        arrive / vitesse, à 10 m/s pour les véhicules et 1 m/s pour les piétons. Une valeur saisie remplace le calcul.
                      </Aide>
                      <Table.Root width="auto">
                        <Table.Body>
                          {contexte.degagements.map((d) => {
                            const cle = cleDegagement(d.de, d.vers)
                            const saisi = plan.degagements[cle]
                            return (
                              <Table.Row key={cle}>
                                <Table.Cell fontWeight="semibold" whiteSpace="nowrap">
                                  {d.de} → {d.vers}
                                </Table.Cell>
                                <Table.Cell
                                  color="fg.muted"
                                  title={d.distances ? `dégage sur ${d.distances.sortant} m, arrive après ${d.distances.entrant} m` : 'valeur par défaut'}
                                >
                                  calculé {d.rouge_s} s
                                </Table.Cell>
                                <Table.Cell>
                                  <Compteur
                                    taille="xs"
                                    min={0}
                                    max={30}
                                    unite="s"
                                    placeholder={String(d.rouge_s)}
                                    valeur={saisi ?? null}
                                    aria-label={`Rouge de dégagement ${d.de} vers ${d.vers}`}
                                    onChange={(v) => changerPlan(saisirDegagement(plan, cle, v))}
                                  />
                                </Table.Cell>
                              </Table.Row>
                            )
                          })}
                        </Table.Body>
                      </Table.Root>
                    </Stack>
                  </Collapsible.Content>
                </Collapsible.Root>
              </>
            )}
          </>
        )}
      </Stack>
      <Stack gap="3" position={{ lg: 'sticky' }} top="0">
        {plan?.mode === 'cycle' && resultat ? (
          <>
            <Heading as="h3" textStyle="sm" fontWeight="semibold">
              Diagramme de feux · cycle de {secondes(resultat.cycle_s)}
            </Heading>
            <Lecture instant={instant} vitesse={vitesse} onVitesse={onVitesse} />
            <Chronogramme
              chronologie={{ ...resultat, duree_s: resultat.cycle_s }}
              lignes={contexte.lignes}
              instant={instant}
              onInstant={onInstant}
            />
            {resultat.controles.map((c) => (
              <Message key={c.message} ton={c.niveau === 'erreur' ? 'erreur' : 'avertissement'}>
                {c.message}
              </Message>
            ))}
            <SynchroPlan
              carrefourId={carrefourId}
              plans={plans}
              plan={plan}
              resultat={resultat}
              modifie={modifie}
              onInstant={onInstant}
              onVitesse={onVitesse}
            />
          </>
        ) : (
          <Aide>Le diagramme de feux s'affiche ici pour un plan à cycle avec des étapes.</Aide>
        )}
      </Stack>
    </Grid>
  )
}
