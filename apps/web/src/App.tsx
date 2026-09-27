import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { LonLat } from '@voirie/engine'
import type { AnalyseIa, Bbox, CarrefourResume, FeuResume, TypeJour } from '@voirie/schema'
import { Badge, Box, Button, HStack, IconButton, Kbd, Popover, Portal, Stack, Tabs, Text } from '@chakra-ui/react'
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { useMap } from 'react-map-gl/maplibre'
import { api } from './api'
import { abandonnerBrouillons, useBrouillons, type BrouillonsCarrefour } from './configuration/brouillons'
import { CarteSuivi } from './configuration/CarteSuivi'
import { MENU_CONFIGURATION, MENU_GRAPHE, type ActionConfiguration } from './configuration/actions'
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
import { CoucheFeuxTempsReel } from './map/CoucheFeuxTempsReel'
import { CoucheTrams, type CouchesTram } from './map/CoucheTrams'
import type { OptionsFond } from './map/FondDeCarte'
import { usePreference } from './preferences'
import { FicheTempsReel } from './tempsReel/FicheTempsReel'
import { FIABILITES } from './tempsReel/libelles'
import { carrefoursSurLeTrace, type ContexteTram } from './tempsReel/priorite'
import { preparerReseau } from './tram/positionsTrams'
import { PALIERS_PERTE } from './tram/pertes'
import { couchesInteractivesVoies, type OutilVoies } from './reseau/couchesVoies'
import { CoucheVoies } from './reseau/CoucheVoies'
import { CoucheReseau } from './reseau/CoucheReseau'
import { EnTeteReseau } from './reseau/EnTeteReseau'
import { useModeReseau, ZOOM_VOIES } from './reseau/modeReseau'
import { PopupNoeud } from './reseau/PopupNoeud'
import { PopupTroncon } from './reseau/PopupTroncon'

/** Le flux Ginko est mis en cache 10 s par l'API. */
const RAFRAICHISSEMENT_TRAMS_MS = 15_000

/** Les tops ajoutés en édition changent les décalages : relus de temps en temps. */
const RAFRAICHISSEMENT_FEUX_MS = 60_000

/**
 * « Temps réel » : la vue grand public, feux et trams à l'heure réelle, en lecture seule.
 * « Édition » : composition et configuration des carrefours. « Données brutes » : toutes les
 * couches, une par une.
 */
type Mode = 'temps_reel' | 'edition' | 'brut'

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
  const [zoom, setZoom] = useState(0)
  // Stable : la carte relit l'emprise à chaque changement de ce rappel.
  const changerEmprise = useCallback((emprise: Bbox, niveau: number) => {
    setBbox(emprise)
    setZoom(niveau)
  }, [])
  /** Éditeur des voies ouvert sans carrefour (outil Voies) ; avec un carrefour ouvert, on y est aussi. */
  const [modeReseau, setModeReseau] = useState(false)
  const [mode, setMode] = usePreference<Mode>('mode-carte', 'temps_reel')
  const tempsReel = mode === 'temps_reel'
  const [fond, setFond] = usePreference<OptionsFond>('fond', FOND_DEFAUT)
  const [trams, setTrams] = usePreference<boolean>('trams', true)
  const [brut, setBrut] = usePreference<CouchesBrutes>('couches-brutes', COUCHES_BRUTES_DEFAUT)
  const [creneau, setCreneau] = useState<{ typeJour: TypeJour; heure: number | null }>(() => ({
    typeJour: typeJour(new Date()),
    heure: new Date().getHours(),
  }))
  const [edition, setEdition] = useState<Edition | null>(null)
  const [configuration, setConfiguration] = useState<(CarrefourChoisi & {
    /** Proposition IA à charger à l'ouverture (« Ouvrir » d'une notification). */
    ouvrirAnalyseIa?: { id: string }
  }) | null>(null)
  const [panneauBasOuvert, setPanneauBasOuvert] = useState(false)
  /** Carrefour dont la fiche temps réel est ouverte. */
  const [ficheTempsReel, setFicheTempsReel] = useState<CarrefourChoisi | null>(null)
  const brouillons = useBrouillons()
  const [affichageConfiguration, setAffichageConfiguration] = useState<AffichageConfiguration>({
    graphe: false,
    outilGraphe: null,
    branches: [],
    connexions: [],
    anneau: null,
    mode: null,
    feuxSurlignes: [],
    connexionsSurlignees: [],
    feux: null,
    choixFeux: false,
    selection: null,
    ancre: null,
    cadreIa: null,
  })
  // Éditeur des voies : seul (outil Voies), ou dans un carrefour ouvert bâti sur le réseau.
  const carrefourGraphe = configuration && affichageConfiguration.graphe ? configuration.carrefour : null
  const editeur = (modeReseau && configuration === null) || carrefourGraphe !== null
  const reseau = useModeReseau({
    actif: editeur,
    bbox,
    zoom,
    carrefourOuvert: carrefourGraphe && { id: carrefourGraphe.id, nom: carrefourGraphe.nom },
    nomCarrefour: (id) => carrefours.data?.features.find((f) => f.id === id)?.properties.nom ?? 'un autre carrefour',
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
  const outilEditeur: OutilVoies | null = !editeur ? null : configuration ? affichageConfiguration.outilGraphe : reseau.outil
  /** Rues voie par voie : à l'approche du zoom des voies, où le réseau par tronçons s'efface. */
  const voiesDessinees = editeur && zoom >= ZOOM_VOIES - 0.5
  const dessinerZoneIa = useCallback<ConfigurationCarrefourHandle['dessinerZoneIa']>(
    (emprise) => panneauConfiguration.current?.dessinerZoneIa(emprise),
    [],
  )


  const couchesTram: CouchesTram =
    mode === 'brut' ? brut : { lignes: trams, arrets: trams, zones: trams, rames: trams }
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
  const feuxTempsReel = useQuery({
    queryKey: ['feux-temps-reel', bbox],
    queryFn: () => api.feuxTempsReel(bbox!),
    enabled: tempsReel && bbox !== undefined,
    refetchInterval: RAFRAICHISSEMENT_FEUX_MS,
    placeholderData: (precedent) => precedent,
  })
  const carrefoursRejoues = useMemo(() => feuxTempsReel.data?.carrefours.map((c) => c.id), [feuxTempsReel.data])
  const carrefourTempsReel = ficheTempsReel
    ? (feuxTempsReel.data?.carrefours.find((c) => c.id === ficheTempsReel.carrefour.id) ?? null)
    : null

  /** Le mode Temps réel est en lecture seule : on quitte l'édition en cours (les brouillons restent). */
  const changerMode = (suivant: Mode) => {
    setMode(suivant)
    if (suivant === 'temps_reel') {
      setEdition(null)
      setConfiguration(null)
    } else setFicheTempsReel(null)
  }

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

  // Le résumé suit les données à jour du carrefour ouvert (nombre de feux après une modification…).
  const carrefourOuvert = configuration
    ? (carrefours.data?.features.find((f) => f.id === configuration.carrefour.id)?.properties ?? configuration.carrefour)
    : null

  /** Un clic sur un carrefour l'ouvre en édition, à la place de celui qui l'était. */
  const configurer = (choix: CarrefourChoisi) => {
    setEdition(null)
    setConfiguration(choix)
  }
  const reprendre = (b: BrouillonsCarrefour) => configurer({ carrefour: b.carrefour, position: b.position })
  /** Ouvre un carrefour de la carte d'après son identifiant (depuis la popup d'un nœud). */
  const configurerCarrefour = (id: string) => {
    const objet = carrefours.data?.features.find((f) => f.id === id)
    if (objet) configurer({ carrefour: objet.properties, position: objet.geometry.coordinates as [number, number] })
  }

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

  const composer = () => {
    setModeReseau(false)
    demarrer({ carrefourId: null, selection: [], nature: 'carrefour', nomSaisi: null, modeRectangle: true })
  }

  // Raccourcis hors configuration (la configuration gère les siens).
  const touche = useEffectEvent((e: KeyboardEvent) => {
    if (tempsReel || configuration || e.ctrlKey || e.metaKey || e.altKey) return
    if (e.target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return
    const lettre = e.key.toLowerCase()
    if (modeReseau) {
      if (!reseau.clavier(e) && e.key === 'Escape') setModeReseau(false)
      if (e.key === 'Backspace' || e.key === 'Enter') e.preventDefault()
      return
    }
    if (!edition) {
      if (lettre === 'r') return setModeReseau(true)
      return lettre === 'n' && composer()
    }
    if (e.key === 'Escape') return setEdition(null)
    if (lettre === 'r' || lettre === 'v') setEdition({ ...edition, modeRectangle: lettre === 'r' })
  })
  useEffect(() => {
    window.addEventListener('keydown', touche)
    return () => window.removeEventListener('keydown', touche)
  }, [])
  // Rue en cours de tracé, même carrefour ouvert : Entrée la finit, ⌫ retire un point, Échap l'annule,
  // avant les raccourcis de la configuration (écoute en phase de capture).
  const toucheTrace = useEffectEvent((e: KeyboardEvent) => {
    if (reseau.trace.length === 0 || !['Enter', 'Backspace', 'Escape'].includes(e.key)) return
    if (e.target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return
    reseau.clavier(e)
    e.preventDefault()
    e.stopImmediatePropagation()
  })
  useEffect(() => {
    window.addEventListener('keydown', toucheTrace, { capture: true })
    return () => window.removeEventListener('keydown', toucheTrace, { capture: true })
  }, [])

  const entreesMenu: EntreeMenu[] = [
    ...(tempsReel
      ? []
      : configuration
        ? affichageConfiguration.graphe
          ? MENU_GRAPHE
          : MENU_CONFIGURATION
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
            // Temps réel : seuls les feux ; un clic sur l'un d'eux ouvre la fiche de son carrefour.
            afficherCarrefours={mode === 'edition' || (mode === 'brut' && brut.carrefours) || edition !== null || configuration !== null}
            tempsReel={tempsReel}
            carrefoursRejoues={carrefoursRejoues}
            // Éditeur des voies : on cale nœuds et voies sur la photo IGN, vue de dessus.
            fond={editeur ? { ...fond, fond: 'satellite', relief3d: false } : fond}
            feux={feux.data}
            edition={
              edition && {
                selection: edition.selection,
                carrefourId: edition.carrefourId,
                modeRectangle: edition.modeRectangle,
              }
            }
            onEmprise={changerEmprise}
            reseauActif={modeReseau && !configuration}
            curseur={outilEditeur === 'tracer' || outilEditeur === 'couper' ? 'crosshair' : undefined}
            couchesReseau={voiesDessinees ? couchesInteractivesVoies(outilEditeur) : undefined}
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
            onOuvrir={tempsReel ? setFicheTempsReel : configurer}
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
            onMenuContextuel={setPointMenu}
            onDeplacerPoignee={deplacerPoignee}
            onConnecter={connecter}
            onDessinerZoneIa={dessinerZoneIa}
            onPlacerFeu={placerFeu}
          >
            {pertes && reseauTram.data && historique.data && (
              <CouchePertes reseau={reseauTram.data} historique={historique.data} />
            )}
            {tempsReel && feuxTempsReel.data && <CoucheFeuxTempsReel tempsReel={feuxTempsReel.data} tram={contexteTram} />}
            {tramAffiche && reseauTram.data && (
              <CoucheTrams reseau={reseauTram.data} tempsReel={tramsTempsReel.data} couches={couchesTram} />
            )}
            {voiesDessinees && reseau.donnees.data && (
              <CoucheVoies
                reseau={reseau.donnees.data}
                outil={outilEditeur}
                selection={reseau.selection}
                carrefourOuvert={carrefourGraphe?.id ?? null}
                onDeplacerNoeud={(id, position) => reseau.modifierNoeud(id, { position })}
                onBasculerLiaison={reseau.basculerLiaison}
              />
            )}
            {editeur && (
              <CoucheReseau
                donnees={reseau.visible ? reseau.donnees.data : undefined}
                outil={outilEditeur === 'tracer' ? 'tracer' : 'selection'}
                selection={reseau.selection?.id ?? null}
                trace={reseau.trace}
                onClic={(position, cible, memePoint) => reseau.clic(position, cible, memePoint, outilEditeur ?? 'autre')}
                popup={
                  outilEditeur !== 'selection' || !reseau.selection
                    ? null
                    : reseau.troncon
                      ? {
                          position: reseau.selection.position,
                          contenu: (
                            <PopupTroncon
                              key={reseau.troncon.id}
                              troncon={reseau.troncon}
                              enregistrement={{ enCours: reseau.modification.isPending, erreur: reseau.modification.error?.message ?? null }}
                              onModifier={reseau.modifier}
                              onSupprimer={reseau.supprimer}
                              onCouper={() => {
                                reseau.couper(reseau.troncon!.id, reseau.selection!.position)
                                reseau.fermerSelection()
                              }}
                              onFermer={reseau.fermerSelection}
                            />
                          ),
                        }
                      : reseau.noeud
                        ? {
                            position: reseau.selection.position,
                            contenu: (
                              <PopupNoeud
                                key={reseau.noeud.id}
                                noeud={reseau.noeud}
                                carrefourOuvert={carrefourGraphe && { id: carrefourGraphe.id, nom: carrefourGraphe.nom }}
                                nomCarrefour={(id) => carrefours.data?.features.find((f) => f.id === id)?.properties.nom ?? 'carrefour'}
                                enregistrement={{ enCours: reseau.modificationNoeud.isPending, erreur: reseau.modificationNoeud.error?.message ?? null }}
                                onModifier={(m) => reseau.modifierNoeud(reseau.noeud!.id, m)}
                                onLiaisonsParDefaut={() => reseau.liaisonsParDefaut(reseau.noeud!.id)}
                                onFusionner={() => reseau.fusionner(reseau.noeud!.id)}
                                onOuvrirCarrefour={configurerCarrefour}
                                onFermer={reseau.fermerSelection}
                              />
                            ),
                          }
                        : null
                }
              />
            )}
          </CarteCarrefours>
        </Box>
      </MenuContextuel>

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
          onPanneauBas={setPanneauBasOuvert}
          onModifierFeux={() => {
            setConfiguration(null)
            setModeReseau(false)
            modifier(configuration.carrefour)
          }}
          onSupprimer={() => confirmerSuppression(configuration.carrefour)}
          onFermer={() => setConfiguration(null)}
          onEchapVoies={reseau.echap}
        />
      ) : tempsReel ? (
        <CarteEnTete
          position="fixed"
          top="3"
          left="3"
          zIndex="2"
          w="340px"
          maxW="calc(100vw - 24px)"
          surtitre={ficheTempsReel ? 'Temps réel' : 'Besançon Voirie'}
          titre={ficheTempsReel ? ficheTempsReel.carrefour.nom : 'Feux et trams en temps réel'}
          badges={
            <>
              {sante.isError && <Badge colorPalette="red">API injoignable</Badge>}
              {!ficheTempsReel && feuxTempsReel.data && (
                <Badge colorPalette="gray">{feuxTempsReel.data.carrefours.length} carrefour(s) programmé(s) dans la vue</Badge>
              )}
              {ficheTempsReel && (
                <Button size="2xs" variant="ghost" ms="auto" onClick={() => setFicheTempsReel(null)}>
                  Fermer
                </Button>
              )}
            </>
          }
        >
          <Box mt="3" pt="3" borderTopWidth="1px" borderColor="border.muted">
            {ficheTempsReel ? (
              <FicheTempsReel carrefour={carrefourTempsReel} tram={contexteTram} />
            ) : (
              <Aide>
                Les feux des carrefours programmés sont rejoués sur l'heure légale, calés par des tops relevés sur place ;
                les autres restent en gris. Cliquer sur un feu pour voir le cycle de son carrefour.
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
            maxW="calc(100vw - 24px)"
            surtitre="Besançon Voirie"
            titre={
              edition
                ? edition.carrefourId
                  ? 'Modifier le carrefour'
                  : 'Composer un carrefour'
                : modeReseau
                  ? 'Édition des voies'
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
            {modeReseau && !edition && (
              <EnTeteReseau
                outil={reseau.outil}
                visible={reseau.visible}
                nbTroncons={reseau.donnees.data?.troncons.features.length}
                tronque={reseau.donnees.data?.tronque ?? false}
                bbox={bbox}
                generation={{ enCours: reseau.generation.isPending, onGenerer: (reinitialiser) => reseau.generation.mutate(reinitialiser) }}
              />
            )}
          </CarteEnTete>

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
            ) : modeReseau ? (
              <>
                <BarreOutils.Outil
                  glyphe="↖"
                  libelle="Sélection"
                  raccourci="V"
                  actif={reseau.outil === 'selection'}
                  onClick={() => reseau.choisirOutil('selection')}
                />
                <BarreOutils.Outil
                  glyphe="＋"
                  libelle="Tracer"
                  raccourci="T"
                  actif={reseau.outil === 'tracer'}
                  onClick={() => reseau.choisirOutil('tracer')}
                />
                <BarreOutils.Outil
                  glyphe="✂"
                  libelle="Couper"
                  raccourci="X"
                  actif={reseau.outil === 'couper'}
                  onClick={() => reseau.choisirOutil('couper')}
                />
                <BarreOutils.Outil
                  glyphe="↝"
                  libelle="Liaison"
                  raccourci="C"
                  actif={reseau.outil === 'connecter'}
                  onClick={() => reseau.choisirOutil('connecter')}
                />
                <BarreOutils.Separateur />
                <BarreOutils.Outil glyphe="×" libelle="Quitter" raccourci="Échap" onClick={() => setModeReseau(false)} />
              </>
            ) : (
              <>
                <BarreOutils.Outil glyphe="↖" libelle="Sélection" raccourci="V" actif />
                <BarreOutils.Outil glyphe="⌖" libelle="Carrefour" raccourci="N" onClick={composer} />
                <BarreOutils.Outil glyphe="≡" libelle="Voies" raccourci="R" onClick={() => setModeReseau(true)} />
              </>
            )}
          </BarreOutils.Root>
        </>
      )}

      {!tempsReel && <CarteSuivi
        position="fixed"
        right="3"
        bottom={configuration && panneauBasOuvert ? `calc(${hauteurPanneau} + 12px)` : '3'}
        zIndex="2"
        brouillons={brouillons}
        ouvert={configuration?.carrefour.id ?? null}
        onReprendre={reprendre}
        analyses={analysesIa.data ?? []}
        onOuvrirAnalyse={ouvrirAnalyseIa}
      />}

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
                  <Tabs.Root value={mode} onValueChange={(e) => changerMode(e.value as Mode)}>
                    <Tabs.List>
                      <Tabs.Trigger value="temps_reel">Temps réel</Tabs.Trigger>
                      <Tabs.Trigger value="edition">Édition</Tabs.Trigger>
                      <Tabs.Trigger value="brut">Données brutes</Tabs.Trigger>
                    </Tabs.List>
                  </Tabs.Root>
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
                  {mode !== 'brut' ? (
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
