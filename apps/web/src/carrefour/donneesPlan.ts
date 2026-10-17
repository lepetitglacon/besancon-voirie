import { useQuery } from '@tanstack/react-query'
import { empriseCarrefour, type Emprise, type LonLat } from '@voirie/engine'
import type { BranchesCarrefour, LignesCarrefour } from '@voirie/schema'
import { useMemo } from 'react'
import { api } from '../api'

/** Demi-côté (degrés) de l'emprise où chercher les feux autour du centre du carrefour. */
const RAYON_FEUX_DEG = 0.003

/** Un feu physique du carrefour et les lignes de feux qu'il affiche. */
export interface FeuEtiquete {
  id: string
  position: LonLat
  lignes: string[]
}

export interface PlanCarrefourDonnees {
  chargement: boolean
  branches: BranchesCarrefour | undefined
  lignes: LignesCarrefour | undefined
  feux: FeuEtiquete[]
  /** Espace utile du carrefour (lignes d'arrêt, passages, feux) ; null tant qu'il n'est pas connu. */
  emprise: Emprise | null
}

/** Branches, lignes de feux et feux physiques d'un carrefour : ce que son plan dessine. */
export function usePlanCarrefour(carrefourId: string): PlanCarrefourDonnees {
  const branches = useQuery({ queryKey: ['branches', carrefourId], queryFn: () => api.branches(carrefourId) })
  const lignes = useQuery({ queryKey: ['lignes', carrefourId], queryFn: () => api.lignes(carrefourId) })
  const centre = branches.data?.centre
  const feuxEmprise = useQuery({
    queryKey: ['feux-carrefour', carrefourId],
    queryFn: () => {
      const [lon, lat] = centre!
      return api.feux([lon - RAYON_FEUX_DEG, lat - RAYON_FEUX_DEG, lon + RAYON_FEUX_DEG, lat + RAYON_FEUX_DEG])
    },
    enabled: centre !== undefined,
  })

  const feux = useMemo(
    () =>
      (feuxEmprise.data?.features ?? [])
        .filter((f) => f.properties.carrefour_id === carrefourId)
        .map(
          (f): FeuEtiquete => ({
            id: f.id,
            position: f.geometry.coordinates,
            lignes: (lignes.data?.lignes ?? []).filter((l) => l.feux.includes(f.id)).map((l) => l.code),
          }),
        ),
    [feuxEmprise.data, lignes.data, carrefourId],
  )
  const emprise = useMemo(() => {
    if (!branches.data) return null
    const calculee = empriseCarrefour(branches.data.branches, feux.map((f) => f.position))
    if (calculee) return calculee
    const [lon, lat] = branches.data.centre
    return empriseCarrefour([], [[lon, lat]])
  }, [branches.data, feux])

  return { chargement: branches.isPending || feuxEmprise.isPending, branches: branches.data, lignes: lignes.data, feux, emprise }
}

/** Liaisons (« de>vers ») des mouvements d'une ligne de feux : ce qu'on met en avant quand on la choisit. */
export function liaisonsDeLaLigne(plan: PlanCarrefourDonnees, ligne: string | null): Set<string> {
  const mouvements = new Set(plan.lignes?.lignes.find((l) => l.code === ligne)?.mouvements ?? [])
  return new Set(
    (plan.branches?.connexions ?? [])
      .filter((c) => mouvements.has(`${c.de.split(':')[0]}>${c.vers.split(':')[0]}`))
      .map((c) => `${c.de}>${c.vers}`),
  )
}
