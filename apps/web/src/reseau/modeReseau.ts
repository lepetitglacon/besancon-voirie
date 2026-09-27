/**
 * Éditeur des voies (docs/RESEAU.md §7), à la TM:PE : outil actif quand aucun carrefour n'est
 * ouvert, tronçon ou nœud sélectionné, tracé en cours, données de l'emprise et modifications du
 * réseau. Chaque changement part aussitôt à l'API ; les carrefours touchés sont recalculés par
 * le serveur, leurs branches, lignes et programme relus.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { boutsAuNoeud, liaisonsRetenues, type Liaison, type LonLat } from '@voirie/engine'
import type { Bbox, ModificationNoeud, ModificationTroncon, ReseauGeoJson } from '@voirie/schema'
import { useRef, useState } from 'react'
import { api } from '../api'
import { notifications } from '../ds'
import type { OutilReseau } from './CoucheReseau'
import { cliquer, retirerDernier, versNouveauTroncon, type Cible, type Trace } from './trace'

/** En dessous, l'emprise contient trop de tronçons : on ne les charge pas. */
export const ZOOM_MIN_RESEAU = 14
/** À partir de ce zoom, les rues sont dessinées voie par voie, comme les carrefours. */
export const ZOOM_VOIES = 16

/** Valeurs d'un tronçon tracé : une voie par sens, vitesse du type de voie ; à corriger ensuite. */
const PAR_DEFAUT = { nom: null, voies_avant: 1, voies_arriere: 1, vitesse_kmh: null }

/** Tronçon ou nœud dont la popup est ouverte, ancrée au point cliqué. */
export type SelectionReseau = { type: 'troncon' | 'noeud'; id: string; position: LonLat }

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

export function useModeReseau({ actif, bbox, zoom, carrefourOuvert, nomCarrefour }: Options) {
  const queryClient = useQueryClient()
  const [outil, setOutil] = useState<OutilReseau>('selection')
  const [selection, setSelection] = useState<SelectionReseau | null>(null)
  const [trace, setTrace] = useState<Trace>([])
  // Le tracé courant, lu par les gestionnaires d'évènements sans attendre un rendu.
  const traceActuel = useRef<Trace>([])
  const changerTrace = (suivant: Trace) => {
    traceActuel.current = suivant
    setTrace(suivant)
  }

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

  const creation = useMutation({
    mutationFn: api.creerTroncon,
    onSuccess: async (troncon) => {
      changerTrace([])
      await rafraichir()
      const milieu = troncon.geometry.coordinates[Math.floor(troncon.geometry.coordinates.length / 2)]!
      setSelection({ type: 'troncon', id: troncon.id, position: milieu })
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
      await rafraichir()
    },
  })
  const coupe = useMutation({
    mutationFn: ({ id, position }: { id: string; position: LonLat }) => api.couperTroncon(id, position),
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

  /** Ajoute la liaison au nœud, ou la retire ; les liaisons proposées deviennent saisies. */
  const basculerLiaison = (noeud: string, liaison: Liaison) => {
    const reseau = donnees.data
    if (!reseau) return
    const troncons = reseau.troncons.features
      .filter((t) => t.properties.noeud_de === noeud || t.properties.noeud_vers === noeud)
      .map((t) => ({ ...t.properties, points: t.geometry.coordinates }))
    const actuelles = liaisonsRetenues(boutsAuNoeud(noeud, troncons), reseau.noeuds.features.find((n) => n.id === noeud)?.properties.liaisons ?? null).liaisons
    const meme = (l: Liaison) => l.de === liaison.de && l.voie_de === liaison.voie_de && l.vers === liaison.vers && l.voie_vers === liaison.voie_vers
    liaisons.mutate({ noeud, liaisons: actuelles.some(meme) ? actuelles.filter((l) => !meme(l)) : [...actuelles, liaison] })
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
    modificationNoeud.mutate({ id, modification: { carrefour_id: actuel ? null : carrefourOuvert.id } })
  }

  const generation = useMutation({
    mutationFn: (reinitialiser: boolean) => api.semerReseau(reinitialiser),
    onSuccess: async (bilan) => {
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
    const nouveau = versNouveauTroncon(suivant, PAR_DEFAUT)
    if (nouveau && !creation.isPending) creation.mutate(nouveau)
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
      if (cible?.type === 'troncon' && !coupe.isPending) coupe.mutate({ id: cible.id, position })
      return
    }
    if (outilActif === 'noeuds') {
      if (cible?.type === 'noeud') basculerNoeud(cible.id)
      return
    }
    if (creation.isPending) return
    const { trace: suivant, termine } = cliquer(traceActuel.current, position, cible, memePoint)
    changerTrace(suivant)
    if (termine) terminer(suivant)
  }

  const choisirOutil = (suivant: OutilReseau) => {
    setOutil(suivant)
    setSelection(null)
    changerTrace([])
  }

  /** Raccourcis du mode ; renvoie false pour Échap quand il n'y a plus rien à défaire (quitter le mode). */
  const clavier = (e: KeyboardEvent): boolean => {
    const lettre = e.key.toLowerCase()
    if (e.key === 'Escape') {
      if (traceActuel.current.length > 0) return (changerTrace([]), true)
      if (selection) return (setSelection(null), true)
      if (outil !== 'selection') return (choisirOutil('selection'), true)
      return false
    }
    if (e.key === 'Enter' && traceActuel.current.length >= 2) return (terminer(traceActuel.current), true)
    if (e.key === 'Backspace' && traceActuel.current.length > 0) return (changerTrace(retirerDernier(traceActuel.current)), true)
    const raccourci = RACCOURCIS_RESEAU[lettre]
    if (raccourci) choisirOutil(raccourci)
    return true
  }

  /** Échap dans un carrefour ouvert : annule le tracé, puis ferme la popup ; false s'il n'y avait rien. */
  const echap = (): boolean => {
    if (traceActuel.current.length > 0) return (changerTrace([]), true)
    if (selection) return (setSelection(null), true)
    return false
  }

  const troncon = selection?.type === 'troncon' ? donnees.data?.troncons.features.find((t) => t.id === selection.id) : undefined
  const noeud = selection?.type === 'noeud' ? donnees.data?.noeuds.features.find((n) => n.id === selection.id) : undefined

  return {
    outil,
    choisirOutil,
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
    liaisonsParDefaut: (noeud: string) => liaisons.mutate({ noeud, liaisons: null }),
    echap,
    troncon,
    noeud,
    trace,
    clic,
    clavier,
    donnees,
    visible,
    creation,
    modifier: (m: ModificationTroncon) => selection?.type === 'troncon' && modification.mutate({ id: selection.id, modification: m }),
    modification,
    supprimer: () => selection?.type === 'troncon' && suppression.mutate(selection.id),
    couper: (id: string, position: LonLat) => coupe.mutate({ id, position }),
    modifierNoeud: (id: string, m: ModificationNoeud) => modificationNoeud.mutate({ id, modification: m }),
    modificationNoeud,
    fusionner: (id: string) => fusion.mutate(id),
    generation,
  }
}

/** Raccourcis des outils de l'éditeur des voies (hors carrefour ouvert). */
export const RACCOURCIS_RESEAU: Record<string, OutilReseau> = { v: 'selection', t: 'tracer', x: 'couper', c: 'connecter' }
