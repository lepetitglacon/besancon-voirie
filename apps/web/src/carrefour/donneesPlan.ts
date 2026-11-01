import { useQuery } from '@tanstack/react-query'
import { empriseCarrefour, type Emprise, type LonLat } from '@voirie/engine'
import type { BranchesCarrefour, LignesCarrefour } from '@voirie/schema'
import { useMemo } from 'react'
import { api } from '../api'

/** Demi-côté (degrés) de l'emprise où chercher les feux autour du centre du carrefour. */
const RAYON_FEUX_DEG = 0.003

/**
 * Où dessiner le code d'une ligne de feux : un feu physique qui l'affiche, ou, si aucun ne lui est
 * rattaché, la ligne d'arrêt de chaque voie qu'elle commande (le milieu de chaque passage pour une
 * ligne piétonne). Même règle que le rejeu en temps réel côté API.
 */
export interface FeuEtiquete {
  id: string
  position: LonLat
  lignes: string[]
  /** Position déduite des voies : aucun feu physique n'est rattaché à la ligne. */
  deduit: boolean
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

  const feux = useMemo(() => {
    const physiques = feuxEmprise.data?.features.filter((f) => f.properties.carrefour_id === carrefourId) ?? []
    return etiquettes(physiques, lignes.data, branches.data)
  }, [feuxEmprise.data, lignes.data, branches.data, carrefourId])
  const emprise = useMemo(() => {
    if (!branches.data) return null
    const calculee = empriseCarrefour(branches.data.branches, feux.map((f) => f.position))
    if (calculee) return calculee
    const [lon, lat] = branches.data.centre
    return empriseCarrefour([], [[lon, lat]])
  }, [branches.data, feux])

  return { chargement: branches.isPending || feuxEmprise.isPending, branches: branches.data, lignes: lignes.data, feux, emprise }
}

const brancheDe = (cleVoie: string) => cleVoie.split(':')[0]!

const milieu = ([a, b]: readonly [LonLat, LonLat]): LonLat => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]

/** Étiquettes des lignes : sur leurs feux physiques, à défaut sur leurs voies ; les feux sans ligne n'en ont pas. */
function etiquettes(
  feuxPhysiques: ReadonlyArray<{ id: string; geometry: { coordinates: LonLat } }>,
  lignes: LignesCarrefour | undefined,
  branches: BranchesCarrefour | undefined,
): FeuEtiquete[] {
  const toutes = lignes?.lignes ?? []
  const physiques = feuxPhysiques.flatMap((f): FeuEtiquete[] => {
    const codes = toutes.filter((l) => l.feux.includes(f.id)).map((l) => l.code)
    return codes.length > 0 ? [{ id: f.id, position: f.geometry.coordinates, lignes: codes, deduit: false }] : []
  })
  const placees = new Set(physiques.flatMap((f) => f.lignes))
  const deduites = toutes
    .filter((l) => !placees.has(l.code))
    .flatMap((l): FeuEtiquete[] => {
      if (l.traverse) {
        const passages = branches?.branches.find((b) => b.code === l.traverse)?.passages ?? []
        return passages.map((p, i) => ({ id: `${l.code}@${l.traverse}:p${i}`, position: milieu(p), lignes: [l.code], deduit: true }))
      }
      // Une étiquette par voie entrante qui porte un mouvement de la ligne, à sa ligne d'arrêt.
      const voies = new Set(
        (branches?.connexions ?? []).filter((c) => l.mouvements.includes(`${brancheDe(c.de)}>${brancheDe(c.vers)}`)).map((c) => c.de),
      )
      return [...voies].flatMap((cle) => {
        const [code, voie] = cle.split(':')
        const rang = Number(voie!.slice(1))
        const geom = branches?.branches.find((b) => b.code === code)?.voies.find((v) => v.sens === 'entrante' && v.rang === rang)?.geom
        return geom ? [{ id: `${l.code}@${cle}`, position: geom[0], lignes: [l.code], deduit: true }] : []
      })
    })
  return [...physiques, ...deduites]
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
