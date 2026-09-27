import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { LonLat } from '@voirie/engine'
import type { AnalyseIa, Bbox, CarrefourResume, FeuResume, TypeJour } from '@voirie/schema'
import { Badge, Button, Heading, HStack, Stack, Tabs, Text } from '@chakra-ui/react'
import { useCallback, useRef, useState } from 'react'
import { api } from './api'
import {
  PanneauConfiguration,
  type AffichageConfiguration,
  type PanneauConfigurationHandle,
} from './configuration/PanneauConfiguration'
import { useAnalysesIa, useNotificationsIa } from './configuration/analysesIa'
import { FileIa } from './configuration/FileIa'
import { PanneauEdition, type Edition } from './edition/PanneauEdition'
import { Aide, Bascule, Message, ModeCouleur, Pastille, Section, Segments, Selecteur } from './ds'
import { CarteCarrefours } from './map/CarteCarrefours'
import { CouchePertes } from './map/CouchePertes'
import { CoucheTrams, type CouchesTram } from './map/CoucheTrams'
import type { OptionsFond } from './map/FondDeCarte'
import { usePreference } from './preferences'
import { PALIERS_PERTE } from './tram/pertes'

/** Le flux Ginko est mis en cache 10 s par l'API. */
const RAFRAICHISSEMENT_TRAMS_MS = 15_000

/** « Carte » : la vue grand public. « Données brutes » : toutes les couches, une par une. */
type Mode = 'carte' | 'brut'

interface CouchesBrutes extends CouchesTram {
  carrefours: boolean
  /** Temps perdu par tronçon, tiré de l'historique des passages. */
  pertes: boolean
}

const FOND_DEFAUT: OptionsFond = { fond: 'satellite', relief3d: false, batiments: false }
const COUCHES_BRUTES_DEFAUT: CouchesBrutes = {
  carrefours: true,
  lignes: true,
  arrets: true,
  zones: true,
  rames: true,
  pertes: true,
}

/** Type de jour de la date donnée (heure locale du navigateur). */
function typeJour(date: Date): TypeJour {
  const jour = date.getDay()
  return jour === 6 ? 'samedi' : jour === 0 ? 'dimanche' : 'semaine'
}

function App() {
  const queryClient = useQueryClient()
  const [bbox, setBbox] = useState<Bbox>()
  const [mode, setMode] = usePreference<Mode>('mode', 'carte')
  const [fond, setFond] = usePreference<OptionsFond>('fond', FOND_DEFAUT)
  const [trams, setTrams] = usePreference<boolean>('trams', true)
  const [brut, setBrut] = usePreference<CouchesBrutes>('couches-brutes', COUCHES_BRUTES_DEFAUT)
  const [creneau, setCreneau] = useState<{ typeJour: TypeJour; heure: number | null }>(() => ({
    typeJour: typeJour(new Date()),
    heure: new Date().getHours(),
  }))
  const [edition, setEdition] = useState<Edition | null>(null)
  const [configuration, setConfiguration] = useState<{
    carrefour: CarrefourResume
    position: [number, number]
    /** Proposition IA à charger à l'ouverture (bouton « Ouvrir » d'une notification). */
    ouvrirAnalyseIa?: { id: string }
  } | null>(null)
  const [affichageConfiguration, setAffichageConfiguration] = useState<AffichageConfiguration>({
    branches: [],
    connexions: [],
    mode: null,
    feuxSurlignes: [],
    connexionsSurlignees: [],
    feux: null,
  })
  const panneauConfiguration = useRef<PanneauConfigurationHandle>(null)
  // Relais stables des gestes de la carte vers le panneau de configuration.
  const deplacerPoignee = useCallback<PanneauConfigurationHandle['deplacerPoignee']>(
    (poignee, position) => panneauConfiguration.current?.deplacerPoignee(poignee, position),
    [],
  )
  const connecter = useCallback<PanneauConfigurationHandle['connecter']>(
    (de, vers) => panneauConfiguration.current?.connecter(de, vers),
    [],
  )


  // File des propositions OSM + IA : suivie partout, notifiée à la fin de chaque analyse.
  const analysesIa = useAnalysesIa()
  const ouvrirAnalyseIa = useCallback((analyse: AnalyseIa) => {
    setEdition(null)
    setConfiguration({ carrefour: analyse.carrefour, position: analyse.position, ouvrirAnalyseIa: { id: analyse.id } })
  }, [])
  useNotificationsIa(analysesIa.data, ouvrirAnalyseIa)

  const couchesTram: CouchesTram =
    mode === 'carte' ? { lignes: trams, arrets: trams, zones: trams, rames: trams } : brut
  const tramAffiche = Object.values(couchesTram).some(Boolean)
  const pertes = mode === 'brut' && brut.pertes

  const sante = useQuery({ queryKey: ['sante'], queryFn: api.sante, retry: false })
  const carrefours = useQuery({
    queryKey: ['carrefours', bbox],
    queryFn: () => api.carrefours(bbox!),
    enabled: bbox !== undefined,
    placeholderData: (precedent) => precedent,
  })
  const feux = useQuery({
    queryKey: ['feux', bbox],
    queryFn: () => api.feux(bbox!),
    enabled: bbox !== undefined,
    placeholderData: (precedent) => precedent,
  })

  const placerFeu = useCallback(
    async (id: string, position: LonLat | null) => {
      try {
        await api.placerFeu(id, position)
        // Le centre du carrefour suit ses feux.
        await Promise.all(
          [['feux'], ['carrefours'], ['branches']].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
        )
      } catch (erreur) {
        window.alert((erreur as Error).message)
      }
    },
    [queryClient],
  )

  const rafraichir = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['carrefours'] }),
      queryClient.invalidateQueries({ queryKey: ['feux'] }),
    ])

  const enregistrer = useMutation({
    mutationFn: ({ edition, nom }: { edition: Edition; nom: string | null }) => {
      const donnees = { nature: edition.nature, feux: edition.selection, ...(nom ? { nom } : {}) }
      return edition.carrefourId
        ? api.modifierCarrefour(edition.carrefourId, donnees)
        : api.creerCarrefour(donnees)
    },
    onSuccess: async () => {
      setEdition(null)
      await rafraichir()
    },
  })

  const supprimer = useMutation({
    mutationFn: (carrefour: CarrefourResume) => api.supprimerCarrefour(carrefour.id),
    onSuccess: rafraichir,
    onError: (erreur) => window.alert(erreur.message),
  })

  const demarrer = (nouvelle: Edition) => {
    enregistrer.reset()
    setEdition(nouvelle)
  }

  const basculerFeu = (feu: FeuResume) => {
    if (!edition) return
    if (feu.carrefour_id && feu.carrefour_id !== edition.carrefourId) return
    const selection = edition.selection.includes(feu.id)
      ? edition.selection.filter((id) => id !== feu.id)
      : [...edition.selection, feu.id]
    setEdition({ ...edition, selection })
  }

  /** Ajoute les feux d'un rectangle : seulement ceux qui sont libres ou déjà à ce carrefour. */
  const ajouterFeux = (couverts: FeuResume[]) => {
    if (!edition) return
    const eligibles = couverts
      .filter((feu) => !feu.carrefour_id || feu.carrefour_id === edition.carrefourId)
      .map((feu) => feu.id)
    setEdition({ ...edition, selection: [...new Set([...edition.selection, ...eligibles])] })
  }

  const modifier = (carrefour: CarrefourResume) =>
    demarrer({
      carrefourId: carrefour.id,
      selection: (feux.data?.features ?? []).filter((f) => f.properties.carrefour_id === carrefour.id).map((f) => f.id),
      nature: carrefour.nature,
      nomSaisi: carrefour.nom,
      modeRectangle: false,
    })

  const feuxLibres = feux.data?.features.filter((f) => f.properties.carrefour_id === null).length

  const reseauTram = useQuery({
    queryKey: ['tram', 'reseau'],
    queryFn: api.reseauTram,
    enabled: tramAffiche || pertes,
    staleTime: Infinity,
  })
  const tramsTempsReel = useQuery({
    queryKey: ['tram', 'temps-reel'],
    queryFn: api.tramsTempsReel,
    enabled: (couchesTram.rames || couchesTram.zones) && reseauTram.isSuccess,
    refetchInterval: RAFRAICHISSEMENT_TRAMS_MS,
    placeholderData: (precedent) => precedent,
  })
  const historique = useQuery({
    queryKey: ['tram', 'historique', creneau],
    queryFn: () => api.historiqueTroncons(creneau.typeJour, creneau.heure),
    enabled: pertes,
    placeholderData: (precedent) => precedent,
  })
  const etatHistorique = useQuery({
    queryKey: ['tram', 'historique', 'etat'],
    queryFn: api.historiqueEtat,
    enabled: mode === 'brut',
    refetchInterval: 60_000,
  })

  const basculer = (couche: keyof CouchesBrutes) => (coche: boolean) =>
    setBrut((couches) => ({ ...couches, [couche]: coche }))
  const enLigne = tramsTempsReel.data?.trams.filter((t) => t.etat === 'en_ligne').length

  return (
    <>
      <CarteCarrefours
        carrefours={carrefours.data}
        afficherCarrefours={mode === 'carte' || brut.carrefours || edition !== null || configuration !== null}
        fond={fond}
        feux={feux.data}
        edition={
          edition && {
            selection: edition.selection,
            carrefourId: edition.carrefourId,
            modeRectangle: edition.modeRectangle,
          }
        }
        onEmprise={setBbox}
        onBasculerFeu={basculerFeu}
        onAjouterFeux={ajouterFeux}
        onComposerDepuis={(feu) =>
          demarrer({
            carrefourId: null,
            selection: [feu.id],
            nature: feu.type === 'pieton' ? 'traversee_pietonne' : 'carrefour',
            nomSaisi: null,
            modeRectangle: false,
          })
        }
        onModifier={modifier}
        onConfigurer={(carrefour, position) => {
          setEdition(null)
          setConfiguration({ carrefour, position })
        }}
        configuration={
          configuration && {
            carrefourId: configuration.carrefour.id,
            position: configuration.position,
            ...affichageConfiguration,
          }
        }
        onClicFeuConfiguration={(feu) => panneauConfiguration.current?.clicFeu(feu)}
        onDeplacerPoignee={deplacerPoignee}
        onConnecter={connecter}
        onPlacerFeu={placerFeu}
        onSupprimer={(carrefour) => {
          if (window.confirm(`Supprimer « ${carrefour.nom} » ? Ses feux redeviendront libres.`)) {
            supprimer.mutate(carrefour)
          }
        }}
      >
        {pertes && reseauTram.data && historique.data && (
          <CouchePertes reseau={reseauTram.data} historique={historique.data} />
        )}
        {tramAffiche && reseauTram.data && (
          <CoucheTrams reseau={reseauTram.data} tempsReel={tramsTempsReel.data} couches={couchesTram} />
        )}
      </CarteCarrefours>
      <Stack
        as="aside"
        position="absolute"
        top="3"
        left="3"
        zIndex="1"
        gap="3"
        w={configuration ? 'min(440px, calc(100vw - 24px))' : 'min(360px, calc(100vw - 24px))'}
        maxH="calc(100vh - 24px)"
        overflowY="auto"
        px="14px"
        py="3"
        bg="bg.panel"
        borderRadius="l3"
        boxShadow="carte"
      >
        <HStack align="start" gap="2">
          <Stack gap="0.5" flex="1">
            <Heading as="h1" textStyle="xl" fontWeight="semibold">
              Besançon Voirie
            </Heading>
            <Aide>Inventaire citoyen des feux tricolores.</Aide>
            {sante.isSuccess && (
              <Message ton="ok">
                API connectée · PostGIS {sante.data.db.postgis} · pgRouting {sante.data.db.pgrouting}
              </Message>
            )}
            {sante.isError && <Message ton="erreur">API injoignable</Message>}
          </Stack>
          <ModeCouleur />
        </HStack>

        {analysesIa.data && <FileIa analyses={analysesIa.data} onOuvrir={ouvrirAnalyseIa} />}

        {configuration ? (
          <PanneauConfiguration
            key={configuration.carrefour.id}
            carrefour={configuration.carrefour}
            feuxCarrefour={feux.data?.features.filter((f) => f.properties.carrefour_id === configuration.carrefour.id)}
            ouvrirAnalyseIa={configuration.ouvrirAnalyseIa ?? null}
            ref={panneauConfiguration}
            onAffichage={setAffichageConfiguration}
            onFermer={() => setConfiguration(null)}
          />
        ) : edition ? (
          <PanneauEdition
            edition={edition}
            enregistrement={{ enCours: enregistrer.isPending, erreur: enregistrer.error?.message ?? null }}
            onChanger={setEdition}
            onEnregistrer={(nom) => enregistrer.mutate({ edition, nom })}
            onAnnuler={() => setEdition(null)}
          />
        ) : (
          <Stack gap="3">
            <Tabs.Root value={mode} onValueChange={(e) => setMode(e.value as Mode)}>
              <Tabs.List>
                <Tabs.Trigger value="carte">Carte</Tabs.Trigger>
                <Tabs.Trigger value="brut">Données brutes</Tabs.Trigger>
              </Tabs.List>
            </Tabs.Root>

            {mode === 'carte' ? (
              <Stack gap="2.5">
                <HStack gap="1.5" wrap="wrap">
                  {carrefours.data && <Badge colorPalette="gray">{carrefours.data.features.length} carrefour(s) dans la vue</Badge>}
                  {feuxLibres !== undefined && <Badge colorPalette="orange">{feuxLibres} feu(x) à regrouper</Badge>}
                </HStack>
                {feuxLibres !== undefined && <Aide>Zoomer pour voir les feux à regrouper.</Aide>}
                <Button
                  variant="solid"
                  alignSelf="start"
                  onClick={() =>
                    demarrer({ carrefourId: null, selection: [], nature: 'carrefour', nomSaisi: null, modeRectangle: true })
                  }
                >
                  Composer un carrefour
                </Button>
                <Bascule coche={trams} onChange={setTrams}>
                  Trams en temps réel
                </Bascule>
                {trams && enLigne !== undefined && (
                  <Aide>{enLigne} rame(s) en ligne · position estimée d'après les temps d'attente Ginko</Aide>
                )}
              </Stack>
            ) : (
              <Stack gap="2">
                <Bascule coche={brut.carrefours} onChange={basculer('carrefours')}>
                  Carrefours à feux{carrefours.data && ` (${carrefours.data.features.length} dans la vue)`}
                </Bascule>
                <Bascule coche={brut.lignes} onChange={basculer('lignes')}>
                  Tram : lignes (GTFS)
                </Bascule>
                <Bascule coche={brut.arrets} onChange={basculer('arrets')}>
                  Tram : arrêts
                </Bascule>
                <Bascule coche={brut.rames} onChange={basculer('rames')}>
                  Tram : rames, position estimée{enLigne !== undefined && ` (${enLigne} en ligne)`}
                </Bascule>
                <Bascule coche={brut.zones} onChange={basculer('zones')}>
                  Tram : zones probables
                </Bascule>
                <Bascule coche={brut.pertes} onChange={basculer('pertes')}>
                  Tram : temps perdu par tronçon
                </Bascule>
                {brut.pertes && (
                  <Stack gap="2" ps="11">
                    <HStack gap="1.5">
                      <Selecteur
                        size="xs"
                        aria-label="Type de jour"
                        valeur={creneau.typeJour}
                        onChange={(valeur) => setCreneau((c) => ({ ...c, typeJour: valeur as TypeJour }))}
                      >
                        <option value="semaine">Semaine</option>
                        <option value="samedi">Samedi</option>
                        <option value="dimanche">Dimanche</option>
                      </Selecteur>
                      <Selecteur
                        size="xs"
                        aria-label="Heure"
                        valeur={creneau.heure ?? ''}
                        onChange={(valeur) => setCreneau((c) => ({ ...c, heure: valeur === '' ? null : Number(valeur) }))}
                      >
                        <option value="">Toute la journée</option>
                        {Array.from({ length: 24 }, (_, h) => (
                          <option key={h} value={h}>
                            {h} h – {h + 1} h
                          </option>
                        ))}
                      </Selecteur>
                    </HStack>
                    <HStack as="ul" rowGap="1" columnGap="2.5" wrap="wrap" listStyleType="none" textStyle="xs">
                      {PALIERS_PERTE.map((palier) => (
                        <HStack as="li" key={palier.libelle} gap="1">
                          <Pastille forme="trait" couleur={palier.couleur} />
                          {palier.libelle}
                        </HStack>
                      ))}
                    </HStack>
                    <Aide>
                      Durée habituelle moins durée quand ça roule bien.
                      {historique.data && ` ${historique.data.troncons.length} tronçon(s) observé(s).`}
                    </Aide>
                  </Stack>
                )}
                {etatHistorique.data && (
                  <Aide>
                    Historique : {etatHistorique.data.passages.toLocaleString('fr-FR')} passage(s)
                    {etatHistorique.data.premier &&
                      ` depuis le ${new Date(etatHistorique.data.premier).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}`}
                    {!etatHistorique.data.collecteActive && ' · collecte arrêtée (TRAM_COLLECTE)'}
                  </Aide>
                )}
              </Stack>
            )}

            {(reseauTram.isError || tramsTempsReel.isError) && (
              <Message ton="erreur">
                Trams indisponibles : {(reseauTram.error ?? tramsTempsReel.error)?.message}
              </Message>
            )}
          </Stack>
        )}

        <Section libelle="Fond de carte" pt="2.5" borderTopWidth="1px" borderColor="border.muted">
          <Segments
            fitted
            aria-label="Fond de carte"
            valeur={fond.fond}
            onChange={(choix) => setFond((options) => ({ ...options, fond: choix }))}
            options={[
              { valeur: 'satellite', libelle: 'Satellite' },
              { valeur: 'plan', libelle: 'Plan' },
            ]}
          />
          <Bascule coche={fond.batiments} onChange={(batiments) => setFond((options) => ({ ...options, batiments }))}>
            Bâtiments
          </Bascule>
          <Bascule coche={fond.relief3d} onChange={(relief3d) => setFond((options) => ({ ...options, relief3d }))}>
            3D (plus gourmand)
          </Bascule>
        </Section>

        <Text textStyle="2xs" color="fg.muted">
          Outil citoyen indépendant, sans lien avec la Ville ou la Métropole. Données indicatives.
        </Text>
      </Stack>
    </>
  )
}

export default App
