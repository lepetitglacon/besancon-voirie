import type { CarrefourTempsReel } from '@voirie/schema'
import { useEffect, useMemo, useRef } from 'react'
import { useMap } from 'react-map-gl/maplibre'
import { CalqueCarrefour, type FeuPlacable } from '../configuration/calque/CalqueCarrefour'
import type { EtatFeu } from '../configuration/calque/elements'
import { feuxDesLignes } from '../configuration/programme'
import type { EtatLampe } from '../ds'
import { etatCarrefour, type EtatTempsReel } from '../tempsReel/etats'
import { approchesA, type ContexteTram } from '../tempsReel/priorite'
import { useMaintenant } from '../tempsReel/useMaintenant'
import { liaisonsDeLaLigne, usePlanCarrefour } from './donneesPlan'
import { EtiquettesFeux } from './PlanCarrefour'

/** Thème de la fiche : il décide des couches dessinées sur le carrefour. */
export type ThemeFiche = 'feux' | 'carrefour' | 'releves'

/** Écart entre la carte de gauche et le cadre du carrefour (px). */
const MARGE_CADRE_PX = 32

const rien = () => {}
const AUCUN_FEU_PLACABLE: FeuPlacable[] = []

const FEU: Partial<Record<EtatTempsReel, EtatFeu>> = { vert: 'vert', jaune: 'jaune', clignotant: 'jaune', rouge: 'rouge' }
const LAMPE: Record<EtatFeu, EtatLampe | null> = { vert: 'vert', jaune: 'orange', rouge: 'rouge', libre: null }

interface Props {
  carrefourId: string
  theme: ThemeFiche
  /** Ligne de feux mise en avant (thème Carrefour). */
  ligne: string | null
  onLigne: (code: string) => void
  /** Rejeu du carrefour en temps réel ; null s'il n'est pas programmé. */
  tempsReel: CarrefourTempsReel | null
  tram: ContexteTram | null
}

/**
 * Couches d'un carrefour ouvert dans la fiche, sur la grande carte, selon le thème :
 * - Feux : feux physiques étiquetés et liaisons, colorés selon l'état des lignes en ce moment ;
 * - Carrefour : voies, liaisons et passages (le calque de l'édition), la ligne choisie en avant ;
 * - Relevés : les feux étiquetés seuls, pour relire un relevé.
 * À l'ouverture, la carte se cadre sur l'espace utile du carrefour, à droite de la fiche.
 */
export function CouchesCarrefour({ carrefourId, theme, ligne, onLigne, tempsReel, tram }: Props) {
  const plan = usePlanCarrefour(carrefourId)
  const { current: carte } = useMap()
  const maintenant = useMaintenant(theme === 'feux' && tempsReel !== null)

  // Cadrage, une fois par carrefour, dès que son emprise est connue.
  const cadre = useRef<string | null>(null)
  useEffect(() => {
    if (!carte || !plan.emprise || cadre.current === carrefourId) return
    cadre.current = carrefourId
    const fiche = document.querySelector('[data-fiche-carrefour]')?.getBoundingClientRect()
    carte.fitBounds(plan.emprise, {
      padding: { left: (fiche?.right ?? 0) + MARGE_CADRE_PX, top: MARGE_CADRE_PX, right: MARGE_CADRE_PX, bottom: MARGE_CADRE_PX },
      maxZoom: 20,
    })
  }, [carte, plan.emprise, carrefourId])

  // État des lignes en ce moment (thème Feux) : couleur des liaisons et des étiquettes.
  const etats = useMemo(() => {
    if (theme !== 'feux' || !tempsReel) return null
    const { etats } = etatCarrefour(tempsReel, maintenant, approchesA(tram, maintenant).get(carrefourId))
    return new Map([...etats].flatMap(([code, etat]) => (FEU[etat] ? [[code, FEU[etat]!] as const] : [])))
  }, [theme, tempsReel, tram, maintenant, carrefourId])
  const feux = useMemo(
    () => (etats && plan.lignes && plan.branches ? feuxDesLignes(etats, plan.lignes.lignes, plan.branches.connexions) : null),
    [etats, plan.lignes, plan.branches],
  )
  const lampes = useMemo(() => (etats ? new Map([...etats].map(([code, etat]) => [code, LAMPE[etat]] as const)) : undefined), [etats])
  const surlignees = useMemo(() => (theme === 'carrefour' ? liaisonsDeLaLigne(plan, ligne) : new Set<string>()), [plan, ligne, theme])

  if (!plan.branches) return null
  return (
    <>
      {theme !== 'releves' && plan.branches.branches.length > 0 && (
        <CalqueCarrefour
          branches={plan.branches.branches}
          connexions={plan.branches.connexions}
          chainages={plan.branches.chainages}
          anneau={plan.branches.anneau}
          mode={null}
          surlignees={surlignees}
          feux={feux}
          onDeplacer={rien}
          onConnecter={rien}
          feuxPlacables={AUCUN_FEU_PLACABLE}
          onPlacerFeu={async () => {}}
          onApercuFeu={rien}
        />
      )}
      <EtiquettesFeux feux={plan.feux} ligne={theme === 'carrefour' ? ligne : null} etats={lampes} onLigne={onLigne} />
    </>
  )
}
