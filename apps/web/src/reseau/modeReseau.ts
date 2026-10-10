/**
 * Éditeur des voies (docs/RESEAU.md §7), à la TM:PE : outil actif quand aucun carrefour n'est
 * ouvert, ses réglages, tronçon ou nœud sélectionné, tracé ou emprise en cours, données de
 * l'emprise de la carte et modifications du réseau. Chaque changement part aussitôt à l'API ; les
 * carrefours touchés sont recalculés par le serveur, leurs branches, lignes et programme relus.
 * Les modifications de la session s'annulent et se refont (docs/pipeline-donnees.md, étape 2).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { boutsAuNoeud, cleEmprise, liaisonsRetenues, sensDuCote, typesVoies, type Liaison, type LonLat } from '@voirie/engine'
import type { Bbox, CoupeTroncon, ModificationNoeud, ModificationTroncon, NouveauTroncon, ReseauGeoJson, SensTroncon } from '@voirie/schema'
import { useRef, useState } from 'react'
import { api, type Noeud, type Troncon } from '../api'
import { notifications } from '../ds'
import { usePreference } from '../preferences'
import type { OutilReseau } from './CoucheReseau'
import { useHistorique } from './historique'
import { REGLAGES_DEFAUT, type ReglagesOutils } from './reglages'
import { cliquer, retirerDernier, versNouveauTroncon, type Cible, type Trace } from './trace'

/** En dessous, l'emprise contient trop de tronçons : on ne les charge pas. */
export const ZOOM_MIN_RESEAU = 14
/** À partir de ce zoom, les rues sont dessinées voie par voie, comme les carrefours. */
export const ZOOM_VOIES = 16

/** Tronçon ou nœud dont la popup est ouverte, ancrée au point cliqué. */
export type SelectionReseau = { type: 'troncon' | 'noeud'; id: string; position: LonLat }

/** Emprise d'une voie en cours de dessin (outil Emprise) : la voie visée, puis les sommets posés. */
export interface EmpriseEnCours {
  troncon: string
  sens: SensTroncon
  rang: number
  points: LonLat[]
}

interface Options {
  actif: boolean
  bbox: Bbox | undefined
  zoom: number
  /** Carrefour ouvert : l'outil Nœuds y ajoute ou en retire des nœuds. */
  carrefourOuvert: { id: string; nom: string } | null
  /** Nom d'un carrefour de la carte (pour les messages). */
  nomCarrefour: (id: string) => string
}

/** Place un nœud et les bouts de ses tronçons dans les données en cache, avant la réponse de l'API. */
function deplacerDansLeCache(reseau: ReseauGeoJson, noeud: string, position: LonLat): ReseauGeoJson {
  return {
    ...reseau,
    noeuds: {
      ...reseau.noeuds,
      features: reseau.noeuds.features.map((n) => (n.id === noeud ? { ...n, geometry: { ...n.geometry, coordinates: position } } : n)),
    },
    troncons: {
      ...reseau.troncons,
      features: reseau.troncons.features.map((t) => {
        const { noeud_de, noeud_vers } = t.properties
        if (noeud_de !== noeud && noeud_vers !== noeud) return t
        const points = [...t.geometry.coordinates]
        if (noeud_de === noeud) points[0] = position
        if (noeud_vers === noeud) points[points.length - 1] = position
        return { ...t, geometry: { ...t.geometry, coordinates: points } }
      }),
    },
  }
}

/** Ce que remet une modification de tronçon annulée : les valeurs d'avant des champs touchés. */
function modificationInverse(m: ModificationTroncon, avant: Troncon): ModificationTroncon {
  const t = avant.properties
  if (m.inverser) return { inverser: true }
  const inverse: ModificationTroncon = {}
  if (m.voie) {
    const { sens, rang } = m.voie
    const nombre = sens === 'avant' ? t.voies_avant : t.voies_arriere
    if (m.voie.action === 'inserer') inverse.voie = { action: 'retirer', sens, rang: Math.min(rang, nombre) }
    else {
      const types = typesVoies(nombre, sens === 'avant' ? t.types_avant : t.types_arriere)
      inverse.voie = { action: 'inserer', sens, rang, type: types[rang] ?? 'generale' }
      const emprise = t.emprises?.[cleEmprise(sens, rang)]
      if (emprise) inverse.emprise = { sens, rang, polygone: emprise }
    }
  }
  if (m.emprise) inverse.emprise = { ...m.emprise, polygone: t.emprises?.[cleEmprise(m.emprise.sens, m.emprise.rang)] ?? null }
  if (m.nom !== undefined) inverse.nom = t.nom
  if (m.vitesse_kmh !== undefined) inverse.vitesse_kmh = t.vitesse_kmh
  // Le nombre de voies d'un sens et leurs types vont ensemble : on remet les deux.
  if (m.voies_avant !== undefined || m.types_avant !== undefined) Object.assign(inverse, { voies_avant: t.voies_avant, types_avant: t.types_avant })
  if (m.voies_arriere !== undefined || m.types_arriere !== undefined) Object.assign(inverse, { voies_arriere: t.voies_arriere, types_arriere: t.types_arriere })
  if (m.points) inverse.points = avant.geometry.coordinates
  return inverse
}

function libelleModification(m: ModificationTroncon): string {
  if (m.inverser) return 'Sens du tronçon'
  if (m.voie) return m.voie.action === 'inserer' ? 'Voie ajoutée' : 'Voie retirée'
  if (m.emprise) return m.emprise.polygone ? 'Emprise de voie' : 'Emprise retirée'
  if (m.points) return 'Tracé du tronçon'
  if (m.nom !== undefined) return 'Nom de la rue'
  if (m.vitesse_kmh !== undefined) return 'Vitesse'
  return 'Voies du tronçon'
}

function libelleNoeud(m: ModificationNoeud): string {
  if (m.position) return 'Nœud déplacé'
  if (m.feux !== undefined) return m.feux ? 'Ligne d’arrêt posée' : 'Ligne d’arrêt retirée'
  if (m.pieton !== undefined) return m.pieton ? 'Passage piéton posé' : 'Passage piéton retiré'
  return 'Carrefour du nœud'
}

export function useModeReseau({ actif, bbox, zoom, carrefourOuvert, nomCarrefour }: Options) {
  const queryClient = useQueryClient()
  const [outil, setOutil] = useState<OutilReseau>('selection')
  const [reglages, setReglages] = usePreference<ReglagesOutils>('reglages-outils-voies', REGLAGES_DEFAUT)
  const [selection, setSelection] = useState<SelectionReseau | null>(null)
  const [trace, setTrace] = useState<Trace>([])
  // Le tracé courant, lu par les gestionnaires d'évènements sans attendre un rendu.
  const traceActuel = useRef<Trace>([])
  const changerTrace = (suivant: Trace) => {
    traceActuel.current = suivant
    setTrace(suivant)
  }
  const [emprise, setEmprise] = useState<EmpriseEnCours | null>(null)
  const empriseActuelle = useRef<EmpriseEnCours | null>(null)
  const changerEmprise = (suivante: EmpriseEnCours | null) => {
    empriseActuelle.current = suivante
    setEmprise(suivante)
  }
  const historique = useHistorique()

  const visible = actif && bbox !== undefined && zoom >= ZOOM_MIN_RESEAU
  const donnees = useQuery({
    queryKey: ['reseau', bbox],
    queryFn: () => api.reseau(bbox!),
    enabled: visible,
    placeholderData: (precedent) => precedent,
  })
  /** Le réseau a changé : la carte, et les carrefours recalculés par le serveur (branches, lignes, programme). */
  const rafraichir = () =>
    Promise.all(['reseau', 'branches', 'lignes', 'programme'].map((cle) => queryClient.invalidateQueries({ queryKey: [cle] })))
  const echec = (titre: string) => async (erreur: Error) => {
    await rafraichir()
    notifications.create({ type: 'error', title: titre, description: erreur.message })
  }

  /** Dernières données reçues, toutes emprises confondues : une annulation peut viser ce qui a quitté la vue. */
  const enCache = () => queryClient.getQueriesData<ReseauGeoJson>({ queryKey: ['reseau'] }).flatMap(([, r]) => (r ? [r] : []))
  const tronconEnCache = (id: string) => enCache().flatMap((r) => r.troncons.features).find((t) => t.id === id)
  const noeudEnCache = (id: string) => enCache().flatMap((r) => r.noeuds.features).find((n) => n.id === id)
  /** Tronçon qui relie ces deux nœuds (après une fusion, son identifiant peut être celui de l'une ou l'autre moitié). */
  const tronconEntre = (a: string, b: string) =>
    enCache()
      .flatMap((r) => r.troncons.features)
      .find((t) => [t.properties.noeud_de, t.properties.noeud_vers].sort().join() === [a, b].sort().join())

  /** Requête d'une annulation ou d'une reprise, puis relecture du réseau. */
  const rejouer = async <T,>(requete: Promise<T>) => {
    const resultat = await requete
    await rafraichir()
    return resultat
  }

  const creation = useMutation({
    mutationFn: api.creerTroncon,
    onSuccess: async (troncon, nouveau) => {
      changerTrace([])
      await rafraichir()
      const milieu = troncon.geometry.coordinates[Math.floor(troncon.geometry.coordinates.length / 2)]!
      setSelection({ type: 'troncon', id: troncon.id, position: milieu })
      let id = troncon.id
      historique.enregistrer({
        libelle: 'Rue tracée',
        annuler: () => rejouer(api.supprimerTroncon(id)),
        refaire: async () => {
          id = (await rejouer(api.creerTroncon(nouveau))).id
        },
      })
    },
    onError: (erreur) => notifications.create({ type: 'error', title: 'Tronçon non enregistré', description: erreur.message }),
  })
  const modification = useMutation({
    mutationFn: ({ id, modification }: { id: string; modification: ModificationTroncon }) => api.modifierTroncon(id, modification),
    onSuccess: rafraichir,
  })
  const suppression = useMutation({
    mutationFn: api.supprimerTroncon,
    onSuccess: async () => {
      setSelection(null)
      // Les modifications d'avant pourraient viser ce tronçon : elles ne s'annulent plus.
      historique.vider()
      await rafraichir()
    },
  })
  const coupe = useMutation({
    mutationFn: ({ id, coupe }: { id: string; coupe: CoupeTroncon }) => api.couperTroncon(id, coupe),
    onSuccess: rafraichir,
    onError: echec('Tronçon non coupé'),
  })
  const modificationNoeud = useMutation({
    mutationFn: ({ id, modification }: { id: string; modification: ModificationNoeud }) => api.modifierNoeud(id, modification),
    // Un nœud déplacé l'est tout de suite sur la carte ; la réponse de l'API le confirme.
    onMutate: ({ id, modification }) => {
      const position = modification.position
      if (position) queryClient.setQueriesData<ReseauGeoJson>({ queryKey: ['reseau'] }, (r) => r && deplacerDansLeCache(r, id, position))
    },
    onSuccess: rafraichir,
    onError: echec('Nœud non modifié'),
  })
  const fusion = useMutation({
    mutationFn: api.fusionnerNoeud,
    onSuccess: async () => {
      setSelection(null)
      await rafraichir()
    },
    onError: echec('Nœud non retiré'),
  })
  const liaisons = useMutation({
    mutationFn: ({ noeud, liaisons }: { noeud: string; liaisons: Liaison[] | null }) => api.enregistrerLiaisons(noeud, { liaisons }),
    // Affichée tout de suite ; la réponse de l'API la confirme.
    onMutate: ({ noeud, liaisons }) =>
      queryClient.setQueriesData<ReseauGeoJson>({ queryKey: ['reseau'] }, (reseau) =>
        reseau && {
          ...reseau,
          noeuds: {
            ...reseau.noeuds,
            features: reseau.noeuds.features.map((n) => (n.id === noeud ? { ...n, properties: { ...n.properties, liaisons } } : n)),
          },
        },
      ),
    onSuccess: rafraichir,
    onError: echec('Liaison non enregistrée'),
  })

  // ── Modifications qui s'annulent ──

  const modifierTroncon = (id: string, m: ModificationTroncon) => {
    const avant = tronconEnCache(id)
    modification.mutate(
      { id, modification: m },
      {
        onSuccess: () =>
          avant &&
          historique.enregistrer({
            libelle: libelleModification(m),
            annuler: () => rejouer(api.modifierTroncon(id, modificationInverse(m, avant))),
            refaire: () => rejouer(api.modifierTroncon(id, m)),
          }),
      },
    )
  }

  const modifierNoeud = (id: string, m: ModificationNoeud) => {
    const avant = noeudEnCache(id)
    modificationNoeud.mutate(
      { id, modification: m },
      {
        onSuccess: () => {
          if (!avant) return
          const p = avant.properties
          const inverse: ModificationNoeud = {
            ...(m.position && { position: avant.geometry.coordinates }),
            ...(m.feux !== undefined && { feux: p.feux }),
            ...(m.pieton !== undefined && { pieton: p.pieton }),
            ...(m.carrefour_id !== undefined && { carrefour_id: p.carrefour_id }),
          }
          historique.enregistrer({
            libelle: libelleNoeud(m),
            annuler: () => rejouer(api.modifierNoeud(id, inverse)),
            refaire: () => rejouer(api.modifierNoeud(id, m)),
          })
        },
      },
    )
  }

  const enregistrerLiaisons = (noeud: string, suivantes: Liaison[] | null) => {
    const avant = noeudEnCache(noeud)?.properties.liaisons ?? null
    liaisons.mutate(
      { noeud, liaisons: suivantes },
      {
        onSuccess: () =>
          historique.enregistrer({
            libelle: suivantes ? 'Liaisons du nœud' : 'Liaisons proposées',
            annuler: () => rejouer(api.enregistrerLiaisons(noeud, { liaisons: avant })),
            refaire: () => rejouer(api.enregistrerLiaisons(noeud, { liaisons: suivantes })),
          }),
      },
    )
  }

  /** Coupe un tronçon : le nœud posé peut porter une ligne d'arrêt ou un passage ; annuler le retire. */
  const couper = (id: string, coupeDemandee: CoupeTroncon) => {
    const avant = tronconEnCache(id)
    if (!avant || coupe.isPending) return
    const { noeud_de, noeud_vers } = avant.properties
    coupe.mutate(
      { id, coupe: coupeDemandee },
      {
        onSuccess: (noeud: Noeud) => {
          // Coupé tout près d'un bout : le nœud existait, seuls ses feux ou son passage ont pu changer.
          if (noeud.id === noeud_de || noeud.id === noeud_vers) return
          let pose = noeud.id
          historique.enregistrer({
            libelle: coupeDemandee.feux ? 'Ligne d’arrêt posée' : coupeDemandee.pieton ? 'Passage piéton posé' : 'Rue coupée',
            annuler: () => rejouer(api.fusionnerNoeud(pose)),
            refaire: async () => {
              const entier = tronconEntre(noeud_de, noeud_vers)
              if (!entier) throw new Error('Tronçon introuvable : déplacez la carte jusqu’à lui')
              pose = (await rejouer(api.couperTroncon(entier.id, coupeDemandee))).id
            },
          })
        },
      },
    )
  }

  /** Retire un nœud entre deux tronçons ; annuler recoupe le tronçon au même endroit, avec ce que portait le nœud. */
  const fusionner = (id: string) => {
    const avant = noeudEnCache(id)
    const autour = enCache()
      .flatMap((r) => r.troncons.features)
      .filter((t, i, liste) => (t.properties.noeud_de === id || t.properties.noeud_vers === id) && liste.findIndex((u) => u.id === t.id) === i)
    fusion.mutate(id, {
      onSuccess: () => {
        if (!avant || autour.length !== 2) return
        const [a, b] = autour.map((t) => (t.properties.noeud_de === id ? t.properties.noeud_vers : t.properties.noeud_de)) as [string, string]
        const { feux, pieton } = avant.properties
        let pose = id
        historique.enregistrer({
          libelle: 'Nœud retiré',
          annuler: async () => {
            const entier = tronconEntre(a, b)
            if (!entier) throw new Error('Tronçon introuvable : déplacez la carte jusqu’à lui')
            pose = (await rejouer(api.couperTroncon(entier.id, { position: avant.geometry.coordinates, feux, pieton }))).id
          },
          refaire: () => rejouer(api.fusionnerNoeud(pose)),
        })
      },
    })
  }

  /** Supprime (ou masque) le tronçon : ne s'annule pas, d'où la confirmation. */
  const supprimer = (id: string) => {
    const t = tronconEnCache(id)?.properties
    const message =
      t?.source === 'osm'
        ? 'Masquer ce tronçon OSM ? Il ne reviendra pas à la régénération. (Ne s’annule pas.)'
        : 'Supprimer ce tronçon ? (Ne s’annule pas.)'
    if (window.confirm(message)) suppression.mutate(id)
  }

  /** Ajoute la liaison au nœud, ou la retire ; les liaisons proposées deviennent saisies. */
  const basculerLiaison = (noeud: string, liaison: Liaison) => {
    const reseau = donnees.data
    if (!reseau) return
    const troncons = reseau.troncons.features
      .filter((t) => t.properties.noeud_de === noeud || t.properties.noeud_vers === noeud)
      .map((t) => ({ ...t.properties, points: t.geometry.coordinates }))
    const actuelles = liaisonsRetenues(boutsAuNoeud(noeud, troncons), reseau.noeuds.features.find((n) => n.id === noeud)?.properties.liaisons ?? null).liaisons
    const meme = (l: Liaison) => l.de === liaison.de && l.voie_de === liaison.voie_de && l.vers === liaison.vers && l.voie_vers === liaison.voie_vers
    enregistrerLiaisons(noeud, actuelles.some(meme) ? actuelles.filter((l) => !meme(l)) : [...actuelles, liaison])
  }

  /** Outil Nœuds : met le nœud dans le carrefour ouvert, ou l'en retire. */
  const basculerNoeud = (id: string) => {
    const noeud = donnees.data?.noeuds.features.find((n) => n.id === id)
    if (!noeud || !carrefourOuvert) return
    const actuel = noeud.properties.carrefour_id
    if (actuel && actuel !== carrefourOuvert.id) {
      notifications.create({ type: 'warning', title: 'Nœud déjà pris', description: `Il fait partie de ${nomCarrefour(actuel)} : l’en retirer d’abord.` })
      return
    }
    modifierNoeud(id, { carrefour_id: actuel ? null : carrefourOuvert.id })
  }

  /** Outil Voie : ajoute une voie du côté cliqué (au bord ou contre l'axe), ou retire celle visée. */
  const editerVoie = (cible: Extract<Cible, { type: 'troncon' }>, position: LonLat) => {
    const t = tronconEnCache(cible.id)
    if (!t) return
    const p = t.properties
    const sens = cible.voie?.sens ?? sensDuCote(t.geometry.coordinates, position, p)
    const nombre = sens === 'avant' ? p.voies_avant : p.voies_arriere
    const { voie } = reglages
    if (voie.action === 'ajouter') {
      if (nombre >= 9) return notifications.create({ type: 'warning', title: 'Neuf voies au plus par sens' })
      return modifierTroncon(t.id, { voie: { action: 'inserer', sens, rang: voie.position === 'bord' ? nombre : 0, type: voie.type } })
    }
    if (nombre === 0) return notifications.create({ type: 'warning', title: 'Aucune voie dans ce sens' })
    const autre = sens === 'avant' ? p.voies_arriere : p.voies_avant
    if (nombre === 1 && autre === 0) return notifications.create({ type: 'warning', title: 'Une rue garde au moins une voie', description: 'Supprimez le tronçon (Suppr) pour la retirer.' })
    modifierTroncon(t.id, { voie: { action: 'retirer', sens, rang: cible.voie?.rang ?? nombre - 1 } })
  }

  /** Outil Passage : pose un passage piéton sur le nœud (ou l'en retire s'il est déjà de ce type), ou coupe la rue avec un passage. */
  const poserPassage = (cible: Cible, position: LonLat) => {
    const type = reglages.passage.pieton
    if (cible?.type === 'noeud') {
      const actuel = noeudEnCache(cible.id)?.properties.pieton ?? null
      return modifierNoeud(cible.id, { pieton: actuel === type ? null : type })
    }
    if (cible?.type === 'troncon') couper(cible.id, { position, pieton: type })
  }

  /** Enregistre l'emprise en cours (trois sommets au moins). */
  const terminerEmprise = () => {
    const encours = empriseActuelle.current
    if (!encours || encours.points.length < 3) return
    changerEmprise(null)
    modifierTroncon(encours.troncon, { emprise: { sens: encours.sens, rang: encours.rang, polygone: encours.points } })
  }

  /** Outil Emprise : un clic sur une voie la vise, puis chaque clic pose un sommet ; revenir au premier ferme. */
  const clicEmprise = (cible: Cible, position: LonLat, memePoint: (a: LonLat, b: LonLat) => boolean) => {
    const encours = empriseActuelle.current
    if (!encours) {
      if (cible?.type !== 'troncon') return
      if (!cible.voie) return notifications.create({ type: 'info', title: 'Zoomez sur les voies', description: 'Une emprise se pose sur une voie : zoom 16 et plus.' })
      return changerEmprise({ troncon: cible.id, sens: cible.voie.sens, rang: cible.voie.rang, points: [] })
    }
    if (encours.points.length >= 3 && memePoint(encours.points[0]!, position)) return terminerEmprise()
    if (encours.points.length >= 40) return
    changerEmprise({ ...encours, points: [...encours.points, position] })
  }

  const generation = useMutation({
    mutationFn: (reinitialiser: boolean) => api.semerReseau(reinitialiser),
    onSuccess: async (bilan) => {
      historique.vider()
      await rafraichir()
      notifications.create({
        type: 'success',
        title: 'Réseau semé depuis OSM',
        description: `${bilan.troncons} tronçons (${bilan.cyclables} cyclables), ${bilan.noeuds} nœuds, ${bilan.feux} feux, ${bilan.pieton} passages piétons ; ${bilan.carrefours} carrefour(s) retrouvé(s).`,
      })
    },
    onError: (erreur) => notifications.create({ type: 'error', title: 'Semis impossible', description: erreur.message }),
  })

  const terminer = (suivant: Trace) => {
    const { nom, voies_avant, voies_arriere, type, vitesse_kmh } = reglages.tracer
    const types = (nombre: number) => (type === 'generale' ? null : Array.from({ length: nombre }, () => type))
    const nouveau: NouveauTroncon | null = versNouveauTroncon(suivant, { nom, voies_avant, voies_arriere, vitesse_kmh })
    if (nouveau && !creation.isPending) creation.mutate({ ...nouveau, types_avant: types(voies_avant), types_arriere: types(voies_arriere) })
  }

  /** Clic sur la carte ou sur une voie ; `outilActif` : celui du carrefour ouvert, s'il y en a un. */
  const clic = (position: LonLat, cible: Cible, memePoint: (a: LonLat, b: LonLat) => boolean, outilActif: OutilReseau | 'autre' = outil) => {
    if (outilActif === 'connecter' || outilActif === 'autre') return
    if (outilActif === 'selection') {
      modification.reset()
      modificationNoeud.reset()
      return setSelection(cible ? { type: cible.type, id: cible.id, position } : null)
    }
    if (outilActif === 'couper') {
      const { pose, pieton } = reglages.couper
      if (cible?.type === 'troncon') couper(cible.id, { position, ...(pose === 'feux' && { feux: true }), ...(pose === 'pieton' && { pieton }) })
      return
    }
    if (outilActif === 'noeuds') {
      if (cible?.type === 'noeud') basculerNoeud(cible.id)
      return
    }
    if (outilActif === 'voie') {
      if (cible?.type === 'troncon') editerVoie(cible, position)
      return
    }
    if (outilActif === 'passage') return poserPassage(cible, position)
    if (outilActif === 'emprise') return clicEmprise(cible, position, memePoint)
    if (creation.isPending) return
    const { trace: suivant, termine } = cliquer(traceActuel.current, position, cible, memePoint)
    changerTrace(suivant)
    if (termine) terminer(suivant)
  }

  const choisirOutil = (suivant: OutilReseau) => {
    setOutil(suivant)
    setSelection(null)
    changerTrace([])
    changerEmprise(null)
  }

  /** Ctrl Z / Ctrl Maj Z : annule ou refait la dernière modification du réseau. */
  const annulerOuRefaire = async (refaire: boolean) => {
    try {
      const operation = await (refaire ? historique.refaire() : historique.annuler())
      if (operation) notifications.create({ type: 'info', title: `${refaire ? 'Refait' : 'Annulé'} : ${operation.libelle}` })
      else notifications.create({ type: 'info', title: refaire ? 'Rien à refaire' : 'Rien à annuler' })
    } catch (erreur) {
      await rafraichir()
      notifications.create({ type: 'error', title: refaire ? 'Impossible de refaire' : 'Impossible d’annuler', description: (erreur as Error).message })
    }
  }

  /** Suppr : supprime le tronçon sélectionné, ou retire le nœud sélectionné (entre deux tronçons). */
  const supprimerSelection = (): boolean => {
    if (!selection) return false
    if (selection.type === 'troncon') supprimer(selection.id)
    else fusionner(selection.id)
    return true
  }

  /** Geste en cours (tracé, emprise) : Entrée, ⌫ et Échap lui reviennent avant tout autre raccourci. */
  const geste = trace.length > 0 || emprise !== null

  /** Entrée, ⌫ et Échap pendant un geste ; false s'il n'y en a pas. */
  const toucheGeste = (e: KeyboardEvent): boolean => {
    if (empriseActuelle.current) {
      if (e.key === 'Escape') return (changerEmprise(null), true)
      if (e.key === 'Enter') return (terminerEmprise(), true)
      if (e.key === 'Backspace') return (changerEmprise({ ...empriseActuelle.current, points: empriseActuelle.current.points.slice(0, -1) }), true)
      return false
    }
    if (traceActuel.current.length === 0) return false
    if (e.key === 'Escape') return (changerTrace([]), true)
    if (e.key === 'Enter' && traceActuel.current.length >= 2) return (terminer(traceActuel.current), true)
    if (e.key === 'Backspace') return (changerTrace(retirerDernier(traceActuel.current)), true)
    return false
  }

  /** Raccourcis du mode ; renvoie false pour Échap quand il n'y a plus rien à défaire (quitter le mode). */
  const clavier = (e: KeyboardEvent): boolean => {
    if (toucheGeste(e)) return true
    if (e.key === 'Escape') {
      if (selection) return (setSelection(null), true)
      if (outil !== 'selection') return (choisirOutil('selection'), true)
      return false
    }
    if (e.key === 'Delete') return (supprimerSelection(), true)
    const raccourci = RACCOURCIS_RESEAU[e.key.toLowerCase()]
    if (raccourci) choisirOutil(raccourci)
    return true
  }

  /** Échap dans un carrefour ouvert : annule le geste, puis ferme la popup ; false s'il n'y avait rien. */
  const echap = (): boolean => {
    if (empriseActuelle.current) return (changerEmprise(null), true)
    if (traceActuel.current.length > 0) return (changerTrace([]), true)
    if (selection) return (setSelection(null), true)
    return false
  }

  const troncon = selection?.type === 'troncon' ? donnees.data?.troncons.features.find((t) => t.id === selection.id) : undefined
  const noeud = selection?.type === 'noeud' ? donnees.data?.noeuds.features.find((n) => n.id === selection.id) : undefined

  return {
    outil,
    choisirOutil,
    reglages,
    changerReglages: setReglages,
    selection,
    fermerSelection: () => setSelection(null),
    selectionner: (type: SelectionReseau['type'], id: string, position: LonLat) => {
      modification.reset()
      modificationNoeud.reset()
      setSelection({ type, id, position })
    },
    basculerLiaison,
    basculerNoeud,
    /** Oublie les liaisons saisies au nœud : celles proposées par défaut reviennent. */
    liaisonsParDefaut: (noeud: string) => enregistrerLiaisons(noeud, null),
    echap,
    troncon,
    noeud,
    trace,
    emprise,
    geste,
    toucheGeste,
    clic,
    clavier,
    annulerOuRefaire,
    supprimerSelection,
    peutAnnuler: historique.peutAnnuler,
    peutRefaire: historique.peutRefaire,
    donnees,
    visible,
    creation,
    modifier: (m: ModificationTroncon) => selection?.type === 'troncon' && modifierTroncon(selection.id, m),
    modifierTroncon,
    modification,
    supprimer: () => selection?.type === 'troncon' && supprimer(selection.id),
    couper: (id: string, position: LonLat) => couper(id, { position }),
    modifierNoeud,
    modificationNoeud,
    fusionner,
    generation,
  }
}

/** Raccourcis des outils de l'éditeur des voies (hors carrefour ouvert). */
export const RACCOURCIS_RESEAU: Record<string, OutilReseau> = {
  v: 'selection',
  t: 'tracer',
  x: 'couper',
  c: 'connecter',
  l: 'voie',
  p: 'passage',
  e: 'emprise',
}
