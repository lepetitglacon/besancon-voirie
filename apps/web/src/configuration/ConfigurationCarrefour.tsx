import { Badge, Box, Button, IconButton, Kbd, Stack, Tabs } from '@chakra-ui/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  calculerProgramme,
  cleVoie,
  contexteProgramme,
  degagementsRetenus,
  etatLigne,
  simulerGraphe,
  validerGraphe,
  type LonLat,
} from '@voirie/engine'
import type {
  Branche,
  BranchesCarrefour,
  CarrefourResume,
  Connexion,
  FeuResume,
  PlanSaisi,
} from '@voirie/schema'
import { useEffect, useEffectEvent, useImperativeHandle, useMemo, useState, type Ref } from 'react'
import { createPortal } from 'react-dom'
import { useMap } from 'react-map-gl/maplibre'
import { api } from '../api'
import { Aide, BandeauMode, BarreOutils, CarteEnTete, Indice, Message, PanneauBas, Valeur, type EtatLampe } from '../ds'
import type { ClicCalque, ModeEdition } from './calque/CalqueCarrefour'
import type { EtatFeu } from './calque/elements'
import { basculerConnexion, basculerTraversee, deplacerPoignee, voiesDe, type Brouillon, type Poignee } from './modele'
import { OngletGraphe, type Scenario } from './OngletGraphe'
import { OngletLignes, type BrouillonLignes } from './OngletLignes'
import { OngletProgramme } from './OngletProgramme'
import { OUTILS, RACCOURCIS, type ActionConfiguration, type OutilCarte } from './actions'
import { PopupBranche, PopupCarrefour, PopupFeu, PopupLiaison, PopupVoie } from './PopupsConfiguration'
import { feuxDesLignes, geometrieEnregistree, lignesPourMoteur, plansSaisis } from './programme'

/** Références stables : un `[]` littéral relancerait les effets de synchronisation à chaque rendu. */
const AUCUNE_BRANCHE: Branche[] = []
const AUCUNE_CONNEXION: Connexion[] = []
const AUCUN_FEU: string[] = []
const AUCUNE_LIGNE: never[] = []

/** Ce qui s'enregistre : sans les champs déduits (sens des branches). */
const pourEnregistrer = (brouillon: Brouillon) => ({
  branches: brouillon.branches.map((b) => {
    const { sens: _sens, ...branche } = b as Branche & { sens?: unknown }
    return branche
  }),
  connexions: brouillon.connexions,
})

/** Ce que la carte doit dessiner pendant la configuration. */
export interface AffichageConfiguration {
  branches: Branche[]
  connexions: Connexion[]
  /** Outil actif sur le calque ; null : dessin seul. */
  mode: ModeEdition | null
  feuxSurlignes: string[]
  /** Connexions de la ligne de feux active (« de>vers »), mises en avant sur la carte. */
  connexionsSurlignees: string[]
  /** Lecture du programme : couleur du feu de chaque connexion et passage piéton. */
  feux: { connexions: ReadonlyMap<string, EtatFeu>; traversees: ReadonlyMap<string, EtatFeu> } | null
  /** Élément dont la popup est ouverte (clé de voie, « de>vers » ou code de branche). */
  selection: string | null
  /** Où ancrer la popup ouverte ; null : aucune popup. */
  ancre: LonLat | null
}

/** Onglets du panneau bas « Plan de feux ». */
type Onglet = 'lignes' | 'programme' | 'graphe'

type Popup =
  | { type: 'voie'; cle: string; position: LonLat }
  | { type: 'connexion'; de: string; vers: string; position: LonLat }
  | { type: 'branche'; code: string; position: LonLat }
  | { type: 'feu'; feu: FeuResume; position: LonLat }
  | { type: 'carrefour'; position: LonLat }

const CONSIGNES: Partial<Record<OutilCarte, { titre: string; aides: string[] }>> = {
  ajuster: { titre: 'Caler les voies', aides: ['Glisser les extrémités des voies et des passages sur le marquage de la photo'] },
  connecter: { titre: 'Relier les voies', aides: ['Glisser d’une voie entrante vers une voie sortante', 'Clic sur une liaison : la retirer'] },
  feux: { titre: 'Poser les feux', aides: ['Glisser chaque feu jusqu’à son mât', 'Clic sur le point creux : position OSM'] },
  pieton: { titre: 'Passages piétons', aides: ['Clic sur une voie ou un code de branche : ajouter ou retirer son passage'] },
}

/** Hauteur du panneau bas « Plan de feux », en % de la fenêtre. */
const HAUTEUR_PANNEAU_VH = 44
const hauteurPanneau = `${HAUTEUR_PANNEAU_VH}vh`

const LAMPES: Record<EtatFeu, EtatLampe | null> = { vert: 'vert', jaune: 'orange', rouge: 'rouge', libre: null }

/** Ce que le parent relaie depuis la carte et le menu contextuel. */
export interface ConfigurationCarrefourHandle {
  clicFeu: (feu: FeuResume, position: LonLat) => void
  clicCalque: (clic: ClicCalque) => void
  clicCarte: (cible: 'centre' | 'vide', position: LonLat) => void
  deplacerPoignee: (poignee: Poignee, position: LonLat) => void
  connecter: (de: string, vers: string) => void
  executer: (action: ActionConfiguration) => void
}

interface Props {
  ref?: Ref<ConfigurationCarrefourHandle>
  carrefour: CarrefourResume
  /** Élément de la popup MapLibre où rendre le contenu de la popup ouverte. */
  ciblePopup: HTMLElement | null
  onAffichage: (affichage: AffichageConfiguration) => void
  /** Remet un feu à sa position OSM (null) ou le pose. */
  onPlacerFeu: (id: string, position: LonLat | null) => Promise<void>
  onFermer: () => void
}

/** Le focus est dans un champ : les raccourcis d'une lettre ne doivent pas s'y déclencher. */
const dansUnChamp = (cible: EventTarget | null) =>
  cible instanceof HTMLElement && (cible.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(cible.tagName))

/** Tab n'ouvre le panneau que si le focus n'est sur aucun contrôle (sinon il garde son rôle de navigation). */
const focusLibre = () => {
  const actif = document.activeElement
  return !actif || actif === document.body || actif.classList.contains('maplibregl-canvas')
}

export function ConfigurationCarrefour({ ref, carrefour, ciblePopup, onAffichage, onPlacerFeu, onFermer }: Props) {
  const queryClient = useQueryClient()
  const [outil, setOutil] = useState<OutilCarte>('selection')
  const [popup, setPopup] = useState<Popup | null>(null)
  const [panneauOuvert, setPanneauOuvert] = useState(false)
  const [ongletBas, setOngletBas] = useState<Onglet>('programme')
  /** Onglet du panneau bas affiché, null panneau fermé : pilote la lecture et la simulation. */
  const onglet: Onglet | null = panneauOuvert ? ongletBas : null

  // ── Étape 1 : branches ──
  const branchesEnregistrees = useQuery({
    queryKey: ['branches', carrefour.id],
    queryFn: () => api.branches(carrefour.id),
  })
  const [brouillonBranches, setBrouillonBranches] = useState<Brouillon | null>(null)
  const [sources, setSources] = useState<Record<string, 'osm' | 'defaut'>>({})
  const enregistre: BranchesCarrefour | undefined = branchesEnregistrees.data
  const configuration: Brouillon = useMemo(
    () => brouillonBranches ?? { branches: enregistre?.branches ?? AUCUNE_BRANCHE, connexions: enregistre?.connexions ?? AUCUNE_CONNEXION },
    [brouillonBranches, enregistre],
  )
  const branches = configuration.branches
  const centre: LonLat = enregistre?.centre ?? [0, 0]

  const detection = useMutation({
    mutationFn: () => api.detecterBranches(carrefour.id),
    onSuccess: (proposition) => {
      setBrouillonBranches({ branches: proposition.branches, connexions: proposition.connexions })
      setSources(proposition.sources)
    },
  })
  const enregistrementBranches = useMutation({
    mutationFn: () => api.enregistrerBranches(carrefour.id, pourEnregistrer(configuration)),
    onSuccess: async (resultat) => {
      queryClient.setQueryData(['branches', carrefour.id], resultat)
      setBrouillonBranches(null)
      await queryClient.invalidateQueries({ queryKey: ['lignes', carrefour.id] })
      await queryClient.invalidateQueries({ queryKey: ['programme', carrefour.id] })
    },
  })

  // ── Étape 2 : lignes de feux ──
  const lignesEnregistrees = useQuery({
    queryKey: ['lignes', carrefour.id],
    queryFn: () => api.lignes(carrefour.id),
  })
  const [brouillonLignes, setBrouillonLignes] = useState<BrouillonLignes | null>(null)
  const lignesEnregistreesData = lignesEnregistrees.data
  const lignes: BrouillonLignes = useMemo(
    () =>
      brouillonLignes ?? {
        lignes: lignesEnregistreesData?.lignes ?? [],
        conflits_admis: lignesEnregistreesData?.conflits_admis ?? [],
      },
    [brouillonLignes, lignesEnregistreesData],
  )
  const [ligneActive, setLigneActive] = useState<string | null>(null)

  const enregistrementLignes = useMutation({
    mutationFn: () => api.enregistrerLignes(carrefour.id, lignes),
    onSuccess: async (resultat) => {
      queryClient.setQueryData(['lignes', carrefour.id], resultat)
      setBrouillonLignes(null)
      setLigneActive(null)
      await queryClient.invalidateQueries({ queryKey: ['programme', carrefour.id] })
    },
  })

  // ── Étape 3 : programme par étapes (s'appuie sur les lignes enregistrées) ──
  const programmeEnregistre = useQuery({
    queryKey: ['programme', carrefour.id],
    queryFn: () => api.programme(carrefour.id),
  })
  const [brouillonProgramme, setBrouillonProgramme] = useState<PlanSaisi[] | null>(null)
  const programmeData = programmeEnregistre.data
  const plans: PlanSaisi[] = useMemo(
    () => brouillonProgramme ?? plansSaisis(programmeData?.plans ?? AUCUNE_LIGNE),
    [brouillonProgramme, programmeData],
  )
  const [planActif, setPlanActif] = useState(0)
  const [instant, setInstant] = useState(0)
  /** Vitesse de lecture du cycle (×1, ×4…), null à l'arrêt. */
  const [vitesse, setVitesse] = useState<number | null>(null)
  const lignesFeux = lignesEnregistreesData?.lignes ?? AUCUNE_LIGNE
  const contexte = useMemo(
    () =>
      enregistre && lignesEnregistreesData
        ? contexteProgramme(lignesPourMoteur(lignesEnregistreesData.lignes), geometrieEnregistree(enregistre), lignesEnregistreesData.conflits_admis)
        : null,
    [enregistre, lignesEnregistreesData],
  )
  const plan = plans[planActif]
  const resultat = useMemo(
    () =>
      contexte && plan?.mode === 'cycle' && plan.etapes.length > 0
        ? calculerProgramme({
            ...contexte,
            etapes: plan.etapes,
            jaune_s: plan.jaune_s,
            degagements: degagementsRetenus(contexte.degagements, plan.degagements),
          })
        : null,
    [contexte, plan],
  )

  // ── Étape 4 : graphe des étapes et simulation d'un scénario de demandes ──
  const [scenario, setScenario] = useState<Scenario>({ demandes: [], duree_s: 240 })
  const simulation = useMemo(
    () =>
      onglet === 'graphe' && contexte && plan?.mode === 'cycle' && plan.etapes.length > 0
        ? simulerGraphe({
            ...contexte,
            etapes: plan.etapes,
            jaune_s: plan.jaune_s,
            degagements: degagementsRetenus(contexte.degagements, plan.degagements),
            arcs: plan.arcs,
            demandes: scenario.demandes,
            duree_s: scenario.duree_s,
          })
        : null,
    [onglet, contexte, plan, scenario],
  )
  const erreurGraphe =
    contexte && plan?.mode === 'cycle'
      ? validerGraphe(plan.etapes, plan.arcs, contexte.lignes.map((l) => l.code)).some((c) => c.niveau === 'erreur')
      : false

  // Ce que lisent le curseur et la carte : le cycle calculé (onglet Programme) ou la simulation (onglet Graphe).
  const chronologie =
    onglet === 'programme' && resultat ? { ...resultat, duree_s: resultat.cycle_s } : onglet === 'graphe' ? simulation : null
  const cycle = chronologie?.duree_s ?? 0
  const instantCycle = cycle > 0 ? instant % cycle : 0
  const erreurProgramme = (resultat?.controles.some((c) => c.niveau === 'erreur') ?? false) || erreurGraphe

  const enregistrementProgramme = useMutation({
    mutationFn: () => api.enregistrerProgramme(carrefour.id, { plans }),
    onSuccess: (resultat) => {
      queryClient.setQueryData(['programme', carrefour.id], resultat)
      setBrouillonProgramme(null)
    },
  })

  // Lecture du cycle : le curseur avance en temps réel (multiplié par la vitesse).
  useEffect(() => {
    if (!vitesse || cycle <= 0) return
    let precedent = performance.now()
    let image = requestAnimationFrame(function avancer(maintenant) {
      const ecoule = (maintenant - precedent) / 1000
      precedent = maintenant
      setInstant((t) => (t + ecoule * vitesse) % cycle)
      image = requestAnimationFrame(avancer)
    })
    return () => cancelAnimationFrame(image)
  }, [vitesse, cycle, onglet])

  // Ce que la carte doit montrer.
  const cleSelection =
    popup?.type === 'voie' ? popup.cle : popup?.type === 'connexion' ? `${popup.de}>${popup.vers}` : popup?.type === 'branche' ? popup.code : null
  const feuxSurlignes =
    onglet === 'lignes' && ligneActive ? (lignes.lignes.find((l) => l.code === ligneActive)?.feux ?? AUCUN_FEU) : AUCUN_FEU
  const mouvementsActifs =
    onglet === 'lignes' && ligneActive ? lignes.lignes.find((l) => l.code === ligneActive)?.mouvements : undefined
  const connexionsSurlignees = useMemo(
    () =>
      mouvementsActifs
        ? configuration.connexions
            .filter((c) => mouvementsActifs.includes(`${c.de.split(':')[0]}>${c.vers.split(':')[0]}`))
            .map((c) => `${c.de}>${c.vers}`)
        : AUCUN_FEU,
    [mouvementsActifs, configuration.connexions],
  )
  // État de chaque ligne à l'instant lu, résumé en une chaîne : la carte n'est redessinée
  // que lorsqu'un feu change de couleur, pas à chaque image de la lecture.
  const etatsLignes = chronologie ? lignesFeux.map((l) => etatLigne(chronologie, l.code, instantCycle)).join(',') : ''
  const connexionsEnregistrees = enregistre?.connexions ?? AUCUNE_CONNEXION
  const feux = useMemo(() => {
    if (!etatsLignes) return null
    const etats = etatsLignes.split(',') as EtatFeu[]
    return feuxDesLignes(new Map(lignesFeux.map((l, i) => [l.code, etats[i]!])), lignesFeux, connexionsEnregistrees)
  }, [etatsLignes, lignesFeux, connexionsEnregistrees])

  useEffect(
    () =>
      onAffichage({
        branches,
        connexions: configuration.connexions,
        mode: outil,
        feuxSurlignes,
        connexionsSurlignees,
        feux,
        selection: cleSelection,
        ancre: popup?.position ?? null,
      }),
    [branches, configuration.connexions, outil, feuxSurlignes, connexionsSurlignees, feux, cleSelection, popup?.position, onAffichage],
  )

  const erreur = [detection, enregistrementBranches, enregistrementLignes, enregistrementProgramme].find((m) => m.error)?.error

  const modifications = [brouillonBranches, brouillonLignes, brouillonProgramme].filter((b) => b !== null).length
  const enregistrementEnCours = [enregistrementBranches, enregistrementLignes, enregistrementProgramme].some((m) => m.isPending)
  const sansLiaison = branches.flatMap((b) =>
    voiesDe(b, 'entrante').filter((v) => !configuration.connexions.some((c) => c.de === cleVoie(b.code, 'entrante', v.rang))),
  ).length

  /** Enregistre tout ce qui a changé : branches, puis lignes, puis programme (sauf s'il est en erreur). */
  const enregistrer = async () => {
    try {
      if (brouillonBranches) await enregistrementBranches.mutateAsync()
      if (brouillonLignes) await enregistrementLignes.mutateAsync()
      if (brouillonProgramme && !erreurProgramme) await enregistrementProgramme.mutateAsync()
    } catch {
      // L'erreur s'affiche dans l'en-tête (erreur de la mutation).
    }
  }

  const detecter = () => {
    if (branches.length === 0 || window.confirm('Remplacer les branches actuelles par la proposition OSM ?')) detection.mutate()
  }

  const fermer = () => {
    if (modifications === 0 || window.confirm('Abandonner les modifications non enregistrées ?')) onFermer()
  }

  const choisirOutil = (suivant: OutilCarte) => {
    setOutil(suivant)
    setPopup(null)
  }

  const ouvrirOnglet = (suivant: Onglet) => {
    setOngletBas(suivant)
    setPanneauOuvert(true)
    if (suivant === 'lignes') setLigneActive(null)
    if (suivant === 'graphe') setInstant(0)
  }

  const executer = (action: ActionConfiguration) => {
    if (action === 'osm') return detecter()
    if (action === 'plan') return setPanneauOuvert((ouvert) => !ouvert)
    if (action === 'enregistrer') return void enregistrer()
    if (action === 'fermer') return fermer()
    choisirOutil(action)
  }

  /** Échap défait une chose à la fois : popup, choix des feux d'une ligne, outil, puis la configuration. */
  const echap = () => {
    if (popup) return setPopup(null)
    if (ligneActive) return setLigneActive(null)
    if (outil !== 'selection') return setOutil('selection')
    fermer()
  }

  // Raccourcis clavier : le gestionnaire lit toujours le dernier état, sans se réabonner.
  const touche = useEffectEvent((e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault()
      return executer('enregistrer')
    }
    if (e.ctrlKey || e.metaKey || e.altKey || dansUnChamp(e.target)) return
    if (e.key === 'Escape') return echap()
    if (e.key === 'Tab' && !e.shiftKey && focusLibre()) {
      e.preventDefault()
      return executer('plan')
    }
    const action = RACCOURCIS[e.key.toLowerCase()]
    if (action) executer(action)
  })
  useEffect(() => {
    window.addEventListener('keydown', touche)
    return () => window.removeEventListener('keydown', touche)
  }, [])

  // Actions venues de la carte : clics (popups, choix des feux d'une ligne), glisser-déposer.
  useImperativeHandle(ref, () => ({
    deplacerPoignee: (poignee, position) => setBrouillonBranches(deplacerPoignee(configuration, poignee, position)),
    connecter: (de, vers) => setBrouillonBranches(basculerConnexion(configuration, de, vers)),
    clicFeu: (feu, position) => {
      if (feu.carrefour_id !== carrefour.id) return
      if (onglet === 'lignes' && ligneActive) {
        return setBrouillonLignes({
          ...lignes,
          lignes: lignes.lignes.map((l) =>
            l.code !== ligneActive
              ? l
              : { ...l, feux: l.feux.includes(feu.id) ? l.feux.filter((f) => f !== feu.id) : [...l.feux, feu.id] },
          ),
        })
      }
      if (outil === 'selection') setPopup({ type: 'feu', feu, position })
    },
    clicCalque: (clic) => {
      if (outil !== 'pieton') return setPopup(clic)
      const code = clic.type === 'voie' ? clic.cle.split(':')[0] : clic.type === 'branche' ? clic.code : undefined
      if (code) setBrouillonBranches(basculerTraversee(configuration, code, centre))
    },
    clicCarte: (cible, position) => setPopup(cible === 'centre' && outil === 'selection' ? { type: 'carrefour', position } : null),
    executer,
  }))

  // Le panneau bas occupe le bas de l'écran : la carte recentre le carrefour dans ce qui reste.
  // Seulement si le décalage change : un easeTo au montage interromprait le vol vers le carrefour.
  const { carte } = useMap()
  useEffect(() => {
    const bas = panneauOuvert ? (window.innerHeight * HAUTEUR_PANNEAU_VH) / 100 : 0
    if (!carte || (carte.getPadding().bottom ?? 0) === bas) return
    carte.easeTo({ padding: { top: 0, right: 0, left: 0, bottom: bas }, duration: 300 })
  }, [carte, panneauOuvert])
  useEffect(
    () => () => {
      if (carte && (carte.getPadding().bottom ?? 0) > 0) carte.easeTo({ padding: { top: 0, right: 0, bottom: 0, left: 0 } })
    },
    [carte],
  )

  const fermerPopup = () => setPopup(null)
  const lignePopupFeu = popup?.type === 'feu' ? lignes.lignes.find((l) => l.feux.includes(popup.feu.id)) : undefined
  const contenuPopup =
    popup?.type === 'voie' ? (
      <PopupVoie
        cle={popup.cle}
        brouillon={configuration}
        onChanger={setBrouillonBranches}
        onOutil={choisirOutil}
        onBranche={(code) => setPopup({ type: 'branche', code, position: popup.position })}
        onFermer={fermerPopup}
      />
    ) : popup?.type === 'connexion' ? (
      <PopupLiaison
        de={popup.de}
        vers={popup.vers}
        brouillon={configuration}
        enregistree={enregistre}
        lignes={lignes}
        onChanger={setBrouillonBranches}
        onLignes={() => ouvrirOnglet('lignes')}
        onFermer={fermerPopup}
      />
    ) : popup?.type === 'branche' ? (
      <PopupBranche
        code={popup.code}
        brouillon={configuration}
        centre={centre}
        source={sources[popup.code]}
        onChanger={setBrouillonBranches}
        onRenommer={(code) => setPopup({ ...popup, code })}
        onFermer={fermerPopup}
      />
    ) : popup?.type === 'feu' ? (
      <PopupFeu
        feu={popup.feu}
        etat={chronologie && lignePopupFeu ? LAMPES[etatLigne(chronologie, lignePopupFeu.code, instantCycle) as EtatFeu] : null}
        lignes={lignes}
        onChangerLignes={setBrouillonLignes}
        onRemettreOsm={() => {
          setPopup(null)
          void onPlacerFeu(popup.feu.id, null)
        }}
        onOutil={choisirOutil}
        onFermer={fermerPopup}
      />
    ) : popup?.type === 'carrefour' ? (
      <PopupCarrefour
        nom={carrefour.nom}
        brouillon={configuration}
        cycle={resultat?.cycle_s ?? null}
        detectionEnCours={detection.isPending}
        onDetecter={detecter}
        onPlan={() => {
          setPopup(null)
          setPanneauOuvert(true)
        }}
        onFermer={fermerPopup}
      />
    ) : null

  const selectionLue =
    popup?.type === 'voie'
      ? `voie ${popup.cle}`
      : popup?.type === 'connexion'
        ? `liaison ${popup.de} → ${popup.vers}`
        : popup?.type === 'branche'
          ? `branche ${popup.code}`
          : popup?.type === 'feu'
            ? 'feu'
            : popup?.type === 'carrefour'
              ? 'carrefour'
              : null
  const consigne =
    onglet === 'lignes' && ligneActive
      ? { titre: `Feux de ${ligneActive}`, aides: ['Clic sur un feu du carrefour : l’ajouter ou le retirer'] }
      : CONSIGNES[outil]

  return (
    <>
      <CarteEnTete
        position="fixed"
        top="3"
        left="3"
        zIndex="2"
        w="340px"
        maxW="calc(100vw - 24px)"
        pe="10"
        surtitre="Besançon Voirie · configuration"
        titre={carrefour.nom}
        badges={
          <>
            <Badge colorPalette="gray">{selectionLue ? `Sélection : ${selectionLue}` : 'Aucune sélection'}</Badge>
            {modifications > 0 && (
              <Badge colorPalette="orange">
                {modifications} modification{modifications > 1 ? 's' : ''} à enregistrer
              </Badge>
            )}
            {sansLiaison > 0 && (
              <Badge colorPalette="orange">
                {sansLiaison} voie{sansLiaison > 1 ? 's' : ''} sans liaison
              </Badge>
            )}
          </>
        }
      >
        <IconButton
          position="absolute"
          top="2"
          right="2"
          variant="ghost"
          size="xs"
          aria-label="Quitter la configuration"
          title="Quitter la configuration (Échap)"
          onClick={fermer}
        >
          ×
        </IconButton>
        {branchesEnregistrees.isSuccess && branches.length === 0 && (
          <Indice mt="2">
            Aucune branche : <Kbd>O</Kbd> pour les détecter depuis OSM
          </Indice>
        )}
        {erreur && (
          <Message ton="erreur" mt="1">
            {erreur.message}
          </Message>
        )}
      </CarteEnTete>

      {consigne && (
        <BandeauMode
          position="fixed"
          top="3"
          left="50%"
          transform="translateX(-50%)"
          zIndex="2"
          titre={consigne.titre}
          aides={[
            ...consigne.aides,
            <Kbd key="echap" variant="inverse">
              Échap
            </Kbd>,
          ]}
        />
      )}

      <BarreOutils.Root
        position="fixed"
        left="50%"
        transform="translateX(-50%)"
        bottom={panneauOuvert ? `calc(${hauteurPanneau} + 16px)` : '22px'}
        zIndex="3"
      >
        {OUTILS.map((o) => (
          <BarreOutils.Outil key={o.outil} {...o} actif={outil === o.outil} onClick={() => choisirOutil(o.outil)} />
        ))}
        <BarreOutils.Separateur />
        <BarreOutils.Outil glyphe="⟳" libelle="OSM" raccourci="O" disabled={detection.isPending} onClick={detecter} />
        <BarreOutils.Outil
          glyphe="▭"
          libelle="Plan"
          raccourci="⇥"
          actif={panneauOuvert}
          onClick={() => setPanneauOuvert((ouvert) => !ouvert)}
        />
        <BarreOutils.Separateur />
        <Button
          variant="encre"
          size="md"
          borderRadius="9px"
          disabled={modifications === 0}
          loading={enregistrementEnCours}
          title={brouillonProgramme && erreurProgramme ? 'Le programme a des erreurs : il ne sera pas enregistré' : 'Enregistrer (Ctrl S)'}
          onClick={() => void enregistrer()}
        >
          Enregistrer
        </Button>
      </BarreOutils.Root>

      {panneauOuvert && (
        <PanneauBas.Root position="fixed" left="0" right="0" bottom="0" h={hauteurPanneau} zIndex="2">
          <PanneauBas.Entete titre="Plan de feux">
            <Tabs.Root value={ongletBas} fitted={false} onValueChange={(e) => ouvrirOnglet(e.value as Onglet)}>
              <Tabs.List>
                <Tabs.Trigger value="lignes">Lignes de feux</Tabs.Trigger>
                <Tabs.Trigger value="programme">Programme</Tabs.Trigger>
                <Tabs.Trigger value="graphe">Graphe et simulation</Tabs.Trigger>
              </Tabs.List>
            </Tabs.Root>
            {brouillonLignes && <Badge colorPalette="orange">Lignes non enregistrées</Badge>}
            {brouillonProgramme && <Badge colorPalette="orange">Programme non enregistré</Badge>}
            {erreurProgramme && <Badge colorPalette="red">Programme en erreur</Badge>}
            <Box flex="1" />
            {chronologie && (
              <Valeur color="fg.secondary">
                t = {Math.floor(instantCycle)} s / {Math.round(cycle)} s
              </Valeur>
            )}
            <IconButton aria-label="Fermer le plan de feux" title="Fermer (Tab)" onClick={() => setPanneauOuvert(false)}>
              ×
            </IconButton>
          </PanneauBas.Entete>
          <PanneauBas.Corps>
            {ongletBas === 'lignes' ? (
              <Stack gap="3">
                <Aide>
                  Regroupez les mouvements par <strong>ligne de feux</strong> (les feux qui changent toujours ensemble) et
                  indiquez les feux physiques qui les affichent.
                </Aide>
                {brouillonBranches && (
                  <Message ton="avertissement">
                    Les branches ont des modifications non enregistrées : les lignes utilisent la version enregistrée.
                  </Message>
                )}
                {lignesEnregistrees.data?.alertes.map((alerte) => (
                  <Message key={alerte} ton="erreur">
                    {alerte}
                  </Message>
                ))}
                {lignesEnregistrees.isPending ? (
                  <Aide>Chargement…</Aide>
                ) : (
                  enregistre && (
                    <OngletLignes
                      configuration={enregistre}
                      brouillon={lignes}
                      onChanger={setBrouillonLignes}
                      ligneActive={ligneActive}
                      onActiver={setLigneActive}
                    />
                  )
                )}
              </Stack>
            ) : (
              <Stack gap="3">
                <Aide>
                  {ongletBas === 'programme' ? (
                    <>
                      Découpez le cycle en <strong>étapes</strong> : les lignes au vert ensemble, et pendant combien de temps.
                      Le jaune et les rouges de dégagement s'ajoutent entre les étapes.
                    </>
                  ) : (
                    <>
                      Le <strong>graphe des étapes</strong> décrit les feux à la demande : étapes servies sur appel (bouton
                      piéton, boucle), étapes prioritaires hors cycle (tram). La simulation le déroule sur un scénario.
                    </>
                  )}
                </Aide>
                {brouillonLignes && (
                  <Message ton="avertissement">
                    Les lignes ont des modifications non enregistrées : le programme utilise la version enregistrée.
                  </Message>
                )}
                {!brouillonProgramme && programmeData?.plans[planActif]?.etapes_deduites && (
                  <Aide>Étapes reconstruites à partir du diagramme de feux enregistré.</Aide>
                )}
                {!brouillonProgramme &&
                  programmeData?.alertes.map((alerte) => (
                    <Message key={alerte} ton="erreur">
                      {alerte}
                    </Message>
                  ))}
                {programmeEnregistre.isPending || !contexte ? (
                  <Aide>Chargement…</Aide>
                ) : ongletBas === 'graphe' ? (
                  <OngletGraphe
                    contexte={contexte}
                    plans={plans}
                    onChanger={setBrouillonProgramme}
                    planActif={planActif}
                    onPlanActif={(index) => {
                      setPlanActif(index)
                      setInstant(0)
                    }}
                    scenario={scenario}
                    onScenario={setScenario}
                    simulation={simulation}
                    instant={instantCycle}
                    onInstant={setInstant}
                    vitesse={vitesse}
                    onVitesse={setVitesse}
                  />
                ) : (
                  <OngletProgramme
                    contexte={contexte}
                    plans={plans}
                    onChanger={setBrouillonProgramme}
                    planActif={planActif}
                    onPlanActif={(index) => {
                      setPlanActif(index)
                      setInstant(0)
                    }}
                    resultat={resultat}
                    instant={instantCycle}
                    onInstant={setInstant}
                    vitesse={vitesse}
                    onVitesse={setVitesse}
                  />
                )}
              </Stack>
            )}
          </PanneauBas.Corps>
        </PanneauBas.Root>
      )}

      {ciblePopup && contenuPopup && createPortal(contenuPopup, ciblePopup)}
    </>
  )
}
