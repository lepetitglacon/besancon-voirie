/**
 * Mode « Réseau » de la carte : outil actif, tronçon sélectionné, tracé en cours, données de
 * l'emprise et enregistrements (chaque changement part aussitôt à l'API).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { LonLat } from '@voirie/engine'
import type { Bbox, ModificationTroncon } from '@voirie/schema'
import { useRef, useState } from 'react'
import { api } from '../api'
import { notifications } from '../ds'
import type { OutilReseau } from './CoucheReseau'
import { cliquer, retirerDernier, versNouveauTroncon, type Cible, type Trace } from './trace'

/** En dessous, l'emprise contient trop de tronçons : on ne les charge pas. */
export const ZOOM_MIN_RESEAU = 14

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

  const clic = (position: LonLat, cible: Cible, memePoint: (a: LonLat, b: LonLat) => boolean) => {
    if (outil === 'selection') {
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
    return true
  }

  const troncon = selection ? donnees.data?.troncons.features.find((t) => t.id === selection.id) : undefined

  return {
    outil,
    choisirOutil,
    selection,
    fermerSelection: () => setSelection(null),
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
