import type { BoxProps } from '@chakra-ui/react'
import { useMemo } from 'react'
import { Marker } from 'react-map-gl/maplibre'
import { CalqueCarrefour, type FeuPlacable } from '../configuration/calque/CalqueCarrefour'
import { Aide, EtiquetteFeu, MiniCarte, type EtatLampe } from '../ds'
import { liaisonsDeLaLigne, usePlanCarrefour, type FeuEtiquete } from './donneesPlan'

const rien = () => {}
const AUCUN_FEU_PLACABLE: FeuPlacable[] = []

interface Props extends Omit<BoxProps, 'children'> {
  carrefourId: string
  /** Ligne de feux mise en avant : ses mouvements et ses feux. */
  ligne?: string | null
  /** Clic sur l'étiquette d'un feu : sa (première) ligne. */
  onLigne?: (code: string) => void
  /** Couleur de chaque ligne en ce moment (relevé) : borde l'étiquette de ses feux. */
  etats?: ReadonlyMap<string, EtatLampe | null>
}

/**
 * Plan d'un carrefour sur photo aérienne, cadré sur son espace utile : voies et liaisons (le calque
 * de l'édition, en lecture seule) et chaque feu physique étiqueté du code de sa ligne. Sur le
 * téléphone, devant le feu, il dit quel feu est F1.
 */
export function PlanCarrefour({ carrefourId, ligne = null, onLigne, etats, ...props }: Props) {
  const plan = usePlanCarrefour(carrefourId)
  const surlignees = useMemo(() => liaisonsDeLaLigne(plan, ligne), [plan, ligne])

  if (plan.chargement) return <Aide>Chargement du plan…</Aide>
  if (!plan.branches || !plan.emprise) return null
  return (
    // La clé recadre la carte si l'emprise change (le cadrage initial ne se rejoue pas).
    <MiniCarte key={plan.emprise.join()} emprise={plan.emprise} {...props}>
      {plan.branches.branches.length > 0 && (
        <CalqueCarrefour
          branches={plan.branches.branches}
          connexions={plan.branches.connexions}
          chainages={plan.branches.chainages}
          anneau={plan.branches.anneau}
          mode={null}
          surlignees={surlignees}
          onDeplacer={rien}
          onConnecter={rien}
          feuxPlacables={AUCUN_FEU_PLACABLE}
          onPlacerFeu={async () => {}}
          onApercuFeu={rien}
        />
      )}
      <EtiquettesFeux feux={plan.feux} ligne={ligne} etats={etats} onLigne={onLigne} />
    </MiniCarte>
  )
}

interface PropsEtiquettes {
  feux: readonly FeuEtiquete[]
  ligne: string | null
  etats?: ReadonlyMap<string, EtatLampe | null>
  onLigne?: (code: string) => void
}

/** Étiquette de chaque feu physique, à sa position, sur la carte qui l'entoure. */
export function EtiquettesFeux({ feux, ligne, etats, onLigne }: PropsEtiquettes) {
  return feux.map((f) => (
    <Marker key={f.id} longitude={f.position[0]} latitude={f.position[1]}>
      <EtiquetteFeu
        lignes={f.lignes}
        actif={ligne !== null && f.lignes.includes(ligne)}
        etat={f.lignes.map((code) => etats?.get(code)).find((e) => e) ?? null}
        cursor={onLigne && f.lignes.length > 0 ? 'pointer' : undefined}
        onClick={() => f.lignes[0] && onLigne?.(f.lignes[0])}
      />
    </Marker>
  ))
}
