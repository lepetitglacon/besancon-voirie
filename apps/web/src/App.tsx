import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { LonLat } from '@voirie/engine'
import type { AnalyseIa, Bbox, CarrefourResume, FeuResume, TypeJour } from '@voirie/schema'
import { Badge, Box, Button, HStack, Kbd, Popover, Portal, Stack, Text } from '@chakra-ui/react'
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { Layers, Map as MapIcon, Ruler } from 'lucide-react'
import { useMap } from 'react-map-gl/maplibre'
import { Link, useLocation, useMatch, useNavigate } from 'react-router'
import { api } from './api'
import { ChoixLignesBus } from './bus/ChoixLignesBus'
import { CHOIX_LIGNES_BUS_DEFAUT, filtrerReseauBus, lignesBus, lignesMasquees, type ChoixLignesBus as Choix } from './bus/lignesBus'
import { MenuSite } from './site/MenuSite'
import { avecVue, cheminFiche } from './site/pages'
import { PagesSite } from './site/PagesSite'
import { abandonnerBrouillons, useBrouillons, type BrouillonsCarrefour } from './configuration/brouillons'
import { CarteSuivi } from './configuration/CarteSuivi'
import { MENU_CONFIGURATION, type ActionConfiguration } from './configuration/actions'
import {
  ConfigurationCarrefour,
  type AffichageConfiguration,
  type ConfigurationCarrefourHandle,
  type PlacePanneau,
} from './configuration/ConfigurationCarrefour'
import { largeurPanneau } from './configuration/disposition'
import {
  Aide,
  BandeauMode,
  BAS_BARRE_OUTILS,
  HAUTEUR_BARRE_OUTILS,
  BarreOutils,
  Bascule,
  BoutonCarte,
  CarteEnTete,
  IconeFeu,
  ControleZoom,
  Curseur,
  MenuContextuel,
  Message,
  ModeCouleur,
  PanneauOutil,
  Pastille,
  Section,
  Segments,
  Selecteur,
  type EntreeMenu,
} from './ds'
import { useAnalysesIa, useNotificationsIa } from './configuration/analysesIa'
import { PanneauEdition, type Edition } from './edition/PanneauEdition'
import { CalqueZoneOsm, type ModeZone } from './zone/CalqueZoneOsm'
import { PanneauZoneOsm, type BrouillonZone } from './zone/PanneauZoneOsm'
import { CarteCarrefours } from './map/CarteCarrefours'
import { CouchePertes } from './map/CouchePertes'
import { PanneauMesure } from './map/PanneauMesure'
import { useMesures } from './map/useMesures'
import { CoucheMesuresEnregistrees } from './map/CoucheMesuresEnregistrees'
import { ListeMesures } from './map/ListeMesures'
import { CoucheFeuxTempsReel } from './map/CoucheFeuxTempsReel'
import { CoucheTransport, type CouchesTram } from './map/CoucheTransport'
import type { OptionsFond } from './map/FondDeCarte'
import { usePreference } from './preferences'
import { CoucheFlux } from './sumo/CoucheFlux'
import { CoucheSumo } from './sumo/CoucheSumo'
import { CoucheVehicules } from './sumo/CoucheVehicules'
import { ModeSumo } from './sumo/ModeSumo'
import { FicheTempsReel } from './tempsReel/FicheTempsReel'
import { FicheCarrefour } from './carrefour/FicheCarrefour'
import { FIABILITES } from './tempsReel/libelles'
import { carrefoursSurLeTrace, type ContexteTram } from './tempsReel/priorite'
import { preparerReseau } from './tram/positionsTrams'
import { PALIERS_PERTE } from './tram/pertes'

/** Le flux Ginko est mis en cache 10 s par l'API ; trams et bus le partagent. */
const RAFRAICHISSEMENT_TRAMS_MS = 15_000

/** Les tops ajoutés en édition changent les décalages : relus de temps en temps. */
const RAFRAICHISSEMENT_FEUX_MS = 60_000

/**
 * « Temps réel » : la vue grand public, feux et trams à l'heure réelle, en lecture seule.
 * « Édition » : composition et configuration des carrefours. « Données brutes » : toutes les
 * couches, une par une. « SUMO » : les essais de simulation de la ville, en lecture seule.
 */
type Mode = 'temps_reel' | 'edition' | 'brut' | 'sumo'

const MODES: Array<{ valeur: Mode; glyphe: string; libelle: string }> = [
  { valeur: 'temps_reel', glyphe: '◷', libelle: 'Temps réel' },
  { valeur: 'edition', glyphe: '✎', libelle: 'Édition' },
  { valeur: 'brut', glyphe: '⊞', libelle: 'Données brutes' },
  { valeur: 'sumo', glyphe: '⇶', libelle: 'SUMO' },
]

interface CouchesBrutes extends CouchesTram {
  carrefours: boolean
  /** Temps perdu par tronçon, tiré de l'historique des passages. */
  pertes: boolean
  /** Couches bus, mêmes que pour le tram (CouchesTram). */
  busLignes: boolean
  busArrets: boolean
  busZones: boolean
  busRames: boolean
}

const FOND_DEFAUT: OptionsFond = {
  fond: 'satellite',
  batiments: false,
  affichage3d: false,
  batiments3d: true,
  elevation: true,
  soleil: false,
  heure: null,
}
const COUCHES_BRUTES_DEFAUT: CouchesBrutes = {
  carrefours: true,
  lignes: true,
  arrets: true,
  zones: true,
  rames: true,
  pertes: true,
  busLignes: true,
  busArrets: true,
  busZones: true,
  busRames: true,
}

const AUCUNE_COUCHE: CouchesTram = { lignes: false, arrets: false, zones: false, rames: false }

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

/** Heure du soleil simulé : l'heure réelle, ou une heure choisie au curseur (aujourd'hui). */
function ReglageHeure({ heure, onChange }: { heure: number | null; onChange: (heure: number | null) => void }) {
  const maintenant = new Date()
  const minutes = heure ?? maintenant.getHours() * 60 + maintenant.getMinutes()
  const libelle = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
  return (
    <Stack gap="1">
      <HStack justify="space-between">
        <Text textStyle="xs" color="fg.muted">
          {heure === null ? `Heure réelle (${libelle})` : `Aujourd'hui à ${libelle}`}
        </Text>
        {heure !== null && (
          <Button size="2xs" variant="ghost" onClick={() => onChange(null)}>
            Maintenant
          </Button>
        )}
      </HStack>
      <Curseur size="sm" aria-label={['Heure du soleil']} min={0} max={1435} step={5} valeur={minutes} onChange={onChange} />
    </Stack>
  )
}

function App() {
  const queryClient = useQueryClient()
  const [bbox, setBbox] = useState<Bbox>()
  const [mode, setMode] = usePreference<Mode>('mode-carte', 'temps_reel')
  const tempsReel = mode === 'temps_reel'
  const sumo = mode === 'sumo'
  /** Composer et configurer les carrefours : seulement en mode Édition. */
  const modeEdition = mode === 'edition'
  /** Panneau des couches du mode Données brutes ; la liste des mesures prend sa place quand elle s'ouvre. */
  const [panneauBrut, setPanneauBrut] = usePreference<boolean>('panneau-brut', true)
  const [fond, setFond] = usePreference<OptionsFond>('fond', FOND_DEFAUT)
  const [trams, setTrams] = usePreference<boolean>('trams', true)
  const [bus, setBus] = usePreference<boolean>('bus', false)
  const [choixLignesBus, setChoixLignesBus] = usePreference<Choix>('lignes-bus', CHOIX_LIGNES_BUS_DEFAUT)
  const [brut, setBrut] = usePreference<CouchesBrutes>('couches-brutes', COUCHES_BRUTES_DEFAUT)
  const [creneau, setCreneau] = useState<{ typeJour: TypeJour; heure: number | null }>(() => ({
    typeJour: typeJour(new Date()),
    heure: new Date().getHours(),
  }))
  const [edition, setEdition] = useState<Edition | null>(null)
  /** Outil « Zone OSM » du mode Édition : zone d'import des feux, tracée sur la carte. */
  const [outilZone, setOutilZone] = useState(false)
  /** Brouillon de la zone ; null : la zone enregistrée, telle quelle. */
  const [brouillonZoneSaisi, setBrouillonZone] = useState<BrouillonZone | null>(null)
  const [modeZone, setModeZone] = useState<ModeZone>('retoucher')
  const [pointZone, setPointZone] = useState<LonLat | null>(null)
  /** Mode « dessiner » de l'outil Zone OSM : sommets du polygone en cours. */
  const [traceZone, setTraceZone] = useState<LonLat[]>([])
  const [configuration, setConfiguration] = useState<(CarrefourChoisi & {
    /** Proposition IA à charger à l'ouverture (« Ouvrir » d'une notification). */
    ouvrirAnalyseIa?: { id: string }
  }) | null>(null)
  /** Où est posé le plan de feux de la configuration ; null : fermé. */
  const [planDeFeux, setPlanDeFeux] = useState<PlacePanneau | null>(null)
  /** Carrefour dont la fiche temps réel est ouverte. */
  const [ficheTempsReel, setFicheTempsReel] = useState<CarrefourChoisi | null>(null)
  const brouillons = useBrouillons()
  const [affichageConfiguration, setAffichageConfiguration] = useState<AffichageConfiguration>({
    branches: [],
    connexions: [],
    chainages: [],
    anneau: null,
    mode: null,
    sousOutil: 'deplacer',
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
  // Point de l'écran où le menu est ouvert ; pointMenu reste lu après la fermeture.
  const [ecranMenu, setEcranMenu] = useState<{ x: number; y: number } | null>(null)
  const mesures = useMesures()
  const brutOuvert = mode === 'brut' && panneauBrut && !mesures.liste
  const mesure = mesures.courante
  // Point de la mesure sous le curseur au clic droit : le menu propose de le retirer.
  const [pointMesureMenu, setPointMesureMenu] = useState<number | null>(null)
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
  const tracer = useCallback<ConfigurationCarrefourHandle['tracer']>(
    (segment) => panneauConfiguration.current?.tracer(segment),
    [],
  )
  const dessinerZoneIa = useCallback<ConfigurationCarrefourHandle['dessinerZoneIa']>(
    (emprise) => panneauConfiguration.current?.dessinerZoneIa(emprise),
    [],
  )


  const couchesTram: CouchesTram =
    mode === 'brut'
      ? brut
      : sumo
        ? AUCUNE_COUCHE
        : { lignes: trams, arrets: trams, zones: trams, rames: trams }
  const tramAffiche = Object.values(couchesTram).some(Boolean)
  const couchesBus: CouchesTram =
    mode === 'brut'
      ? { lignes: brut.busLignes, arrets: brut.busArrets, zones: brut.busZones, rames: brut.busRames }
      : sumo
        ? AUCUNE_COUCHE
        : { lignes: bus, arrets: bus, zones: bus, rames: bus }
  const busAffiche = Object.values(couchesBus).some(Boolean)
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
  const feuxTempsReel = useQuery({
    queryKey: ['feux-temps-reel', bbox],
    queryFn: () => api.feuxTempsReel(bbox!),
    enabled: tempsReel && bbox !== undefined,
    refetchInterval: RAFRAICHISSEMENT_FEUX_MS,
    placeholderData: (precedent) => precedent,
  })
  const carrefourTempsReel = ficheTempsReel
    ? (feuxTempsReel.data?.carrefours.find((c) => c.id === ficheTempsReel.carrefour.id) ?? null)
    : null

  /** Hors du mode Édition, on quitte l'édition en cours (les brouillons restent) ; hors du Temps réel, sa fiche. */
  const changerMode = (suivant: Mode) => {
    setMode(suivant)
    if (suivant !== 'edition') {
      setEdition(null)
      setConfiguration(null)
      setOutilZone(false)
    }
    if (suivant !== 'temps_reel') setFicheTempsReel(null)
  }

  // La fiche ouverte en Temps réel et l'adresse /carrefours/:slug se suivent : l'adresse se partage,
  // et le bouton Précédent referme la fiche.
  const slugAdresse = useMatch('/carrefours/:slug')?.params.slug ?? null
  const { pathname } = useLocation()
  const naviguer = useNavigate()
  const ficheAdresse = useQuery({ queryKey: ['fiche', slugAdresse], queryFn: () => api.fiche(slugAdresse!), enabled: slugAdresse !== null })
  /** Slug que l'adresse et la carte ouverte partagent : chacune ne suit l'autre que s'il change. */
  const slugSynchro = useRef<string | null>(null)
  const ouvrirDepuisAdresse = useEffectEvent(() => {
    if (slugAdresse === null) {
      // Retour à la carte seule (Précédent) : la fiche se referme.
      if (pathname === '/' && slugSynchro.current !== null) {
        slugSynchro.current = null
        setFicheTempsReel(null)
      }
      return
    }
    if (slugAdresse === slugSynchro.current || !ficheAdresse.data) return
    slugSynchro.current = slugAdresse
    const { carrefour } = ficheAdresse.data
    changerMode('temps_reel')
    setFicheTempsReel({ carrefour, position: carrefour.position })
    carte?.flyTo({ center: carrefour.position, zoom: Math.max(carte.getZoom(), 18) })
  })
  useEffect(() => ouvrirDepuisAdresse(), [slugAdresse, pathname, ficheAdresse.data])
  useEffect(() => {
    const slug = ficheTempsReel?.carrefour.slug ?? null
    if (slug === slugSynchro.current) return
    slugSynchro.current = slug
    naviguer(avecVue(slug ? cheminFiche(slug) : '/'))
  }, [ficheTempsReel, naviguer])

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
      abandonnerBrouillons(carrefour.id)
      setConfiguration((ouverte) => (ouverte?.carrefour.id === carrefour.id ? null : ouverte))
      return rafraichir()
    },
    onError: (erreur) => window.alert(erreur.message),
  })

  /** Composer ou modifier un carrefour (clic sur un feu libre, N, « Feux ») passe en mode Édition. */
  const demarrer = (nouvelle: Edition) => {
    enregistrer.reset()
    setMode('edition')
    setFicheTempsReel(null)
    setOutilZone(false)
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

  // Le résumé suit les données à jour du carrefour ouvert (nombre de feux après une modification…).
  const carrefourOuvert = configuration
    ? (carrefours.data?.features.find((f) => f.id === configuration.carrefour.id)?.properties ?? configuration.carrefour)
    : null

  /** Un clic sur un carrefour l'ouvre en édition, à la place de celui qui l'était ; « Reprendre » passe en mode Édition. */
  const configurer = (choix: CarrefourChoisi) => {
    setMode('edition')
    setFicheTempsReel(null)
    setOutilZone(false)
    setEdition(null)
    setConfiguration(choix)
  }
  const reprendre = (b: BrouillonsCarrefour) => configurer({ carrefour: b.carrefour, position: b.position })

  const confirmerSuppression = (carrefour: CarrefourResume) => {
    if (window.confirm(`Supprimer « ${carrefour.nom} » ? Ses feux redeviendront libres.`)) supprimer.mutate(carrefour)
  }

  const reseauTram = useQuery({
    queryKey: ['tram', 'reseau'],
    queryFn: api.reseauTram,
    // En Temps réel, les rames servent aussi à la priorité tram, même masquées.
    enabled: tramAffiche || pertes || tempsReel,
    staleTime: Infinity,
  })
  const tramsTempsReel = useQuery({
    queryKey: ['tram', 'temps-reel'],
    queryFn: api.tramsTempsReel,
    enabled: (couchesTram.rames || couchesTram.zones || tempsReel) && reseauTram.isSuccess,
    refetchInterval: RAFRAICHISSEMENT_TRAMS_MS,
    placeholderData: (precedent) => precedent,
  })
  const historique = useQuery({
    queryKey: ['tram', 'historique', creneau],
    queryFn: () => api.historiqueTroncons(creneau.typeJour, creneau.heure),
    enabled: pertes,
    placeholderData: (precedent) => precedent,
  })
  const reseauPrepare = useMemo(() => reseauTram.data && preparerReseau(reseauTram.data), [reseauTram.data])
  const surLeTrace = useMemo(
    () => reseauPrepare && feuxTempsReel.data && carrefoursSurLeTrace(reseauPrepare, feuxTempsReel.data.carrefours),
    [reseauPrepare, feuxTempsReel.data],
  )
  const contexteTram: ContexteTram | null = useMemo(
    () =>
      reseauPrepare && surLeTrace && tramsTempsReel.data
        ? { reseau: reseauPrepare, trams: tramsTempsReel.data, surLeTrace }
        : null,
    [reseauPrepare, surLeTrace, tramsTempsReel.data],
  )
  const reseauBus = useQuery({
    queryKey: ['bus', 'reseau'],
    queryFn: api.reseauBus,
    enabled: busAffiche,
    staleTime: Infinity,
  })
  const busTempsReel = useQuery({
    queryKey: ['bus', 'temps-reel'],
    queryFn: api.busTempsReel,
    enabled: (couchesBus.rames || couchesBus.zones) && reseauBus.isSuccess,
    refetchInterval: RAFRAICHISSEMENT_TRAMS_MS,
    placeholderData: (precedent) => precedent,
  })
  const lignesDuReseauBus = useMemo(() => (reseauBus.data ? lignesBus(reseauBus.data) : []), [reseauBus.data])
  const busMasquees = useMemo(() => lignesMasquees(choixLignesBus, lignesDuReseauBus), [choixLignesBus, lignesDuReseauBus])
  const reseauBusAffiche = useMemo(
    () => reseauBus.data && filtrerReseauBus(reseauBus.data, busMasquees),
    [reseauBus.data, busMasquees],
  )
  // Même estimation que les rames : les bus passent sous la forme attendue par la couche.
  const busCommeTrams = useMemo(
    () => busTempsReel.data && { horodatage: busTempsReel.data.horodatage, trams: busTempsReel.data.bus },
    [busTempsReel.data],
  )
  /** Bus en ligne, par numéro de ligne. */
  const busEnCirculation = useMemo(() => {
    if (!reseauBus.data || !busTempsReel.data) return undefined
    const ligneDuParcours = new Map(reseauBus.data.parcours.map((p) => [p.id, p.ligne]))
    const comptes = new Map<string, number>()
    for (const b of busTempsReel.data.bus) {
      const ligne = ligneDuParcours.get(b.parcours)
      if (ligne !== undefined && b.etat === 'en_ligne') comptes.set(ligne, (comptes.get(ligne) ?? 0) + 1)
    }
    return comptes
  }, [reseauBus.data, busTempsReel.data])
  const busEnLigne =
    busEnCirculation && [...busEnCirculation].reduce((total, [ligne, n]) => total + (busMasquees.has(ligne) ? 0 : n), 0)
  const choisirLignesBus = (masquees: Set<string>) => setChoixLignesBus({ masquees: [...masquees] })
  const choixLignes = reseauBus.data && (
    <ChoixLignesBus
      lignes={lignesDuReseauBus}
      masquees={busMasquees}
      onChange={choisirLignesBus}
      enCirculation={busEnCirculation}
    />
  )

  const etatHistorique = useQuery({
    queryKey: ['tram', 'historique', 'etat'],
    queryFn: api.historiqueEtat,
    enabled: mode === 'brut',
    refetchInterval: 60_000,
  })
  const etatHistoriqueBus = useQuery({
    queryKey: ['bus', 'historique', 'etat'],
    queryFn: api.historiqueBusEtat,
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
    // « Ouvrir » vient d'une notification ou de la carte de suivi, visibles dans tous les modes.
    setMode('edition')
    setFicheTempsReel(null)
    setEdition(null)
    setConfiguration({ ...choix, ouvrirAnalyseIa: { id: analyse.id } })
  }, [setMode])

  useNotificationsIa(analysesIa.data, ouvrirAnalyseIa)

  // Modifications non enregistrées : le navigateur demande confirmation avant de quitter la page.
  const brouillonsEnCours = brouillons.size > 0
  useEffect(() => {
    if (!brouillonsEnCours) return
    const retenir = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', retenir)
    return () => window.removeEventListener('beforeunload', retenir)
  }, [brouillonsEnCours])

  // Zone d'import OSM : suivie toutes les 2 s pendant un import.
  const zoneOsm = useQuery({
    queryKey: ['zone-osm'],
    queryFn: api.zoneOsm,
    enabled: outilZone,
    refetchInterval: (requete) =>
      requete.state.data && ['telechargement', 'chargement'].includes(requete.state.data.import.statut) ? 2000 : false,
  })
  // Fin d'un import : les feux de la carte changent.
  const statutImport = zoneOsm.data?.import.statut
  useEffect(() => {
    if (statutImport === 'termine') void queryClient.invalidateQueries({ queryKey: ['feux'] })
  }, [statutImport, queryClient])
  // À l'ouverture de l'outil, la carte se cadre sur la zone (enregistrée, sinon importée).
  const cadrerZone = useRef(false)
  useEffect(() => {
    const donnees = zoneOsm.data
    if (!outilZone || !cadrerZone.current || !donnees || !carte) return
    cadrerZone.current = false
    const points = (donnees.polygones ?? donnees.zone_importee?.polygones ?? []).flat()
    if (points.length < 3) return
    const lons = points.map((p) => p[0])
    const lats = points.map((p) => p[1])
    carte.fitBounds([Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)], {
      padding: { top: 110, bottom: 100, left: 380, right: 80 },
      duration: 800,
    })
  }, [outilZone, zoneOsm.data, carte])
  const changerModeZone = (suivant: ModeZone) => {
    setModeZone(suivant)
    setPointZone(null)
    setTraceZone([])
  }
  /** Ferme le polygone dessiné (trois sommets au moins) et l'ajoute au tracé de la zone. */
  const fermerTraceZone = () => {
    if (traceZone.length < 3 || !brouillonZone) return
    setBrouillonZone({
      polygones: [...(brouillonZone.polygones ?? []), traceZone],
      source: { contour: brouillonZone.source?.contour ?? null, retouchee: brouillonZone.polygones !== null },
      modifie: true,
    })
    changerModeZone('retoucher')
  }
  const ouvrirZone = () => {
    cadrerZone.current = true
    setEdition(null)
    setConfiguration(null)
    changerModeZone('retoucher')
    setBrouillonZone(null)
    setOutilZone(true)
  }
  const brouillonZone: BrouillonZone | null =
    brouillonZoneSaisi ?? (zoneOsm.data ? { polygones: zoneOsm.data.polygones, source: zoneOsm.data.source, modifie: false } : null)

  const composer = () =>
    demarrer({ carrefourId: null, selection: [], nature: 'carrefour', nomSaisi: null, modeRectangle: true })

  // Raccourcis hors configuration (la configuration gère les siens).
  const touche = useEffectEvent((e: KeyboardEvent) => {
    if (!modeEdition || configuration || e.ctrlKey || e.metaKey || e.altKey) return
    if (e.target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return
    const lettre = e.key.toLowerCase()
    if (outilZone && e.key === 'Enter' && modeZone === 'dessiner') return fermerTraceZone()
    if (outilZone && e.key === 'Escape') return modeZone !== 'retoucher' ? changerModeZone('retoucher') : setOutilZone(false)
    if (!edition) return lettre === 'n' && composer()
    if (e.key === 'Escape') return setEdition(null)
    if (lettre === 'r' || lettre === 'v') setEdition({ ...edition, modeRectangle: lettre === 'r' })
  })
  useEffect(() => {
    window.addEventListener('keydown', touche)
    return () => window.removeEventListener('keydown', touche)
  }, [])

  // Mesure de distance : Échap la ferme (ou la liste des mesures), Retour arrière retire le dernier point.
  const toucheMesure = useEffectEvent((e: KeyboardEvent) => {
    if (e.target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return
    if (mesures.liste && e.key === 'Escape') {
      e.stopImmediatePropagation()
      return mesures.fermerListe()
    }
    if (!mesure) return
    if (e.key === 'Escape') {
      e.stopImmediatePropagation()
      mesures.fermer()
    } else if (e.key === 'Backspace') mesures.retirerDernier()
  })
  useEffect(() => {
    // En capture : Échap ferme la mesure avant de quitter l'édition ou la configuration.
    window.addEventListener('keydown', toucheMesure, true)
    return () => window.removeEventListener('keydown', toucheMesure, true)
  }, [])

  const entreesMenu: EntreeMenu[] = [
    ...(!modeEdition
      ? []
      : configuration
        ? MENU_CONFIGURATION
        : [{ valeur: 'composer', glyphe: '⌖', libelle: 'Composer un carrefour', raccourci: 'N' }, { type: 'separateur' as const }]),
    { type: 'separateur' },
    ...(mesure && pointMesureMenu !== null
      ? [{ valeur: 'retirer-point', glyphe: '✕', libelle: `Retirer le point ${pointMesureMenu + 1}`, danger: true }]
      : [{ valeur: 'mesurer', glyphe: '↔', libelle: mesure ? 'Nouvelle mesure ici' : 'Mesurer une distance' }]),
    { valeur: 'mesures', glyphe: '☰', libelle: 'Mesures enregistrées' },
    { valeur: 'centrer', glyphe: '✥', libelle: 'Centrer la carte ici' },
    { valeur: 'copier', glyphe: '⎘', libelle: 'Copier les coordonnées' },
  ]
  /** Cadre des points ; la marge réserve la place du panneau ouvert (liste à droite, frise en bas). */
  const centrerSur = (points: LonLat[], panneau: 'liste' | 'edition' = 'edition') => {
    if (points.length === 1) return carte?.flyTo({ center: points[0]! })
    if (points.length < 2) return
    const lons = points.map((p) => p[0])
    const lats = points.map((p) => p[1])
    carte?.fitBounds([Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)], {
      padding:
        panneau === 'liste'
          ? { top: 80, right: 420, bottom: 80, left: 380 }
          : { top: 80, right: 80, bottom: 380, left: 80 },
      maxZoom: 18,
    })
  }
  const choisirMenu = (valeur: string) => {
    if (valeur === 'mesurer' && pointMenu) return mesures.commencer([pointMenu])
    if (valeur === 'retirer-point' && pointMesureMenu !== null) return mesures.retirer(pointMesureMenu)
    if (valeur === 'mesures') return mesures.ouvrirListe()
    if (valeur === 'centrer' && pointMenu) return carte?.flyTo({ center: pointMenu })
    if (valeur === 'copier' && pointMenu) return void navigator.clipboard?.writeText(`${pointMenu[1].toFixed(6)}, ${pointMenu[0].toFixed(6)}`)
    if (valeur === 'composer') return composer()
    panneauConfiguration.current?.executer(valeur as ActionConfiguration)
  }

  // Le plan de feux ouvert repousse les contrôles flottants au-dessus de lui (ou de la bande du
  // diagramme), et à sa gauche quand il est à droite.
  const basCarte = configuration !== null ? (planDeFeux?.bas ?? null) : null
  const panneauDroite = configuration !== null && planDeFeux?.disposition === 'droite'

  return (
    <>
      <MenuContextuel
        point={ecranMenu}
        entete={pointMenu && `${pointMenu[1].toFixed(4)} N · ${pointMenu[0].toFixed(4)} E`}
        entrees={entreesMenu.filter((entree, i, liste) => entree.type !== 'separateur' || (i > 0 && liste[i - 1]!.type !== 'separateur'))}
        onChoisir={choisirMenu}
        onFermer={() => setEcranMenu(null)}
      />
      <Box position="fixed" inset="0" className="carte-plein-ecran">
        <CarteCarrefours
          carrefours={carrefours.data}
          afficherCarrefours={sumo ? false : mode !== 'brut' || brut.carrefours || edition !== null || configuration !== null}
          // SUMO : lecture seule comme le Temps réel, sans fiche de carrefour.
          tempsReel={tempsReel || sumo}
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
          onOuvrir={sumo ? () => {} : tempsReel ? setFicheTempsReel : configurer}
          configuration={
            configuration && {
              carrefourId: configuration.carrefour.id,
              position: configuration.position,
              ...affichageConfiguration,
            }
          }
          onClicFeuConfiguration={(feu, position) => panneauConfiguration.current?.clicFeu(feu, position)}
          onClicCarteConfiguration={(position) => panneauConfiguration.current?.clicCarte(position)}
          onClicCalque={(clic) => panneauConfiguration.current?.clicCalque(clic)}
          onCiblePopup={setCiblePopup}
          onMenuContextuel={(position, point) => {
            setPointMenu(position)
            setEcranMenu(point)
            setPointMesureMenu(mesures.visee)
          }}
          mesure={mesure?.points ?? null}
          mesureVisee={mesures.visee}
          onViserMesure={mesures.setVisee}
          onPointMesure={mesures.ajouter}
          onDeplacerPointMesure={mesures.deplacer}
          onDeplacerPoignee={deplacerPoignee}
          onConnecter={connecter}
          zoneOsm={outilZone}
          onClicZone={
            modeZone === 'choisir' ? setPointZone : modeZone === 'dessiner' ? (point) => setTraceZone((t) => [...t, point]) : undefined
          }
          onTracer={tracer}
          onDessinerZoneIa={dessinerZoneIa}
          onPlacerFeu={placerFeu}
        >
          {mesures.liste && <CoucheMesuresEnregistrees mesures={mesures.enregistrees} survolee={mesures.survolee} />}
          {sumo && <CoucheSumo />}
          {sumo && <CoucheVehicules />}
          {sumo && <CoucheFlux />}
          {pertes && reseauTram.data && historique.data && (
            <CouchePertes reseau={reseauTram.data} historique={historique.data} />
          )}
          {tempsReel && feuxTempsReel.data && <CoucheFeuxTempsReel tempsReel={feuxTempsReel.data} tram={contexteTram} />}
          {busAffiche && reseauBusAffiche && (
            <CoucheTransport transport="bus" reseau={reseauBusAffiche} tempsReel={busCommeTrams} couches={couchesBus} />
          )}
          {tramAffiche && reseauTram.data && (
            <CoucheTransport transport="tram" reseau={reseauTram.data} tempsReel={tramsTempsReel.data} couches={couchesTram} />
          )}
          {outilZone && brouillonZone && (
            <CalqueZoneOsm
              polygones={brouillonZone.polygones}
              importee={zoneOsm.data?.zone_importee?.polygones ?? null}
              mode={modeZone}
              point={pointZone}
              trace={traceZone}
              onFermerTrace={fermerTraceZone}
              onChanger={(polygones) =>
                setBrouillonZone({
                  polygones,
                  source: { contour: brouillonZone.source?.contour ?? null, retouchee: brouillonZone.source !== null },
                  modifie: true,
                })
              }
            />
          )}
        </CarteCarrefours>
      </Box>

      {/* Modes de l'application, toujours visibles en haut au centre. */}
      <BarreOutils.Root position="fixed" left="50%" transform="translateX(-50%)" top="3" zIndex="3" aria-label="Mode de l'application">
        {MODES.map((m) => (
          <BarreOutils.Outil
            key={m.valeur}
            // Libellés plus longs que ceux des outils : sur une ligne, la carte s'élargit.
            w="auto"
            minW="66px"
            px="2.5"
            whiteSpace="nowrap"
            glyphe={m.glyphe}
            libelle={m.libelle}
            actif={mode === m.valeur}
            onClick={() => changerMode(m.valeur)}
          />
        ))}
      </BarreOutils.Root>

      <PanneauMesure
        position="fixed"
        left="50%"
        transform="translateX(-50%)"
        // Au-dessus de la barre d'outils centrale et de sa bulle d'aide, quand elles sont affichées.
        bottom={
          modeEdition && !configuration
            ? `calc(${BAS_BARRE_OUTILS} + ${HAUTEUR_BARRE_OUTILS} * ${edition || outilZone ? 2 : 1})`
            : BAS_BARRE_OUTILS
        }
        zIndex="3"
        mesures={mesures}
        onCentrer={centrerSur}
      />

      {configuration ? (
        <ConfigurationCarrefour
          key={configuration.carrefour.id}
          ref={panneauConfiguration}
          carrefour={carrefourOuvert ?? configuration.carrefour}
          position={configuration.position}
          ciblePopup={ciblePopup}
          onAffichage={setAffichageConfiguration}
          onPlacerFeu={placerFeu}
          ouvrirAnalyseIa={configuration.ouvrirAnalyseIa ?? null}
          onPanneau={setPlanDeFeux}
          onModifierFeux={() => {
            setConfiguration(null)
            modifier(configuration.carrefour)
          }}
          onSupprimer={() => confirmerSuppression(configuration.carrefour)}
          onFermer={() => setConfiguration(null)}
        />
      ) : sumo ? (
        <ModeSumo />
      ) : tempsReel ? (
        <CarteEnTete
          position="fixed"
          top="3"
          left="3"
          zIndex="2"
          w={ficheTempsReel ? '400px' : '340px'}
          maxW="calc(var(--ecran-w) - 24px)"
          surtitre={ficheTempsReel ? 'Temps réel' : 'Besançon Voirie'}
          titre={ficheTempsReel ? ficheTempsReel.carrefour.nom : 'Feux et trams en temps réel'}
          badges={
            <>
              {sante.isError && <Badge colorPalette="red">API injoignable</Badge>}
              {!ficheTempsReel && feuxTempsReel.data && (
                <Badge colorPalette="gray">{feuxTempsReel.data.carrefours.length} carrefour(s) programmé(s) dans la vue</Badge>
              )}
              {ficheTempsReel && (
                <>
                  <Button asChild size="2xs" variant="outline" ms="auto" title="Relever ce carrefour sur place : cycle, verts, déclenchements">
                    <Link to={`/terrain/${ficheTempsReel.carrefour.id}`}>
                      <IconeFeu /> Relever
                    </Link>
                  </Button>
                  <Button size="2xs" variant="ghost" onClick={() => setFicheTempsReel(null)}>
                    Fermer
                  </Button>
                </>
              )}
            </>
          }
        >
          <Box mt="3" pt="3" borderTopWidth="1px" borderColor="border.muted" maxH="calc(var(--ecran-h) - 150px)" overflowY="auto">
            {ficheTempsReel ? (
              <FicheCarrefour
                key={ficheTempsReel.carrefour.slug}
                slug={ficheTempsReel.carrefour.slug}
                maintenant={<FicheTempsReel carrefour={carrefourTempsReel} tram={contexteTram} />}
              />
            ) : (
              <Aide>
                Les feux des carrefours programmés sont rejoués sur l'heure légale, calés par des tops relevés sur place.
                Cliquer sur un carrefour pour voir son cycle.
              </Aide>
            )}
          </Box>
        </CarteEnTete>
      ) : (
        <>
          <CarteEnTete
            position="fixed"
            top="3"
            left="3"
            zIndex="2"
            w="340px"
            maxW="calc(var(--ecran-w) - 24px)"
            surtitre="Besançon Voirie"
            titre={
              outilZone
                ? "Zone d'import OSM"
                : edition
                  ? edition.carrefourId
                    ? 'Modifier le carrefour'
                    : 'Composer un carrefour'
                  : 'Inventaire citoyen des feux tricolores'
            }
            badges={
              <>
                {sante.isSuccess && <Badge colorPalette="green">API connectée</Badge>}
                {sante.isError && <Badge colorPalette="red">API injoignable</Badge>}
                {carrefours.data && <Badge colorPalette="gray">{carrefours.data.features.length} carrefour(s) dans la vue</Badge>}
                {feuxLibres !== undefined && feuxLibres > 0 && <Badge colorPalette="orange">{feuxLibres} feu(x) à regrouper</Badge>}
              </>
            }
          >
            {outilZone && brouillonZone && (
              <Box mt="3" pt="3" borderTopWidth="1px" borderColor="border.muted" maxH="calc(var(--ecran-h) - 200px)" overflowY="auto">
                <PanneauZoneOsm
                  zone={zoneOsm.data}
                  brouillon={brouillonZone}
                  onBrouillon={setBrouillonZone}
                  mode={modeZone}
                  onMode={changerModeZone}
                  point={pointZone}
                  trace={traceZone}
                  onFermerTrace={fermerTraceZone}
                />
              </Box>
            )}
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

          {edition && (
            <BandeauMode
              position="fixed"
              // Au-dessus de la barre d'outils du bas.
              bottom={`calc(${BAS_BARRE_OUTILS} + ${HAUTEUR_BARRE_OUTILS})`}
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

          {outilZone && (
            <BandeauMode
              position="fixed"
              // Au-dessus de la barre d'outils du bas.
              bottom={`calc(${BAS_BARRE_OUTILS} + ${HAUTEUR_BARRE_OUTILS})`}
              left="50%"
              transform="translateX(-50%)"
              zIndex="2"
              titre={modeZone === 'choisir' ? 'Choisir un contour' : modeZone === 'dessiner' ? 'Dessiner la zone' : "Zone d'import OSM"}
              aides={[
                modeZone === 'choisir'
                  ? 'Clic sur la carte : contours qui contiennent ce point'
                  : modeZone === 'dessiner'
                    ? 'Clic : poser un sommet ; clic sur le premier ou Entrée : fermer'
                    : 'Glisser les sommets ; « + » pour en ajouter',
                <Kbd key="echap" variant="inverse">
                  Échap
                </Kbd>,
              ]}
            />
          )}

          {modeEdition && <BarreOutils.Root position="fixed" left="50%" transform="translateX(-50%)" bottom={BAS_BARRE_OUTILS} zIndex="3">
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
                <BarreOutils.Outil glyphe="↖" libelle="Sélection" raccourci="V" actif={!outilZone} onClick={() => setOutilZone(false)} />
                <BarreOutils.Outil glyphe="⌖" libelle="Carrefour" raccourci="N" onClick={composer} />
                <BarreOutils.Separateur />
                <BarreOutils.Outil
                  glyphe="⬚"
                  libelle="Zone OSM"
                  title="Zone d'import des feux depuis OSM"
                  actif={outilZone}
                  onClick={() => (outilZone ? setOutilZone(false) : ouvrirZone())}
                />
              </>
            )}
          </BarreOutils.Root>}
        </>
      )}

      {!tempsReel && !sumo && <CarteSuivi
        position="fixed"
        // À gauche des contrôles de la carte (36 px à 16 px du bord).
        right={panneauDroite ? `calc(${largeurPanneau} + 64px)` : '64px'}
        bottom={basCarte ? `calc(${basCarte} + 12px)` : '3'}
        zIndex="2"
        brouillons={brouillons}
        ouvert={configuration?.carrefour.id ?? null}
        onReprendre={reprendre}
        analyses={analysesIa.data ?? []}
        onOuvrirAnalyse={ouvrirAnalyseIa}
      />}

      {/* Menu du site en haut à droite. */}
      <MenuSite position="fixed" top="4" right={panneauDroite ? `calc(${largeurPanneau} + 16px)` : '4'} zIndex="3" />
      <PagesSite />

      {/* Contrôles en bas à droite : zoom (plus « nord » quand la carte est tournée), puis les
          panneaux. Au-dessus du plan de feux posé en bas (ou de sa bande), à sa gauche quand il est à droite. */}
      <Stack
        position="fixed"
        bottom={basCarte ? `calc(${basCarte} + 16px)` : '4'}
        right={panneauDroite ? `calc(${largeurPanneau} + 16px)` : '4'}
        zIndex="2"
        gap="3"
        align="flex-end"
      >
        <ControleZoom />
        <Popover.Root positioning={{ placement: 'left-end', gutter: 10 }}>
          <Popover.Trigger asChild>
            <BoutonCarte libelle="Fond de carte et calques">
              <MapIcon />
            </BoutonCarte>
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
                    {tempsReel && (
                      <Stack gap="1.5">
                        <Text textStyle="xs" fontWeight="semibold">
                          Feux
                        </Text>
                        <HStack as="ul" rowGap="1" columnGap="2.5" wrap="wrap" listStyleType="none" textStyle="xs">
                          {Object.values(FIABILITES).map((f) => (
                            <HStack as="li" key={f.libelle} gap="1" title={f.aide}>
                              <Badge size="xs" colorPalette={f.couleur}>
                                {f.libelle}
                              </Badge>
                            </HStack>
                          ))}
                        </HStack>
                        <Aide>Cycle calé sur l'heure légale (base de temps à 3 h), d'après les tops relevés au carrefour.</Aide>
                      </Stack>
                    )}
                    {sumo ? (
                      <Aide>Essais, indicateurs et lecture : dans les cartes du mode SUMO.</Aide>
                    ) : mode !== 'brut' ? (
                      <Stack gap="2.5">
                        <Bascule coche={trams} onChange={setTrams}>
                          Trams en temps réel
                        </Bascule>
                        {trams && enLigne !== undefined && (
                          <Aide>{enLigne} rame(s) en ligne · position estimée d'après les temps d'attente Ginko</Aide>
                        )}
                        <Bascule coche={bus} onChange={setBus}>
                          Bus en temps réel
                        </Bascule>
                        {bus && (
                          <Stack gap="1" ps="11">
                            {busEnLigne !== undefined && <Aide>{busEnLigne} bus en ligne sur les lignes choisies</Aide>}
                            {choixLignes}
                          </Stack>
                        )}
                      </Stack>
                    ) : (
                      <Aide>Couches : dans le panneau ⊞ Données brutes, à droite.</Aide>
                    )}

                    {(reseauTram.isError || tramsTempsReel.isError) && (
                      <Message ton="erreur">
                        Trams indisponibles : {(reseauTram.error ?? tramsTempsReel.error)?.message}
                      </Message>
                    )}
                    {mode !== 'brut' && (reseauBus.isError || busTempsReel.isError) && (
                      <Message ton="erreur">Bus indisponibles : {(reseauBus.error ?? busTempsReel.error)?.message}</Message>
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
                      <Bascule coche={fond.affichage3d} onChange={(affichage3d) => setFond((options) => ({ ...options, affichage3d }))}>
                        Affichage 3D (gourmand)
                      </Bascule>
                      {fond.affichage3d && (
                        <Stack gap="2" ps="6">
                          <Bascule
                            size="sm"
                            coche={fond.batiments3d}
                            disabled={!fond.batiments}
                            onChange={(batiments3d) => setFond((options) => ({ ...options, batiments3d }))}
                          >
                            Bâtiments en volume
                          </Bascule>
                          <Bascule
                            size="sm"
                            coche={fond.elevation}
                            onChange={(elevation) => setFond((options) => ({ ...options, elevation }))}
                          >
                            Relief du terrain
                          </Bascule>
                          <Bascule size="sm" coche={fond.soleil} onChange={(soleil) => setFond((options) => ({ ...options, soleil }))}>
                            Soleil et luminosité
                          </Bascule>
                          {fond.soleil && <ReglageHeure heure={fond.heure} onChange={(heure) => setFond((options) => ({ ...options, heure }))} />}
                        </Stack>
                      )}
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
        <PanneauOutil
          ouvert={mesures.liste}
          bouton={
            <BoutonCarte
              libelle="Mesures de distance"
              actif={mesures.liste}
              onClick={mesures.liste ? mesures.fermerListe : mesures.ouvrirListe}
            >
              <Ruler />
            </BoutonCarte>
          }
        >
          <ListeMesures mesures={mesures} onCentrer={centrerSur} />
        </PanneauOutil>
        {mode === 'brut' && (
          <PanneauOutil
            ouvert={brutOuvert}
            bouton={
              <BoutonCarte
                libelle="Couches des données brutes"
                actif={brutOuvert}
                onClick={() => {
                  if (brutOuvert) return setPanneauBrut(false)
                  mesures.fermerListe()
                  setPanneauBrut(true)
                }}
              >
                <Layers />
              </BoutonCarte>
            }
          >
              <CarteEnTete
                w="320px"
                maxW="calc(var(--ecran-w) - 24px)"
                maxH="calc(var(--ecran-h) - 32px)"
                surtitre="Données brutes"
                titre={
                  <HStack gap="1.5">
                    <Text>Couches</Text>
                    <Button size="2xs" variant="ghost" ms="auto" onClick={() => setPanneauBrut(false)}>
                      Fermer
                    </Button>
                  </HStack>
                }
              >
                <Box mt="2" minH="0" overflowY="auto">
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
                        Historique tram : {etatHistorique.data.passages.toLocaleString('fr-FR')} passage(s)
                        {etatHistorique.data.premier &&
                          ` depuis le ${new Date(etatHistorique.data.premier).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}`}
                        {!etatHistorique.data.collecteActive && ' · collecte arrêtée (TRAM_COLLECTE)'}
                      </Aide>
                    )}
                    <Bascule coche={brut.busLignes} onChange={basculer('busLignes')}>
                      Bus : lignes (GTFS)
                    </Bascule>
                    <Bascule coche={brut.busArrets} onChange={basculer('busArrets')}>
                      Bus : arrêts
                    </Bascule>
                    <Bascule coche={brut.busRames} onChange={basculer('busRames')}>
                      Bus : véhicules, position estimée{busEnLigne !== undefined && ` (${busEnLigne} en ligne)`}
                    </Bascule>
                    <Bascule coche={brut.busZones} onChange={basculer('busZones')}>
                      Bus : zones probables
                    </Bascule>
                    {busAffiche && (
                      <Stack gap="1" ps="11">
                        {choixLignes}
                      </Stack>
                    )}
                    {etatHistoriqueBus.data && (
                      <Aide>
                        Historique bus : {etatHistoriqueBus.data.passages.toLocaleString('fr-FR')} passage(s)
                        {etatHistoriqueBus.data.premier &&
                          ` depuis le ${new Date(etatHistoriqueBus.data.premier).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}`}
                        {!etatHistoriqueBus.data.collecteActive && ' · collecte arrêtée (BUS_COLLECTE)'}
                        {' · tronçons regroupés par couple d’arrêts, toutes lignes confondues'}
                      </Aide>
                    )}
                    {reseauBus.isError || busTempsReel.isError ? (
                      <Message ton="erreur">Bus indisponibles : {(reseauBus.error ?? busTempsReel.error)?.message}</Message>
                    ) : null}
                  </Stack>
                </Box>
              </CarteEnTete>
          </PanneauOutil>
        )}
      </Stack>
    </>
  )
}

export default App
