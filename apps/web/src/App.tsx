import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { LonLat } from '@voirie/engine'
import type { AnalyseIa, Bbox, CarrefourResume, FeuResume, TypeJour } from '@voirie/schema'
import { Badge, Box, HStack, IconButton, Kbd, Popover, Portal, Stack, Tabs, Text } from '@chakra-ui/react'
import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react'
import { useMap } from 'react-map-gl/maplibre'
import { api } from './api'
import { FicheCarrefour } from './carrefour/FicheCarrefour'
import { useBrouillons, type BrouillonsCarrefour } from './configuration/brouillons'
import { CarteSuivi } from './configuration/CarteSuivi'
import { MENU_CONFIGURATION, type ActionConfiguration } from './configuration/actions'
import {
  ConfigurationCarrefour,
  hauteurPanneau,
  type AffichageConfiguration,
  type ConfigurationCarrefourHandle,
} from './configuration/ConfigurationCarrefour'
import {
  Aide,
  BandeauMode,
  BarreOutils,
  Bascule,
  CarteEnTete,
  MenuContextuel,
  Message,
  ModeCouleur,
  Pastille,
  Section,
  Segments,
  Selecteur,
  type EntreeMenu,
} from './ds'
import { useAnalysesIa, useNotificationsIa } from './configuration/analysesIa'
import { PanneauEdition, type Edition } from './edition/PanneauEdition'
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

/** Carrefour choisi sur la carte, avec la position de son centre. */
interface CarrefourChoisi {
  carrefour: CarrefourResume
  position: [number, number]
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
  /** Carrefour sélectionné : sa fiche remplace la carte d'en-tête. */
  const [selection, setSelection] = useState<CarrefourChoisi | null>(null)
  const [configuration, setConfiguration] = useState<(CarrefourChoisi & {
    /** Proposition IA à charger à l'ouverture (« Ouvrir » d'une notification). */
    ouvrirAnalyseIa?: { id: string }
  }) | null>(null)
  const [panneauBasOuvert, setPanneauBasOuvert] = useState(false)
  const brouillons = useBrouillons()
  const [affichageConfiguration, setAffichageConfiguration] = useState<AffichageConfiguration>({
    branches: [],
    connexions: [],
    mode: null,
    feuxSurlignes: [],
    connexionsSurlignees: [],
    feux: null,
    choixFeux: false,
    selection: null,
    ancre: null,
    cadreIa: null,
  })
  const [ciblePopup, setCiblePopup] = useState<HTMLElement | null>(null)
  const [pointMenu, setPointMenu] = useState<LonLat | null>(null)
  const { carte } = useMap()
  const panneauConfiguration = useRef<ConfigurationCarrefourHandle>(null)
  // Relais stables des gestes de la carte vers la configuration.
  const deplacerPoignee = useCallback<ConfigurationCarrefourHandle['deplacerPoignee']>(
    (poignee, position) => panneauConfiguration.current?.deplacerPoignee(poignee, position),
    [],
  )
  const connecter = useCallback<ConfigurationCarrefourHandle['connecter']>(
    (de, vers) => panneauConfiguration.current?.connecter(de, vers),
    [],
  )
  const dessinerZoneIa = useCallback<ConfigurationCarrefourHandle['dessinerZoneIa']>(
    (emprise) => panneauConfiguration.current?.dessinerZoneIa(emprise),
    [],
  )


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
    onSuccess: (_, carrefour) => {
      setSelection((choix) => (choix?.carrefour.id === carrefour.id ? null : choix))
      return rafraichir()
    },
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

  // La fiche suit les données à jour du carrefour (nombre de feux après une modification…).
  const carrefourSelectionne = selection
    ? (carrefours.data?.features.find((f) => f.id === selection.carrefour.id)?.properties ?? selection.carrefour)
    : null

  const configurer = (choix: CarrefourChoisi) => {
    setEdition(null)
    setSelection(choix)
    setConfiguration(choix)
  }
  const reprendre = (b: BrouillonsCarrefour) => configurer({ carrefour: b.carrefour, position: b.position })

  /** Un clic sur un carrefour remplace celui qu'on regarde : sa fiche, ou sa configuration. */
  const selectionner = (choix: CarrefourChoisi | null) => {
    if (configuration) return choix && configurer(choix)
    setSelection(choix)
  }

  const confirmerSuppression = (carrefour: CarrefourResume) => {
    if (window.confirm(`Supprimer « ${carrefour.nom} » ? Ses feux redeviendront libres.`)) supprimer.mutate(carrefour)
  }

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

  // File des propositions OSM + IA : suivie partout, notifiée à la fin de chaque analyse.
  const analysesIa = useAnalysesIa()
  const ouvrirAnalyseIa = useCallback((analyse: AnalyseIa) => {
    const choix = { carrefour: analyse.carrefour, position: analyse.position }
    setEdition(null)
    setSelection(choix)
    setConfiguration({ ...choix, ouvrirAnalyseIa: { id: analyse.id } })
  }, [])

  useNotificationsIa(analysesIa.data, ouvrirAnalyseIa)

  // Modifications non enregistrées : le navigateur demande confirmation avant de quitter la page.
  const brouillonsEnCours = brouillons.size > 0
  useEffect(() => {
    if (!brouillonsEnCours) return
    const retenir = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', retenir)
    return () => window.removeEventListener('beforeunload', retenir)
  }, [brouillonsEnCours])

  const composer = () =>
    demarrer({ carrefourId: null, selection: [], nature: 'carrefour', nomSaisi: null, modeRectangle: true })

  // Raccourcis hors configuration (la configuration gère les siens).
  const touche = useEffectEvent((e: KeyboardEvent) => {
    if (configuration || e.ctrlKey || e.metaKey || e.altKey) return
    if (e.target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return
    const lettre = e.key.toLowerCase()
    if (!edition && selection) {
      if (e.key === 'Escape') return setSelection(null)
      const surLaCarte = e.target === document.body || (e.target instanceof HTMLElement && e.target.classList.contains('maplibregl-canvas'))
      if (e.key === 'Enter' && surLaCarte) return configurer(selection)
    }
    if (!edition) return lettre === 'n' && composer()
    if (e.key === 'Escape') return setEdition(null)
    if (lettre === 'r' || lettre === 'v') setEdition({ ...edition, modeRectangle: lettre === 'r' })
  })
  useEffect(() => {
    window.addEventListener('keydown', touche)
    return () => window.removeEventListener('keydown', touche)
  }, [])

  const entreesMenu: EntreeMenu[] = [
    ...(configuration
      ? MENU_CONFIGURATION
      : [{ valeur: 'composer', glyphe: '⌖', libelle: 'Composer un carrefour', raccourci: 'N' }, { type: 'separateur' as const }]),
    { type: 'separateur' },
    { valeur: 'centrer', glyphe: '✥', libelle: 'Centrer la carte ici' },
    { valeur: 'copier', glyphe: '⎘', libelle: 'Copier les coordonnées' },
  ]
  const choisirMenu = (valeur: string) => {
    if (valeur === 'centrer' && pointMenu) return carte?.flyTo({ center: pointMenu })
    if (valeur === 'copier' && pointMenu) return void navigator.clipboard?.writeText(`${pointMenu[1].toFixed(6)}, ${pointMenu[0].toFixed(6)}`)
    if (valeur === 'composer') return composer()
    panneauConfiguration.current?.executer(valeur as ActionConfiguration)
  }

  return (
    <>
      <MenuContextuel
        entete={pointMenu && `${pointMenu[1].toFixed(4)} N · ${pointMenu[0].toFixed(4)} E`}
        entrees={entreesMenu.filter((entree, i, liste) => entree.type !== 'separateur' || (i > 0 && liste[i - 1]!.type !== 'separateur'))}
        onChoisir={choisirMenu}
      >
        <Box position="fixed" inset="0">
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
            selection={configuration ? null : (selection?.carrefour.id ?? null)}
            onSelectionner={selectionner}
            configuration={
              configuration && {
                carrefourId: configuration.carrefour.id,
                position: configuration.position,
                ...affichageConfiguration,
              }
            }
            onClicFeuConfiguration={(feu, position) => panneauConfiguration.current?.clicFeu(feu, position)}
            onClicCarteConfiguration={() => panneauConfiguration.current?.clicCarte()}
            onClicCalque={(clic) => panneauConfiguration.current?.clicCalque(clic)}
            onCiblePopup={setCiblePopup}
            onMenuContextuel={setPointMenu}
            onDeplacerPoignee={deplacerPoignee}
            onConnecter={connecter}
            onDessinerZoneIa={dessinerZoneIa}
            onPlacerFeu={placerFeu}
          >
            {pertes && reseauTram.data && historique.data && (
              <CouchePertes reseau={reseauTram.data} historique={historique.data} />
            )}
            {tramAffiche && reseauTram.data && (
              <CoucheTrams reseau={reseauTram.data} tempsReel={tramsTempsReel.data} couches={couchesTram} />
            )}
          </CarteCarrefours>
        </Box>
      </MenuContextuel>

      {configuration ? (
        <ConfigurationCarrefour
          key={configuration.carrefour.id}
          ref={panneauConfiguration}
          carrefour={configuration.carrefour}
          position={configuration.position}
          ciblePopup={ciblePopup}
          onAffichage={setAffichageConfiguration}
          onPlacerFeu={placerFeu}
          ouvrirAnalyseIa={configuration.ouvrirAnalyseIa ?? null}
          onPanneauBas={setPanneauBasOuvert}
          onFermer={() => setConfiguration(null)}
        />
      ) : (
        <>
          {carrefourSelectionne && selection && !edition ? (
            <FicheCarrefour
              carrefour={carrefourSelectionne}
              brouillons={brouillons.get(carrefourSelectionne.id)}
              onConfigurer={() => configurer({ carrefour: carrefourSelectionne, position: selection.position })}
              onModifierFeux={() => modifier(carrefourSelectionne)}
              onSupprimer={() => confirmerSuppression(carrefourSelectionne)}
              onFermer={() => setSelection(null)}
            />
          ) : (
            <CarteEnTete
              position="fixed"
              top="3"
              left="3"
              zIndex="2"
              w="340px"
              maxW="calc(100vw - 24px)"
              surtitre="Besançon Voirie"
              titre={edition ? (edition.carrefourId ? 'Modifier le carrefour' : 'Composer un carrefour') : 'Inventaire citoyen des feux tricolores'}
              badges={
                <>
                  {sante.isSuccess && <Badge colorPalette="green">API connectée</Badge>}
                  {sante.isError && <Badge colorPalette="red">API injoignable</Badge>}
                  {carrefours.data && <Badge colorPalette="gray">{carrefours.data.features.length} carrefour(s) dans la vue</Badge>}
                  {feuxLibres !== undefined && feuxLibres > 0 && <Badge colorPalette="orange">{feuxLibres} feu(x) à regrouper</Badge>}
                </>
              }
            >
              {edition && (
                <Box mt="3" pt="3" borderTopWidth="1px" borderColor="border.muted">
                  <PanneauEdition
                    edition={edition}
                    enregistrement={{ enCours: enregistrer.isPending, erreur: enregistrer.error?.message ?? null }}
                    onChanger={setEdition}
                    onEnregistrer={(nom) => enregistrer.mutate({ edition, nom })}
                    onAnnuler={() => setEdition(null)}
                  />
                </Box>
              )}
            </CarteEnTete>
          )}

          {edition && (
            <BandeauMode
              position="fixed"
              top="3"
              left="50%"
              transform="translateX(-50%)"
              zIndex="2"
              titre={edition.carrefourId ? 'Feux du carrefour' : 'Nouveau carrefour'}
              aides={[
                edition.modeRectangle ? 'Glisser : rectangle de feux' : 'Clic : ajouter ou retirer un feu',
                <Kbd key="echap" variant="inverse">
                  Échap
                </Kbd>,
              ]}
            />
          )}

          <BarreOutils.Root position="fixed" left="50%" transform="translateX(-50%)" bottom="22px" zIndex="3">
            {edition ? (
              <>
                <BarreOutils.Outil
                  glyphe="↖"
                  libelle="Clic"
                  raccourci="V"
                  actif={!edition.modeRectangle}
                  onClick={() => setEdition({ ...edition, modeRectangle: false })}
                />
                <BarreOutils.Outil
                  glyphe="▭"
                  libelle="Rectangle"
                  raccourci="R"
                  actif={edition.modeRectangle}
                  onClick={() => setEdition({ ...edition, modeRectangle: true })}
                />
              </>
            ) : (
              <>
                <BarreOutils.Outil glyphe="↖" libelle="Sélection" raccourci="V" actif />
                <BarreOutils.Outil glyphe="⌖" libelle="Carrefour" raccourci="N" onClick={composer} />
              </>
            )}
          </BarreOutils.Root>
        </>
      )}

      <CarteSuivi
        position="fixed"
        right="3"
        bottom={configuration && panneauBasOuvert ? `calc(${hauteurPanneau} + 12px)` : '3'}
        zIndex="2"
        brouillons={brouillons}
        ouvert={configuration?.carrefour.id ?? null}
        onReprendre={reprendre}
        analyses={analysesIa.data ?? []}
        onOuvrirAnalyse={ouvrirAnalyseIa}
      />

      <Popover.Root positioning={{ placement: 'left-start', gutter: 10 }}>
        <Popover.Trigger asChild>
          <IconButton
            position="fixed"
            top="100px"
            right="4"
            zIndex="2"
            w="9"
            h="9"
            bg="bg.panel"
            borderWidth="0"
            borderRadius="10px"
            boxShadow="carte"
            aria-label="Calques et fond de carte"
            title="Calques et fond de carte"
          >
            ◧
          </IconButton>
        </Popover.Trigger>
        <Portal>
          <Popover.Positioner>
            <Popover.Content w="320px">
              <Popover.Body p="14px">
                <Stack gap="3">
                  <HStack justify="space-between">
                    <Text textStyle="md" fontWeight="semibold">
                      Calques
                    </Text>
                    <ModeCouleur />
                  </HStack>
                  <Tabs.Root value={mode} onValueChange={(e) => setMode(e.value as Mode)}>
                    <Tabs.List>
                      <Tabs.Trigger value="carte">Carte</Tabs.Trigger>
                      <Tabs.Trigger value="brut">Données brutes</Tabs.Trigger>
                    </Tabs.List>
                  </Tabs.Root>
                  {mode === 'carte' ? (
                    <Stack gap="2.5">
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
              </Popover.Body>
            </Popover.Content>
          </Popover.Positioner>
        </Portal>
      </Popover.Root>
    </>
  )
}

export default App
