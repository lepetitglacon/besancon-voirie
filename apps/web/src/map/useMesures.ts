import type { LonLat } from '@voirie/engine'
import { useState } from 'react'
import { notifications } from '../ds'
import { usePreference } from '../preferences'

/** Mesure gardée dans le navigateur (localStorage), propre à ce poste. */
export interface MesureEnregistree {
  id: string
  nom: string
  points: LonLat[]
  /** Date ISO de la dernière modification. */
  modifieeLe: string
}

/** Mesure en édition ; `id` la relie à une mesure enregistrée (null : pas encore enregistrée). */
export interface MesureCourante {
  id: string | null
  nom: string
  points: LonLat[]
}

const VIDE: MesureCourante = { id: null, nom: '', points: [] }

/**
 * Mesures de distance. Deux états exclusifs : la liste (panneau latéral, toutes les mesures
 * enregistrées affichées en lecture seule) et l'édition d'une seule mesure (frise en bas).
 */
export function useMesures() {
  const [courante, setCourante] = useState<MesureCourante | null>(null)
  const [liste, setListe] = useState(false)
  /** Point visé de la mesure en édition (survol sur la carte ou dans la frise). */
  const [visee, setVisee] = useState<number | null>(null)
  /** Mesure survolée dans la liste, surlignée sur la carte. */
  const [survolee, setSurvolee] = useState<string | null>(null)
  // Enveloppée dans un objet : usePreference fusionne les objets avec la valeur par défaut.
  const [stock, setStock] = usePreference<{ liste: MesureEnregistree[] }>('mesures', { liste: [] })
  const enregistrees = stock.liste

  const enregistree = courante?.id ? enregistrees.find((m) => m.id === courante.id) : undefined
  const modifiee =
    !!courante &&
    (!enregistree || enregistree.nom !== courante.nom || JSON.stringify(enregistree.points) !== JSON.stringify(courante.points))

  const changerPoints = (modifier: (points: LonLat[]) => LonLat[]) =>
    setCourante((c) => c && { ...c, points: modifier(c.points) })

  /** Quitte l'édition ; des changements non enregistrés restent récupérables un moment. */
  const quitterEdition = () => {
    if (courante && modifiee && courante.points.length > 1) {
      const abandonnee = courante
      notifications.create({
        type: 'info',
        title: 'Mesure non enregistrée fermée',
        action: { label: 'Reprendre', onClick: () => (setListe(false), setCourante(abandonnee)) },
      })
    }
    setCourante(null)
    setVisee(null)
  }

  return {
    courante,
    liste,
    visee,
    setVisee,
    survolee,
    setSurvolee,
    enregistrees,
    /** La mesure en édition diffère de sa version enregistrée (ou n'a jamais été enregistrée). */
    modifiee,

    commencer: (points: LonLat[] = []) => {
      setListe(false)
      setCourante({ ...VIDE, points })
    },
    ouvrirListe: () => {
      quitterEdition()
      setListe(true)
    },
    fermerListe: () => {
      setListe(false)
      setSurvolee(null)
    },
    fermer: quitterEdition,
    editer: (mesure: MesureEnregistree) => {
      setListe(false)
      setSurvolee(null)
      setCourante({ id: mesure.id, nom: mesure.nom, points: mesure.points })
    },

    renommer: (nom: string) => setCourante((c) => c && { ...c, nom }),
    ajouter: (point: LonLat) => changerPoints((points) => [...points, point]),
    deplacer: (i: number, point: LonLat) => changerPoints((points) => points.map((p, k) => (k === i ? point : p))),
    retirer: (i: number) => {
      changerPoints((points) => points.filter((_, k) => k !== i))
      setVisee(null)
    },
    retirerDernier: () => changerPoints((points) => points.slice(0, -1)),

    /** Crée la mesure enregistrée, ou met à jour celle qu'on édite. */
    enregistrer: () => {
      if (!courante) return
      const id = courante.id ?? crypto.randomUUID()
      const nom = courante.nom.trim() || `Mesure du ${new Date().toLocaleDateString('fr-FR')}`
      const mesure: MesureEnregistree = { id, nom, points: courante.points, modifieeLe: new Date().toISOString() }
      setStock(({ liste }) => ({
        liste: liste.some((m) => m.id === id) ? liste.map((m) => (m.id === id ? mesure : m)) : [mesure, ...liste],
      }))
      setCourante({ id, nom, points: courante.points })
    },
    supprimer: (mesure: MesureEnregistree) => {
      setStock(({ liste }) => ({ liste: liste.filter((m) => m.id !== mesure.id) }))
      setSurvolee(null)
      notifications.create({
        type: 'info',
        title: 'Mesure supprimée',
        description: mesure.nom,
        action: {
          label: 'Annuler',
          onClick: () => setStock(({ liste }) => ({ liste: [mesure, ...liste.filter((m) => m.id !== mesure.id)] })),
        },
      })
    },
  }
}

export type Mesures = ReturnType<typeof useMesures>
