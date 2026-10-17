import { useQuery } from '@tanstack/react-query'
import type { BoxProps } from '@chakra-ui/react'
import { useMemo } from 'react'
import { Marker } from 'react-map-gl/maplibre'
import { api } from '../api'
import { CalqueCarrefour, type FeuPlacable } from '../configuration/calque/CalqueCarrefour'
import { Aide, EtiquetteFeu, MiniCarte, type EtatLampe } from '../ds'

/** Demi-côté (degrés) de l'emprise où chercher les feux autour du centre du carrefour. */
const RAYON_FEUX_DEG = 0.003

const rien = () => {}
const AUCUN_FEU_PLACABLE: FeuPlacable[] = []

interface Props extends Omit<BoxProps, 'children'> {
  carrefourId: string
  /** Ligne de feux mise en avant : ses mouvements et ses feux. */
  ligne?: string | null
  /** Clic sur l'étiquette d'un feu : sa (première) ligne. */
  onLigne?: (code: string) => void
  /** Couleur de chaque ligne en ce moment (relevé, temps réel) : borde l'étiquette de ses feux. */
  etats?: ReadonlyMap<string, EtatLampe | null>
}

/**
 * Plan d'un carrefour sur photo aérienne : voies et liaisons (le calque de l'édition, en lecture
 * seule), et chaque feu physique étiqueté du code de sa ligne. Sur place, il dit quel feu est F1.
 */
export function PlanCarrefour({ carrefourId, ligne = null, onLigne, etats, ...props }: Props) {
  const branches = useQuery({ queryKey: ['branches', carrefourId], queryFn: () => api.branches(carrefourId) })
  const lignes = useQuery({ queryKey: ['lignes', carrefourId], queryFn: () => api.lignes(carrefourId) })
  const centre = branches.data?.centre
  const feux = useQuery({
    queryKey: ['feux-carrefour', carrefourId],
    queryFn: () => {
      const [lon, lat] = centre!
      return api.feux([lon - RAYON_FEUX_DEG, lat - RAYON_FEUX_DEG, lon + RAYON_FEUX_DEG, lat + RAYON_FEUX_DEG])
    },
    enabled: centre !== undefined,
  })

  const sesFeux = useMemo(
    () =>
      (feux.data?.features ?? [])
        .filter((f) => f.properties.carrefour_id === carrefourId)
        .map((f) => ({
          id: f.id,
          position: f.geometry.coordinates,
          lignes: (lignes.data?.lignes ?? []).filter((l) => l.feux.includes(f.id)).map((l) => l.code),
        })),
    [feux.data, lignes.data, carrefourId],
  )
  const points = useMemo(() => {
    const voies = (branches.data?.branches ?? []).flatMap((b) => b.voies.flatMap((v) => v.geom))
    const tous = [...sesFeux.map((f) => f.position), ...voies]
    return tous.length > 0 ? tous : centre ? [centre] : []
  }, [branches.data, sesFeux, centre])
  const surlignees = useMemo(() => {
    const mouvements = new Set(lignes.data?.lignes.find((l) => l.code === ligne)?.mouvements ?? [])
    return new Set(
      (branches.data?.connexions ?? [])
        .filter((c) => mouvements.has(`${c.de.split(':')[0]}>${c.vers.split(':')[0]}`))
        .map((c) => `${c.de}>${c.vers}`),
    )
  }, [branches.data, lignes.data, ligne])

  if (branches.isPending || feux.isPending) return <Aide>Chargement du plan…</Aide>
  if (!branches.data) return null
  return (
    // La clé recadre la carte quand les points arrivent (le cadrage initial ne se rejoue pas).
    <MiniCarte key={points.length} points={points} {...props}>
      {branches.data.branches.length > 0 && (
        <CalqueCarrefour
          branches={branches.data.branches}
          connexions={branches.data.connexions}
          chainages={branches.data.chainages}
          anneau={branches.data.anneau}
          mode={null}
          surlignees={surlignees}
          onDeplacer={rien}
          onConnecter={rien}
          feuxPlacables={AUCUN_FEU_PLACABLE}
          onPlacerFeu={async () => {}}
          onApercuFeu={rien}
        />
      )}
      {sesFeux.map((f) => (
        <Marker key={f.id} longitude={f.position[0]} latitude={f.position[1]}>
          <EtiquetteFeu
            lignes={f.lignes}
            actif={ligne !== null && f.lignes.includes(ligne)}
            etat={f.lignes.map((code) => etats?.get(code)).find((e) => e) ?? null}
            cursor={onLigne && f.lignes.length > 0 ? 'pointer' : undefined}
            onClick={() => f.lignes[0] && onLigne?.(f.lignes[0])}
          />
        </Marker>
      ))}
    </MiniCarte>
  )
}
