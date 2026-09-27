/**
 * Éditeur des voies (docs/RESEAU.md §7) : outil actif quand aucun carrefour n'est ouvert, tronçon
 * sélectionné, tracé en cours, données de l'emprise et enregistrements des rues (chaque
 * changement part aussitôt à l'API ; ceux d'un carrefour attendent son « Enregistrer »).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { boutsAuNoeud, liaisonsRetenues, type Liaison, type LonLat } from '@voirie/engine'
import type { Bbox, ModificationTroncon, ReseauGeoJson } from '@voirie/schema'
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

export function useModeReseau({ actif, bbox, zoom }: { actif: boolean; bbox: Bbox | undefined; zoom: number }) {
  const queryClient = useQueryClient()
  const [outil, setOutil] = useState<OutilReseau>('selection')
  const [selection, setSelection] = useState<{ id: string; position: LonLat } | null>(null)
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
  const rafraichir = () => queryClient.invalidateQueries({ queryKey: ['reseau'] })

  const creation = useMutation({
    mutationFn: api.creerTroncon,
    onSuccess: async (troncon) => {
      changerTrace([])
      await rafraichir()
      setSelection({ id: troncon.id, position: troncon.geometry.coordinates[Math.floor(troncon.geometry.coordinates.length / 2)]! })
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
    // Les tronçons du nœud sont désormais « corrigés » : la carte suit.
    onSuccess: rafraichir,
    onError: async (erreur) => {
      await rafraichir()
      notifications.create({ type: 'error', title: 'Liaison non enregistrée', description: erreur.message })
    },
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

  const generation = useMutation({
    mutationFn: api.genererReseau,
    onSuccess: async (bilan) => {
      await rafraichir()
      notifications.create({
        type: 'success',
        title: 'Réseau généré depuis OSM',
        description: `${bilan.troncons} tronçons, ${bilan.noeuds} nœuds ; ${bilan.conserves} corrections gardées, ${bilan.carrefours} carrefour(s) raccordé(s).`,
      })
    },
    onError: (erreur) => notifications.create({ type: 'error', title: 'Génération impossible', description: erreur.message }),
  })

  const terminer = (suivant: Trace) => {
    const nouveau = versNouveauTroncon(suivant, PAR_DEFAUT)
    if (nouveau && !creation.isPending) creation.mutate(nouveau)
  }

  /** Clic sur la carte ; `outilActif` : celui du carrefour ouvert, s'il y en a un. */
  const clic = (position: LonLat, cible: Cible, memePoint: (a: LonLat, b: LonLat) => boolean, outilActif: OutilReseau | 'autre' = outil) => {
    if (outilActif === 'connecter' || outilActif === 'autre') return
    if (outilActif === 'selection') {
      modification.reset()
      return setSelection(cible?.type === 'troncon' ? { id: cible.id, position } : null)
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
    if (lettre === 'v') return (choisirOutil('selection'), true)
    if (lettre === 't') return (choisirOutil('tracer'), true)
    if (lettre === 'c') return (choisirOutil('connecter'), true)
    return true
  }

  const troncon = selection ? donnees.data?.troncons.features.find((t) => t.id === selection.id) : undefined

  return {
    outil,
    choisirOutil,
    selection,
    fermerSelection: () => setSelection(null),
    selectionner: (id: string, position: LonLat) => {
      modification.reset()
      setSelection({ id, position })
    },
    basculerLiaison,
    troncon,
    trace,
    clic,
    clavier,
    donnees,
    visible,
    creation,
    modifier: (m: ModificationTroncon) => selection && modification.mutate({ id: selection.id, modification: m }),
    modification,
    supprimer: () => selection && suppression.mutate(selection.id),
    generation,
  }
}
