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

/** Mesure affichée sur la carte ; `id` la relie à une mesure enregistrée (null : pas encore enregistrée). */
export interface MesureCourante {
  id: string | null
  nom: string
  points: LonLat[]
}

export type OngletMesure = 'mesure' | 'enregistrees'

const VIDE: MesureCourante = { id: null, nom: '', points: [] }

/** Mesure de distance en cours, point visé (carte ou frise) et mesures enregistrées. */
export function useMesures() {
  const [courante, setCourante] = useState<MesureCourante | null>(null)
  const [visee, setVisee] = useState<number | null>(null)
  const [onglet, setOnglet] = useState<OngletMesure>('mesure')
  // Enveloppée dans un objet : usePreference fusionne les objets avec la valeur par défaut.
  const [stock, setStock] = usePreference<{ liste: MesureEnregistree[] }>('mesures', { liste: [] })
  const enregistrees = stock.liste

  const changerPoints = (modifier: (points: LonLat[]) => LonLat[]) =>
    setCourante((c) => c && { ...c, points: modifier(c.points) })
  const enregistree = courante?.id ? enregistrees.find((m) => m.id === courante.id) : undefined

  return {
    courante,
    visee,
    setVisee,
    onglet,
    setOnglet,
    enregistrees,
    /** La mesure courante diffère de sa version enregistrée (ou n'a jamais été enregistrée). */
    modifiee:
      !!courante &&
      (!enregistree ||
        enregistree.nom !== courante.nom ||
        JSON.stringify(enregistree.points) !== JSON.stringify(courante.points)),

    commencer: (point: LonLat) => {
      setCourante({ ...VIDE, points: [point] })
      setOnglet('mesure')
    },
    ouvrirListe: () => {
      setCourante((c) => c ?? VIDE)
      setOnglet('enregistrees')
    },
    fermer: () => {
      setCourante(null)
      setVisee(null)
    },
    nouvelle: () => {
      setCourante(VIDE)
      setOnglet('mesure')
    },
    renommerCourante: (nom: string) => setCourante((c) => c && { ...c, nom }),
    ajouter: (point: LonLat) => changerPoints((points) => [...points, point]),
    deplacer: (i: number, point: LonLat) => changerPoints((points) => points.map((p, k) => (k === i ? point : p))),
    retirer: (i: number) => {
      changerPoints((points) => points.filter((_, k) => k !== i))
      setVisee(null)
    },
    retirerDernier: () => changerPoints((points) => points.slice(0, -1)),

    /** Crée la mesure enregistrée, ou met à jour celle d'où vient la mesure courante. */
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
    ouvrir: (mesure: MesureEnregistree) => {
      setCourante({ id: mesure.id, nom: mesure.nom, points: mesure.points })
      setOnglet('mesure')
    },
    renommer: (id: string, nom: string) => {
      setStock(({ liste }) => ({ liste: liste.map((m) => (m.id === id ? { ...m, nom } : m)) }))
      setCourante((c) => (c?.id === id ? { ...c, nom } : c))
    },
    supprimer: (mesure: MesureEnregistree) => {
      setStock(({ liste }) => ({ liste: liste.filter((m) => m.id !== mesure.id) }))
      // La mesure ouverte reste à l'écran, détachée : elle peut être réenregistrée.
      setCourante((c) => (c?.id === mesure.id ? { ...c, id: null } : c))
      notifications.create({
        type: 'info',
        title: 'Mesure supprimée',
        description: mesure.nom,
        action: {
          label: 'Annuler',
          onClick: () => {
            setStock(({ liste }) => ({ liste: [mesure, ...liste.filter((m) => m.id !== mesure.id)] }))
            // La mesure détachée à la suppression retrouve son enregistrement.
            setCourante((c) => (c && c.id === null && c.nom === mesure.nom ? { ...c, id: mesure.id } : c))
          },
        },
      })
    },
  }
}

export type Mesures = ReturnType<typeof useMesures>
