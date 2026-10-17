import { Badge, Box, Button, Grid, Heading, HStack, Stack, Table, Text } from '@chakra-ui/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { planEnVigueur } from '@voirie/engine'
import type { CarrefourTempsReel } from '@voirie/schema'
import { useEffect } from 'react'
import { Link, useParams } from 'react-router'
import { api } from '../api'
import { Aide, Chiffre, IconeFeu, Message, Section, Valeur } from '../ds'
import { useMaintenant } from '../tempsReel/useMaintenant'
import { basculer, couleurCourante, ecarts, estChangement, synthese, type Saisie, type TypeEvenement } from './releve'
import { useSeance } from './seance'

const EVENEMENTS: Array<{ type: TypeEvenement; glyphe: string; libelle: string; aide: string }> = [
  { type: 'bus', glyphe: '🚌', libelle: 'Bus', aide: 'Un bus arrive au feu' },
  { type: 'tram', glyphe: '🚋', libelle: 'Tram', aide: 'Un tram arrive au feu' },
  { type: 'boucle', glyphe: '🚗', libelle: 'Boucle', aide: 'Un véhicule s’arrête sur une boucle de détection' },
  { type: 'pieton', glyphe: '🚶', libelle: 'Bouton', aide: 'Un piéton appuie sur le bouton d’appel' },
]

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
      <Stack gap="5" maxW="560px" mx="auto" px="4" py="3">
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
  const releve = synthese(saisies, codes)
  const liste = ecarts(releve, plan?.mode === 'cycle' ? plan : null)
  const aEnvoyer = Object.entries(releve.tops).flatMap(([ligne, instants]) =>
    instants.filter((t) => !seance.envoyes.includes(t)).map((t) => ({ ligne, t })),
  )

  const saisir = (suivantes: Saisie[]) => {
    navigator.vibrate?.(15)
    modifier((s) => ({ ...s, saisies: suivantes }))
  }

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
        <Section libelle="Lignes de feux · un appui à chaque changement">
          <Grid templateColumns="repeat(2, minmax(0, 1fr))" gap="2.5">
            {carrefour.lignes.map((ligne) => {
              const couleur = couleurCourante(saisies, ligne.code)
              const depuis = [...saisies].reverse().find((s) => estChangement(s) && s.ligne === ligne.code)?.t
              const prochaine = couleur === 'vert' ? 'rouge' : 'vert'
              return (
                <Button
                  key={ligne.code}
                  h="24"
                  flexDirection="column"
                  gap="0.5"
                  borderRadius="l3"
                  bg={couleur === 'vert' ? 'feu.vert' : couleur === 'rouge' ? 'feu.rouge' : 'bg.muted'}
                  color={couleur ? 'white' : 'fg'}
                  aria-label={`${ligne.code}${couleur ? ` au ${couleur}` : ''} : passe au ${prochaine}`}
                  onClick={() => saisir(basculer(saisies, ligne.code, Date.now()))}
                >
                  <Text textStyle="2xl" fontWeight="bold">
                    {ligne.code}
                  </Text>
                  <Text textStyle="xs">
                    {couleur && depuis ? `${couleur} depuis ${secondes(maintenant - depuis)}` : 'appuyer au vert'}
                    {ligne.pieton && ' · piéton'}
                  </Text>
                </Button>
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
              onClick={() => saisir([...saisies, { t: Date.now(), evenement: e.type }])}
            >
              <Text textStyle="xl">{e.glyphe}</Text>
              <Text textStyle="xs">
                {e.libelle}
                {releve.evenements[e.type] > 0 && ` · ${releve.evenements[e.type]}`}
              </Text>
            </Button>
          ))}
        </Grid>
        {derniere && (
          <HStack gap="2">
            <Aide flex="1">
              Dernière saisie {heure(derniere.t)} :{' '}
              {estChangement(derniere) ? `${derniere.ligne} au ${derniere.couleur}` : EVENEMENTS.find((e) => e.type === derniere.evenement)?.libelle}
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

      <Stack gap="2">
        <Button variant="solid" size="lg" disabled={aEnvoyer.length === 0} loading={envoi.isPending} onClick={() => envoi.mutate()}>
          {aEnvoyer.length > 0 ? `Envoyer ${aEnvoyer.length} passage(s) au vert au calage` : 'Rien à envoyer'}
        </Button>
        <Aide>
          Les passages au vert calent le plan en vigueur sur l’heure réelle. Le relevé reste sur ce téléphone, même sans réseau.
        </Aide>
        {envoi.error && <Message ton="erreur">{envoi.error.message}</Message>}
        <Button
          variant="ghost"
          size="sm"
          colorPalette="red"
          alignSelf="start"
          disabled={saisies.length === 0}
          onClick={() => window.confirm('Effacer ce relevé et en commencer un autre ?') && modifier(() => ({ saisies: [], envoyes: [] }))}
        >
          Nouveau relevé
        </Button>
      </Stack>
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
