import { Badge, Box, Button, Grid, Heading, HStack, Input, Stack, Table, Text } from '@chakra-ui/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  analyserReleve,
  basculerLigne,
  couleurCourante,
  couleurSuivante,
  ecartsAuPlan,
  estChangementCouleur,
  fixerCouleur,
  planEnVigueur,
  type CouleurReleve,
  type EvenementReleve,
  type SaisieReleve,
} from '@voirie/engine'
import type { CarrefourTempsReel } from '@voirie/schema'
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { api } from '../api'
import { PlanCarrefour } from '../carrefour/PlanCarrefour'
import { Aide, Chiffre, HAUTEUR_POIGNEE_TIROIR, IconeFeu, Message, Section, TiroirBas, Valeur, type EtatLampe } from '../ds'
import { usePreference } from '../preferences'
import { useMaintenant } from '../tempsReel/useMaintenant'
import { ecrirePseudo, lirePseudo, useSeance } from './seance'

const EVENEMENTS: Array<{ type: EvenementReleve; glyphe: string; libelle: string; aide: string }> = [
  { type: 'bus', glyphe: '🚌', libelle: 'Bus', aide: 'Un bus arrive au feu' },
  { type: 'tram', glyphe: '🚋', libelle: 'Tram', aide: 'Un tram arrive au feu' },
  { type: 'boucle', glyphe: '🚗', libelle: 'Boucle', aide: 'Un véhicule s’arrête sur une boucle de détection' },
  { type: 'pieton', glyphe: '🚶', libelle: 'Bouton', aide: 'Un piéton appuie sur le bouton d’appel' },
]

const COULEURS: CouleurReleve[] = ['vert', 'jaune', 'rouge']
const FOND: Record<CouleurReleve, string> = { vert: 'feu.vert', jaune: 'feu.orange', rouge: 'feu.rouge' }
/** Couleur des étiquettes du plan : celle où l'on a vu la ligne en dernier. */
const LAMPE: Record<CouleurReleve | 'aucune', EtatLampe | null> = { vert: 'vert', jaune: 'orange', rouge: 'rouge', aucune: null }

/**
 * Lignes proposées pour rattacher un événement : les lignes piétonnes d'abord pour un appui sur le
 * bouton, les lignes de tram et bus d'abord pour un tram ou un bus.
 */
function ordrePourEvenement(lignes: CarrefourTempsReel['lignes'], saisie: SaisieReleve | undefined) {
  const evenement = saisie && !estChangementCouleur(saisie) ? saisie.evenement : null
  const enTete = (l: CarrefourTempsReel['lignes'][number]) =>
    evenement === 'pieton' ? l.pieton : evenement === 'tram' || evenement === 'bus' ? l.tc : false
  return [...lignes.filter(enTete), ...lignes.filter((l) => !enTete(l))]
}

/** L'API reçoit au plus 200 tops par envoi. */
const TOPS_PAR_ENVOI = 200

const heure = (t: number) => new Date(t).toLocaleTimeString('fr-FR')
const secondes = (ms: number) => `${Math.floor(ms / 1000)} s`

/** Garde l'écran allumé pendant le relevé, quand le navigateur le permet. */
function useEcranAllume() {
  useEffect(() => {
    let verrou: WakeLockSentinel | null = null
    const demander = () => {
      if (document.visibilityState !== 'visible') return
      navigator.wakeLock
        ?.request('screen')
        .then((v) => (verrou = v))
        .catch(() => {})
    }
    demander()
    // Le verrou tombe quand la page passe en arrière-plan : on le redemande au retour.
    document.addEventListener('visibilitychange', demander)
    return () => {
      document.removeEventListener('visibilitychange', demander)
      void verrou?.release().catch(() => {})
    }
  }, [])
}

/**
 * Relevé terrain d'un carrefour, sur le téléphone, devant le feu : un appui à chaque changement de
 * couleur d'une ligne, les événements qui déclenchent (bus, tram, boucle, bouton piéton), puis le
 * cycle et les verts mesurés comparés au programme. Les passages au vert partent au calage (tops).
 */
export function ReleveTerrain() {
  const { carrefourId = '' } = useParams()
  const carrefour = useQuery({ queryKey: ['carrefour-temps-reel', carrefourId], queryFn: () => api.carrefourTempsReel(carrefourId) })
  useEcranAllume()

  return (
    <Box minH="100dvh" bg="bg" color="fg">
      {/* En bas, la place de la poignée du plan, pour que rien ne reste dessous. */}
      <Stack gap="5" maxW="560px" mx="auto" px="4" pt="3" pb={`${HAUTEUR_POIGNEE_TIROIR + 16}px`}>
        {carrefour.isPending ? (
          <Aide>Chargement…</Aide>
        ) : carrefour.isError ? (
          <Message ton="erreur">{carrefour.error.message}</Message>
        ) : (
          <Releve carrefour={carrefour.data} />
        )}
      </Stack>
    </Box>
  )
}

function Releve({ carrefour }: { carrefour: CarrefourTempsReel }) {
  const queryClient = useQueryClient()
  const [seance, modifier] = useSeance(carrefour.id)
  const { saisies } = seance
  const maintenant = useMaintenant()
  const codes = carrefour.lignes.map((l) => l.code)
  const plan = planEnVigueur(carrefour.plans, maintenant)
  const releve = analyserReleve(saisies, codes)
  const liste = ecartsAuPlan(releve, plan?.mode === 'cycle' ? plan : null)
  const aEnvoyer = Object.entries(releve.tops).flatMap(([ligne, instants]) =>
    instants.filter((t) => !seance.envoyes.includes(t)).map((t) => ({ ligne, t })),
  )

  /** Ligne dont on a touché un feu sur le plan : son bouton est mis en avant. */
  const [ligneVue, setLigneVue] = useState<string | null>(null)
  /** Plan du carrefour sorti ou rangé : mémorisé d'un relevé à l'autre. */
  const [planOuvert, setPlanOuvert] = usePreference<boolean>('plan-releve-ouvert', false)
  const etatsReleves = new Map(codes.map((code) => [code, LAMPE[couleurCourante(saisies, code) ?? 'aucune']] as const))

  /** Événement tapé à l'instant, en attente de la ligne qu'il concerne. */
  const [evenementEnAttente, setEvenementEnAttente] = useState<number | null>(null)
  const termine = seance.termine !== undefined
  const rattacher = (t: number, ligne: string | null) => {
    if (ligne) {
      modifier((s) => ({ ...s, saisies: s.saisies.map((x) => (x.t === t && !estChangementCouleur(x) ? { ...x, ligne } : x)) }))
    }
    setEvenementEnAttente(null)
  }

  const saisir = (suivantes: SaisieReleve[]) => {
    if (termine) return
    navigator.vibrate?.(15)
    modifier((s) => ({ ...s, saisies: suivantes }))
  }

  const [pseudo, setPseudo] = useState(lirePseudo)
  /** Champ piège : invisible, seul un robot le remplit. */
  const [siteWeb, setSiteWeb] = useState('')
  const releves = useQuery({ queryKey: ['releves', carrefour.id], queryFn: () => api.relevesCarrefour(carrefour.id) })
  const envoiReleve = useMutation({
    mutationFn: () =>
      api.envoyerReleve({ carrefour_id: carrefour.id, pseudo: pseudo.trim() || undefined, saisies, site_web: siteWeb || undefined }),
    onSuccess: (recu) => {
      ecrirePseudo(pseudo)
      modifier((s) => ({ ...s, releve: { id: recu.id, saisies: s.saisies.length } }))
      return queryClient.invalidateQueries({ queryKey: ['releves', carrefour.id] })
    },
  })
  const saisiesApresEnvoi = seance.releve ? saisies.length - seance.releve.saisies : 0

  const envoi = useMutation({
    mutationFn: async () => {
      for (const ligne of codes) {
        const instants = aEnvoyer.filter((a) => a.ligne === ligne).map((a) => a.t)
        for (let i = 0; i < instants.length; i += TOPS_PAR_ENVOI) {
          const lot = instants.slice(i, i + TOPS_PAR_ENVOI)
          await api.ajouterTops(carrefour.id, { ligne, instants: lot.map((t) => new Date(t).toISOString()) })
          // Lot par lot : si le réseau lâche en route, ce qui est parti n'est pas renvoyé.
          modifier((s) => ({ ...s, envoyes: [...s.envoyes, ...lot] }))
        }
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['carrefour-temps-reel', carrefour.id] }),
  })

  const [lon, lat] = carrefour.position
  const derniere = saisies.at(-1)

  return (
    <>
      <Stack gap="1">
        <HStack justify="space-between">
          <Button asChild variant="ghost" size="xs" ms="-2">
            <Link to={`/#18/${lat}/${lon}`}>← Carte</Link>
          </Button>
          <EnteteReleve />
        </HStack>
        <Heading as="h1" textStyle="lg" fontWeight="semibold">
          {carrefour.nom}
        </Heading>
        <HStack gap="1.5" wrap="wrap">
          {plan ? (
            <Badge colorPalette="blue">
              Plan « {plan.code} »{plan.cycle_s ? ` · cycle ${Math.round(plan.cycle_s)} s` : ''}
            </Badge>
          ) : (
            <Badge colorPalette="gray">Aucun plan en vigueur</Badge>
          )}
          {plan?.synchro && plan.synchro.confiance !== 'inconnue' && <Badge colorPalette="green">Calé sur l’heure réelle</Badge>}
        </HStack>
      </Stack>

      {codes.length === 0 ? (
        <Message ton="avertissement">Ce carrefour n’a pas encore de lignes de feux : elles se déclarent dans la configuration.</Message>
      ) : (
        <Section libelle="Lignes de feux · un appui à chaque changement (vert, jaune, rouge)">
          <Grid templateColumns="repeat(2, minmax(0, 1fr))" gap="2.5">
            {carrefour.lignes.map((ligne) => {
              const couleur = couleurCourante(saisies, ligne.code)
              const depuis = [...saisies].reverse().find((s) => estChangementCouleur(s) && s.ligne === ligne.code)?.t
              const avecJaune = !ligne.pieton
              const prochaine = couleurSuivante(couleur, avecJaune)
              return (
                <Stack key={ligne.code} gap="1.5">
                  <Button
                    h="20"
                    flexDirection="column"
                    gap="0.5"
                    borderRadius="l3"
                    bg={couleur ? FOND[couleur] : 'bg.muted'}
                    color={couleur === 'jaune' ? 'gray.900' : couleur ? 'white' : 'fg'}
                    aria-label={`${ligne.code}${couleur ? ` au ${couleur}` : ''} : passe au ${prochaine}`}
                    outline={ligneVue === ligne.code ? '3px solid' : undefined}
                    outlineColor="brand.solid"
                    outlineOffset="2px"
                    disabled={termine}
                    onClick={() => saisir(basculerLigne(saisies, ligne.code, Date.now(), avecJaune))}
                  >
                    <Text textStyle="2xl" fontWeight="bold">
                      {ligne.code}
                    </Text>
                    <Text textStyle="xs">
                      {couleur && depuis ? `${couleur} depuis ${secondes(maintenant - depuis)}` : 'appuyer au vert'}
                      {ligne.pieton && ' · piéton'}
                    </Text>
                  </Button>
                  {/* Couleur forcée : un changement raté, ou un appui de trop. */}
                  <HStack gap="1.5">
                    {(avecJaune ? COULEURS : COULEURS.filter((c) => c !== 'jaune')).map((c) => (
                      <Button
                        key={c}
                        flex="1"
                        size="xs"
                        variant="outline"
                        borderColor={FOND[c]}
                        borderWidth="2px"
                        bg={couleur === c ? FOND[c] : undefined}
                        color={couleur === c ? (c === 'jaune' ? 'gray.900' : 'white') : 'fg'}
                        aria-pressed={couleur === c}
                        disabled={termine}
                        aria-label={`${ligne.code} au ${c}`}
                        onClick={() => saisir(fixerCouleur(saisies, ligne.code, c, Date.now()))}
                      >
                        {c[0]!.toUpperCase()}
                      </Button>
                    ))}
                  </HStack>
                </Stack>
              )
            })}
          </Grid>
        </Section>
      )}

      <Section libelle="Ce qui déclenche">
        <Grid templateColumns="repeat(4, minmax(0, 1fr))" gap="2">
          {EVENEMENTS.map((e) => (
            <Button
              key={e.type}
              h="16"
              variant="outline"
              flexDirection="column"
              gap="0"
              title={e.aide}
              aria-label={e.aide}
              disabled={termine}
              onClick={() => {
                const t = Date.now()
                saisir([...saisies, { t, evenement: e.type }])
                setEvenementEnAttente(t)
              }}
            >
              <Text textStyle="xl">{e.glyphe}</Text>
              <Text textStyle="xs">
                {e.libelle}
                {releve.evenements[e.type] > 0 && ` · ${releve.evenements[e.type]}`}
              </Text>
            </Button>
          ))}
        </Grid>
        {evenementEnAttente !== null && !termine && (
          <Stack gap="1.5" p="2" bg="bg.muted" borderRadius="l2">
            <Aide color="fg">Pour quelle ligne ?</Aide>
            <HStack gap="1.5" wrap="wrap">
              {ordrePourEvenement(carrefour.lignes, saisies.find((s) => s.t === evenementEnAttente)).map((l) => (
                <Button key={l.code} size="sm" variant="outline" minW="12" onClick={() => rattacher(evenementEnAttente, l.code)}>
                  {l.code}
                </Button>
              ))}
              <Button size="sm" variant="ghost" onClick={() => rattacher(evenementEnAttente, null)}>
                Aucune
              </Button>
            </HStack>
          </Stack>
        )}
        {derniere && (
          <HStack gap="2">
            <Aide flex="1">
              Dernière saisie {heure(derniere.t)} :{' '}
              {estChangementCouleur(derniere)
                ? `${derniere.ligne} au ${derniere.couleur}`
                : `${EVENEMENTS.find((e) => e.type === derniere.evenement)?.libelle}${derniere.ligne ? ` pour ${derniere.ligne}` : ''}`}
            </Aide>
            <Button size="xs" variant="ghost" onClick={() => modifier((s) => ({ ...s, saisies: s.saisies.slice(0, -1) }))}>
              Annuler
            </Button>
          </HStack>
        )}
      </Section>

      <Section libelle="Mesuré">
        <HStack gap="2">
          <Chiffre valeur={releve.cycle ? `${releve.cycle.cycle_s} s` : '–'} libelle={releve.cycle ? `cycle ± ${releve.cycle.ecart_type_s} s` : 'cycle'} />
          <Chiffre valeur={plan?.cycle_s ? `${Math.round(plan.cycle_s * 10) / 10} s` : '–'} libelle="programme" />
          <Chiffre valeur={releve.cycle?.cycles ?? 0} libelle="cycles vus" />
        </HStack>
        {!releve.cycle && <Aide>Relever 4 à 6 cycles : le cycle s’affiche après deux cycles complets d’une même ligne.</Aide>}
        {releve.cycle && releve.cycle.ecart_type_s > 2 && (
          <Message ton="avertissement">Le cycle varie de plus de 2 s : le carrefour fonctionne sans doute à la demande (bus, boucle, bouton).</Message>
        )}
        {Object.values(releve.verts).some((v) => v !== null) && (
          <Table.Root size="sm">
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeader>Ligne</Table.ColumnHeader>
                <Table.ColumnHeader textAlign="end">Vert mesuré</Table.ColumnHeader>
                <Table.ColumnHeader textAlign="end">Jaune</Table.ColumnHeader>
                <Table.ColumnHeader textAlign="end">Passages</Table.ColumnHeader>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {codes.map((code) => (
                <Table.Row key={code}>
                  <Table.Cell fontWeight="semibold">{code}</Table.Cell>
                  <Table.Cell textAlign="end">
                    <Valeur>{releve.verts[code] === null ? '–' : `${releve.verts[code]} s`}</Valeur>
                  </Table.Cell>
                  <Table.Cell textAlign="end">
                    <Valeur>{releve.jaunes[code] === null || releve.jaunes[code] === undefined ? '–' : `${releve.jaunes[code]} s`}</Valeur>
                  </Table.Cell>
                  <Table.Cell textAlign="end">
                    <Valeur>{releve.tops[code]?.length ?? 0}</Valeur>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>
        )}
        {liste.map((e) => (
          <Message key={e.message} ton="avertissement">
            {e.message}
          </Message>
        ))}
        {releve.cycle && liste.length === 0 && plan?.cycle_s && <Message ton="ok">Conforme au plan « {plan.code} » à 2 s près.</Message>}
      </Section>

      <Section libelle="Fin du relevé">
        {termine ? (
          <HStack gap="2">
            <Message ton="ok" flex="1">
              Relevé terminé à {heure(seance.termine!)}
              {saisies[0] && ` · ${Math.round((seance.termine! - saisies[0].t) / 60000)} min`} : vérifiez la mesure, puis envoyez.
            </Message>
            {!seance.releve && (
              <Button size="xs" variant="ghost" onClick={() => modifier(({ termine: _fin, ...s }) => s)}>
                Reprendre
              </Button>
            )}
          </HStack>
        ) : (
          <Button
            size="lg"
            variant="outline"
            disabled={!saisies.some(estChangementCouleur)}
            onClick={() => {
              setEvenementEnAttente(null)
              modifier((s) => ({ ...s, termine: Date.now() }))
            }}
          >
            J’ai fini
          </Button>
        )}
      </Section>

      <Section libelle="Envoyer">
        {!termine && !seance.releve ? (
          <Aide>« J’ai fini » d’abord : le relevé s’envoie une fois terminé.</Aide>
        ) : seance.releve ? (
          <Message ton="ok">
            Relevé envoyé : il sera publié après relecture.
            {saisiesApresEnvoi > 0 && ` ${saisiesApresEnvoi} saisie(s) depuis : commencez un nouveau relevé pour les envoyer.`}
          </Message>
        ) : (
          <>
            <Input
              size="sm"
              placeholder="Pseudo (facultatif, jamais d’email)"
              aria-label="Pseudo"
              maxLength={40}
              value={pseudo}
              onChange={(e) => setPseudo(e.target.value)}
            />
            {/* Champ piège : hors de l'écran et du parcours clavier, ignoré des lecteurs d'écran. */}
            <Input
              name="site_web"
              tabIndex={-1}
              autoComplete="off"
              aria-hidden
              position="absolute"
              left="-10000px"
              value={siteWeb}
              onChange={(e) => setSiteWeb(e.target.value)}
            />
            <Button
              variant="solid"
              size="lg"
              disabled={!saisies.some(estChangementCouleur)}
              loading={envoiReleve.isPending}
              onClick={() => envoiReleve.mutate()}
            >
              Envoyer le relevé
            </Button>
            <Aide>Couleurs et événements horodatés, relus avant d’être publiés. Le relevé reste sur ce téléphone, même sans réseau.</Aide>
          </>
        )}
        {envoiReleve.error && <Message ton="erreur">{envoiReleve.error.message}</Message>}
        <Button variant="outline" size="sm" disabled={aEnvoyer.length === 0} loading={envoi.isPending} onClick={() => envoi.mutate()}>
          {aEnvoyer.length > 0 ? `Caler le plan : ${aEnvoyer.length} passage(s) au vert` : 'Plan calé sur ce relevé'}
        </Button>
        <Aide>Les passages au vert calent le plan en vigueur sur l’heure réelle (édition locale seulement pour l’instant).</Aide>
        {envoi.error && <Message ton="erreur">{envoi.error.message}</Message>}
      </Section>

      {(releves.data?.length ?? 0) > 0 && (
        <Section libelle={`Relevés de ce carrefour (${releves.data!.length})`}>
          {releves.data!.map((r) => (
            <HStack key={r.id} gap="2" textStyle="xs">
              <Text flex="1">
                {new Date(r.observe_le).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}
                {r.pseudo && ` · ${r.pseudo}`}
              </Text>
              <Valeur>{r.cycle_s ? `${r.cycle_s} s · ${r.cycles_observes} cycles` : 'cycle non mesuré'}</Valeur>
              <Badge colorPalette={r.statut === 'valide' ? 'green' : 'gray'}>{r.statut === 'valide' ? 'validé' : 'à relire'}</Badge>
            </HStack>
          ))}
        </Section>
      )}

      <Stack gap="2">
        <Button
          variant="ghost"
          size="sm"
          colorPalette="red"
          alignSelf="start"
          disabled={saisies.length === 0}
          onClick={() =>
            (seance.releve || window.confirm('Ce relevé n’a pas été envoyé : l’effacer et en commencer un autre ?')) &&
            modifier(() => ({ saisies: [], envoyes: [] }))
          }
        >
          Nouveau relevé
        </Button>
      </Stack>
      {codes.length > 0 && (
        <TiroirBas titre="Plan du carrefour" ouvert={planOuvert} onOuvert={setPlanOuvert} maxW="560px">
          <PlanCarrefour
            carrefourId={carrefour.id}
            h="auto"
            aspectRatio="1"
            // Pas plus haut que l'écran moins la place des boutons du haut.
            maxH="calc(100dvh - 180px)"
            ligne={ligneVue}
            onLigne={(code) => setLigneVue((actuelle) => (actuelle === code ? null : code))}
            etats={etatsReleves}
          />
          <Aide mt="1.5">Toucher un feu : le bouton de sa ligne s'entoure.</Aide>
        </TiroirBas>
      )}
    </>
  )
}

function EnteteReleve() {
  return (
    <HStack gap="1.5" color="fg.muted" textStyle="xs">
      <IconeFeu />
      Relevé terrain
    </HStack>
  )
}
