/**
 * Éléments SVG du calque de configuration. Chacun reçoit des coordonnées déjà projetées en
 * pixels et un état, rendu par des classes CSS (voir index.css, « Calque de configuration »).
 */
import type { XY } from '@voirie/engine'
import type { PointerEvent, ReactNode } from 'react'
import { cheminConnexion } from './chemins'

const d = (points: readonly XY[]) => points.map(([x, y], i) => `${i ? 'L' : 'M'}${x},${y}`).join(' ')
const classes = (...noms: Array<string | false | null | undefined>) => noms.filter(Boolean).join(' ')

export type EtatVoie = 'normale' | 'survolee' | 'liee' | 'estompee' | 'cible-possible' | 'cible'

interface PropsVoie {
  segment: [XY, XY]
  largeur: number
  couleur: string
  sortante: boolean
  etat: EtatVoie
  interactive: boolean
  titre: string
  onSurvol: (survol: boolean) => void
}

export function Voie({ segment, largeur, couleur, sortante, etat, interactive, titre, onSurvol }: PropsVoie) {
  return (
    <path
      className={classes('calque-voie', sortante && 'sortante', etat, interactive && 'interactive')}
      d={d(segment)}
      stroke={sortante ? undefined : couleur}
      strokeWidth={largeur}
      onPointerEnter={() => onSurvol(true)}
      onPointerLeave={() => onSurvol(false)}
    >
      <title>{titre}</title>
    </path>
  )
}

export function PassagePieton({ segment, largeur }: { segment: [XY, XY]; largeur: number }) {
  return <path className="calque-passage" d={d(segment)} strokeWidth={largeur} strokeDasharray={`${largeur / 5} ${largeur / 5}`} />
}

export type EtatCourbe = 'normale' | 'survolee' | 'surlignee' | 'estompee' | 'a-retirer'

interface PropsCourbe {
  /** Bout de la voie entrante, point amont (pour la tangente), bout de la voie sortante, point aval. */
  entree: [XY, XY]
  sortie: [XY, XY]
  couleur: string
  etat: EtatCourbe
  titre: string
  onSurvol?: (survol: boolean) => void
  onClic?: () => void
}

export function Courbe({ entree, sortie, couleur, etat, titre, onSurvol, onClic }: PropsCourbe) {
  const chemin = cheminConnexion(entree, sortie)
  const interactive = onSurvol !== undefined
  return (
    <g className={classes('calque-courbe', etat)}>
      {/* Tracé large et transparent : facilite le survol et le clic. */}
      {interactive && (
        <path
          className="zone-clic"
          d={chemin}
          onPointerEnter={() => onSurvol(true)}
          onPointerLeave={() => onSurvol(false)}
          onClick={onClic}
        >
          <title>{titre}</title>
        </path>
      )}
      <path className="trace" d={chemin} stroke={couleur} />
    </g>
  )
}

export function Elastique({ depart, arrivee, valide }: { depart: XY; arrivee: XY; valide: boolean }) {
  return <path className={classes('calque-elastique', valide && 'valide')} d={d([depart, arrivee])} />
}

export type EtatPoignee = 'normale' | 'survolee' | 'active' | 'cible-possible' | 'cible' | 'inactive'

interface PropsPoignee {
  centre: XY
  rayon: number
  couleur: string
  vide: boolean
  etat: EtatPoignee
  titre: string
  onPointerDown?: (e: PointerEvent<SVGCircleElement>) => void
  onPointerMove?: (e: PointerEvent<SVGCircleElement>) => void
  onPointerUp?: (e: PointerEvent<SVGCircleElement>) => void
  onPointerCancel?: () => void
  onSurvol?: (survol: boolean) => void
}

export function Poignee({ centre, rayon, couleur, vide, etat, titre, onSurvol, ...pointeur }: PropsPoignee) {
  return (
    <circle
      className={classes('calque-poignee', vide && 'vide', etat)}
      cx={centre[0]}
      cy={centre[1]}
      r={rayon}
      fill={vide ? undefined : couleur}
      onPointerEnter={() => onSurvol?.(true)}
      onPointerLeave={() => onSurvol?.(false)}
      {...pointeur}
    >
      <title>{titre}</title>
    </circle>
  )
}

export function Etiquette({ position, children, classe }: { position: XY; children: ReactNode; classe: string }) {
  return (
    <text className={classe} x={position[0]} y={position[1]} textAnchor="middle" dominantBaseline="middle">
      {children}
    </text>
  )
}
