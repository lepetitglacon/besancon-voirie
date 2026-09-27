import { Badge, Box, Button, HStack, IconButton, Kbd, Spinner, Stack, Tabs } from '@chakra-ui/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  calculerProgramme,
  cleVoie,
  contexteProgramme,
  degagementsRetenus,
  etatLigne,
  repereLocal,
  simulerGraphe,
  validerGraphe,
  type LonLat,
} from '@voirie/engine'
import {
  COTE_PHOTO_IA_MAX_M,
  COTE_PHOTO_IA_MIN_M,
  ConfigurationBranches,
  type AnalyseIa,
  type Branche,
  type BranchesCarrefour,
  type CarrefourResume,
  type Connexion,
  type DetectionBranchesIa,
  type EmpriseIa,
  type FeuResume,
  type PlanSaisi,
  type SourceBranche,
} from '@voirie/schema'
import { useCallback, useEffect, useEffectEvent, useImperativeHandle, useMemo, useRef, useState, type Ref } from 'react'
import { createPortal } from 'react-dom'
import { useMap } from 'react-map-gl/maplibre'
import { api } from '../api'
import { Aide, BandeauMode, BarreOutils, CarteEnTete, Indice, Message, notifications, PanneauBas, Valeur, type EtatLampe } from '../ds'
import { demanderNotificationsSysteme, enFile, useAnalysesIa } from './analysesIa'
import { Chrono } from './FileIa'
import type { ClicCalque, ModeEdition } from './calque/CalqueCarrefour'
import type { EtatFeu } from './calque/elements'
import { basculerConnexion, basculerTraversee, deplacerPoignee, tracerVoie, voiesDe, type Brouillon, type Poignee } from './modele'
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
  /** Zone de la photo envoyée à l'IA, pendant qu'on la dessine ; null : aucune. */
  cadreIa: { emprise: EmpriseIa; libelle: string } | null
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
  tracer: {
    titre: 'Tracer une voie',
    aides: ['Glisser de la ligne d’arrêt vers l’amont', 'Elle rejoint la branche la plus proche, ou en ouvre une', 'Molette : zoomer'],
  },
}

/** Hauteur du panneau bas « Plan de feux », en % de la fenêtre. */
const HAUTEUR_PANNEAU_VH = 44
const hauteurPanneau = `${HAUTEUR_PANNEAU_VH}vh`

/** Plus grand côté de l'image envoyée à l'IA (px) : la résolution baisse quand la zone grandit. */
const TAILLE_PHOTO_IA_PX = 1024

/** Dimensions au sol (m) d'une zone [ouest, sud, est, nord]. */
function dimensionsZone([ouest, sud, est, nord]: EmpriseIa) {
  const { versXY } = repereLocal([(ouest + est) / 2, (sud + nord) / 2])
  const [x0, y0] = versXY([ouest, sud])
  const [x1, y1] = versXY([est, nord])
  const largeur_m = x1 - x0
  const hauteur_m = y1 - y0
  const cotes = [largeur_m, hauteur_m]
  const refus = cotes.some((c) => c < COTE_PHOTO_IA_MIN_M)
    ? `Zone trop petite : ${COTE_PHOTO_IA_MIN_M} m de côté au moins`
    : cotes.some((c) => c > COTE_PHOTO_IA_MAX_M)
      ? `Zone trop grande : ${COTE_PHOTO_IA_MAX_M} m de côté au plus`
      : null
  return { largeur_m, hauteur_m, cm_par_px: (Math.max(...cotes) / TAILLE_PHOTO_IA_PX) * 100, refus }
}

const LAMPES: Record<EtatFeu, EtatLampe | null> = { vert: 'vert', jaune: 'orange', rouge: 'rouge', libre: null }

/** Ce que le parent relaie depuis la carte et le menu contextuel. */
export interface ConfigurationCarrefourHandle {
  clicFeu: (feu: FeuResume, position: LonLat) => void
  clicCalque: (clic: ClicCalque) => void
  clicCarte: (cible: 'centre' | 'vide', position: LonLat) => void
  deplacerPoignee: (poignee: Poignee, position: LonLat) => void
  connecter: (de: string, vers: string) => void
  tracerVoie: (geom: [LonLat, LonLat]) => void
  dessinerZoneIa: (emprise: EmpriseIa) => void
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
  /** Proposition IA à charger à l'ouverture (« Ouvrir » d'une notification). Un nouvel objet la recharge. */
  ouvrirAnalyseIa?: { id: string } | null
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

export function ConfigurationCarrefour({ ref, carrefour, ciblePopup, onAffichage, onPlacerFeu, ouvrirAnalyseIa, onFermer }: Props) {
  const queryClient = useQueryClient()
  const { carte } = useMap()
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
  const [sources, setSources] = useState<Record<string, SourceBranche>>({})
  const [analyseIa, setAnalyseIa] = useState<DetectionBranchesIa['ia'] | null>(null)
  const champImport = useRef<HTMLInputElement>(null)
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
      setAnalyseIa(null)
    },
  })

  // ── Proposition OSM + IA : mise en file, suivie, puis chargée quand elle est prête ──
  const analyses = useAnalysesIa()
  /** Dernière analyse de ce carrefour (la liste va de la plus récente à la plus ancienne). */
  const analyseCarrefour = analyses.data?.find((a) => a.carrefour.id === carrefour.id)
  const iaEnFile = analyseCarrefour !== undefined && enFile(analyseCarrefour)
  // Avant la mise en file, on dessine la zone de la photo (null : cadre automatique d'après les feux).
  const [cadrage, setCadrage] = useState<{ emprise: EmpriseIa | null } | null>(null)
  const cadreAuto = useQuery({
    queryKey: ['cadre-ia', carrefour.id],
    queryFn: () => api.cadreIa(carrefour.id),
    enabled: cadrage !== null,
  })
  const zoneIa = cadrage ? (cadrage.emprise ?? cadreAuto.data?.emprise ?? null) : null
  const dimensionsIa = useMemo(() => (zoneIa ? dimensionsZone(zoneIa) : null), [zoneIa])
  const demandeIa = useMutation({
    mutationFn: (emprise?: EmpriseIa) => api.demanderAnalyseIa(carrefour.id, emprise),
    onMutate: demanderNotificationsSysteme,
    onSuccess: async () => {
      setCadrage(null)
      await queryClient.invalidateQueries({ queryKey: ['analyses-ia'] })
      notifications.create({
        type: 'info',
        title: 'Ajouté à la file IA',
        description: `${carrefour.nom} : vous serez prévenu quand la proposition sera prête. Vous pouvez continuer ailleurs.`,
      })
    },
  })
  const genererIa = () => {
    if (iaEnFile || demandeIa.isPending) return
    setPopup(null)
    demandeIa.reset()
    setCadrage({ emprise: null })
  }
  const lancerIa = () => {
    if (!cadrage || !zoneIa || dimensionsIa?.refus || demandeIa.isPending) return
    demandeIa.mutate(cadrage.emprise ?? undefined)
  }
  const brouillonActuel = useRef(brouillonBranches)
  useEffect(() => {
    brouillonActuel.current = brouillonBranches
  }, [brouillonBranches])
  const chargementIa = useMutation({
    mutationFn: async (id: string) => {
      const analyse = await api.analyseIa(id)
      if (!analyse.resultat) throw new Error('Proposition IA indisponible')
      await api.consulterAnalyseIa(id)
      return analyse.resultat
    },
    onSuccess: async (proposition) => {
      setBrouillonBranches({ branches: proposition.branches, connexions: proposition.connexions })
      setSources(proposition.sources)
      setAnalyseIa(proposition.ia)
      await queryClient.invalidateQueries({ queryKey: ['analyses-ia'] })
    },
  })
  const chargerIa = chargementIa.mutate
  const chargerAnalyse = useCallback(
    (id: string) => {
      if (brouillonActuel.current === null || window.confirm('Remplacer les modifications non enregistrées par la proposition IA ?')) {
        chargerIa(id)
      }
    },
    [chargerIa],
  )
  useEffect(() => {
    if (ouvrirAnalyseIa) chargerAnalyse(ouvrirAnalyseIa.id)
  }, [ouvrirAnalyseIa, chargerAnalyse])

  /** Import d'un JSON `ConfigurationBranches` (le corps d'un `PUT /branches`), validé par le même schéma. */
  const importJson = useMutation({
    mutationFn: async (fichier: File) => {
      let brut: unknown
      try {
        brut = JSON.parse(await fichier.text())
      } catch {
        throw new Error(`${fichier.name} n’est pas un fichier JSON`)
      }
      const resultat = ConfigurationBranches.safeParse(brut)
      if (!resultat.success) {
        throw new Error(`JSON refusé : ${resultat.error.issues.map((i) => `${i.path.join('.')} : ${i.message}`).join(' ; ')}`)
      }
      return resultat.data
    },
    onSuccess: (configurationImportee) => {
      setBrouillonBranches(configurationImportee)
      setSources({})
      setAnalyseIa(null)
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

  const libelleZoneIa = dimensionsIa && `Photo IA · ${Math.round(dimensionsIa.largeur_m)} × ${Math.round(dimensionsIa.hauteur_m)} m`
  useEffect(
    () =>
      onAffichage({
        branches,
        connexions: configuration.connexions,
        mode: cadrage ? null : outil,
        feuxSurlignes,
        connexionsSurlignees,
        feux,
        selection: cleSelection,
        ancre: popup?.position ?? null,
        cadreIa: zoneIa && libelleZoneIa ? { emprise: zoneIa, libelle: libelleZoneIa } : null,
      }),
    [
      branches,
      configuration.connexions,
      outil,
      cadrage,
      feuxSurlignes,
      connexionsSurlignees,
      feux,
      cleSelection,
      popup?.position,
      zoneIa,
      libelleZoneIa,
      onAffichage,
    ],
  )

  const erreur = [detection, cadreAuto, demandeIa, chargementIa, importJson, enregistrementBranches, enregistrementLignes, enregistrementProgramme].find((m) => m.error)?.error

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
    if (action === 'ia') return genererIa()
    if (action === 'json') return champImport.current?.click()
    if (action === 'plan') return setPanneauOuvert((ouvert) => !ouvert)
    if (action === 'enregistrer') return void enregistrer()
    if (action === 'fermer') return fermer()
    choisirOutil(action)
  }

  /** Échap défait une chose à la fois : cadrage IA, popup, choix des feux d'une ligne, outil, puis la configuration. */
  const echap = () => {
    if (cadrage) return setCadrage(null)
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
    if (e.key === 'Enter' && cadrage && focusLibre()) {
      e.preventDefault()
      return lancerIa()
    }
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
    tracerVoie: (geom) => {
      const trace = tracerVoie(configuration, geom, centre)
      if (!trace) {
        return notifications.create({ type: 'error', title: 'Voie non ajoutée', description: 'La branche a déjà toutes ses voies (10 par sens au plus).' })
      }
      setBrouillonBranches(trace.brouillon)
      setPopup({ type: 'voie', cle: trace.cle, position: geom[0] })
      // La popup s'ouvre au-dessus de la voie : on la ramène sous le milieu de l'écran pour qu'elle tienne.
      carte?.panTo(geom[0], { offset: [0, 160], duration: 300 })
    },
    dessinerZoneIa: (emprise) => {
      if (!cadrage) return
      demandeIa.reset()
      setCadrage({ emprise })
    },
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
        centre={centre}
        onChanger={setBrouillonBranches}
        onCle={(cle) => setPopup({ ...popup, cle })}
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
        ia={analyseIa?.branches[popup.code]}
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
        iaEnFile={iaEnFile}
        onGenererIa={genererIa}
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
  const consigne = cadrage
    ? { titre: 'Zone de la photo IA', aides: ['Glisser sur la carte pour dessiner la zone : l’IA ne voit rien en dehors', 'Entrée : lancer'] }
    : onglet === 'lignes' && ligneActive
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
            Aucune branche : <Kbd>O</Kbd> pour les détecter depuis OSM, <Kbd>T</Kbd> pour tracer les voies
          </Indice>
        )}
        {cadrage && (
          <CadrageIa
            dimensions={dimensionsIa}
            auto={cadrage.emprise === null}
            envoi={demandeIa.isPending}
            onAuto={() => setCadrage({ emprise: null })}
            onAnnuler={() => setCadrage(null)}
            onLancer={lancerIa}
          />
        )}
        {analyseCarrefour && !(analyseCarrefour.statut === 'terminee' && analyseCarrefour.consultee_le) && (
          <SuiviAnalyse analyse={analyseCarrefour} chargement={chargementIa.isPending} onCharger={() => chargerAnalyse(analyseCarrefour.id)} />
        )}
        {analyseIa && (
          <Stack gap="1" mt="2" pt="2" borderTopWidth="1px" borderColor="border.muted">
            <Aide>
              ✦ Lu sur la photo par {analyseIa.modele} en {analyseIa.duree_s} s
              {analyseIa.cout_usd !== null && ` (${analyseIa.cout_usd.toFixed(2)} $)`}. Vérifiez chaque branche avant d’enregistrer.
            </Aide>
            {analyseIa.remarques && (
              <Aide color="fg" maxH="120px" overflowY="auto">
                {analyseIa.remarques}
              </Aide>
            )}
          </Stack>
        )}
        {erreur && (
          <Message ton="erreur" mt="1">
            {erreur.message}
          </Message>
        )}
        <input
          ref={champImport}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const fichier = e.target.files?.[0]
            e.target.value = ''
            if (fichier && (branches.length === 0 || window.confirm(`Remplacer les branches actuelles par ${fichier.name} ?`))) {
              importJson.mutate(fichier)
            }
          }}
        />
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
          glyphe="✦"
          libelle="IA"
          raccourci="I"
          disabled={iaEnFile || demandeIa.isPending}
          title="Générer avec OSM + IA : régler le cadre de la photo IGN, puis la détection OSM corrigée par Claude (~1 min, en file)"
          onClick={genererIa}
        />
        <BarreOutils.Outil glyphe="⇪" libelle="JSON" title="Importer un JSON { branches, connexions }" onClick={() => champImport.current?.click()} />
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

/** Où en est la proposition IA de ce carrefour : en file, en cours, prête à charger, en échec. */
interface PropsCadrage {
  /** null tant que le cadre automatique n'est pas connu. */
  dimensions: ReturnType<typeof dimensionsZone> | null
  /** Cadre automatique (d'après les feux), pas encore redessiné. */
  auto: boolean
  envoi: boolean
  onAuto: () => void
  onAnnuler: () => void
  onLancer: () => void
}

/** Zone de la photo, dessinée sur la carte avant de mettre l'analyse IA en file. */
function CadrageIa({ dimensions, auto, envoi, onAuto, onAnnuler, onLancer }: PropsCadrage) {
  return (
    <Stack gap="2" mt="2" pt="2" borderTopWidth="1px" borderColor="border.muted">
      <Aide color="fg">
        ✦ Zone de la photo {auto ? '(automatique, d’après les feux)' : '(dessinée)'} : glissez sur la carte pour la redessiner.
      </Aide>
      {dimensions && (
        <Aide>
          {Math.round(dimensions.largeur_m)} × {Math.round(dimensions.hauteur_m)} m · {Math.round(dimensions.cm_par_px)} cm/pixel
        </Aide>
      )}
      {dimensions?.refus && <Message ton="erreur">{dimensions.refus}</Message>}
      <HStack gap="2" justify="flex-end">
        {!auto && (
          <Button size="xs" variant="ghost" onClick={onAuto}>
            Automatique
          </Button>
        )}
        <Button size="xs" variant="outline" onClick={onAnnuler}>
          Annuler
        </Button>
        <Button size="xs" variant="solid" disabled={!dimensions || dimensions.refus !== null} loading={envoi} onClick={onLancer}>
          Lancer l’analyse (Entrée)
        </Button>
      </HStack>
    </Stack>
  )
}

function SuiviAnalyse({ analyse, chargement, onCharger }: { analyse: AnalyseIa; chargement: boolean; onCharger: () => void }) {
  return (
    <HStack gap="2" mt="2" pt="2" borderTopWidth="1px" borderColor="border.muted" aria-live="polite">
      {analyse.statut === 'en_cours' && <Spinner size="xs" color="fg.muted" />}
      <Stack gap="0" flex="1">
        {analyse.statut === 'en_attente' && <Aide color="fg">✦ En file d’attente{analyse.rang ? ` (n° ${analyse.rang})` : ''}</Aide>}
        {analyse.statut === 'en_cours' && (
          <Aide color="fg">✦ Claude lit la photo aérienne… {analyse.commencee_le && <Chrono depuis={analyse.commencee_le} />}</Aide>
        )}
        {enFile(analyse) && <Aide>Vous pouvez quitter ce carrefour : une notification vous préviendra.</Aide>}
        {analyse.statut === 'terminee' && <Aide color="fg">✦ Proposition IA prête</Aide>}
        {analyse.statut === 'echec' && <Message ton="erreur">Analyse IA en échec : {analyse.erreur}</Message>}
      </Stack>
      {analyse.statut === 'terminee' && (
        <Button size="xs" variant="solid" onClick={onCharger} loading={chargement}>
          Charger
        </Button>
      )}
    </HStack>
  )
}
