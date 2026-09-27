/**
 * Éléments SVG du calque de configuration. Chacun reçoit des coordonnées déjà projetées en
 * pixels et un état, rendu par des classes CSS (voir index.css, « Calque de configuration »).
 */
import type { XY } from '@voirie/engine'
import type { MouseEvent, PointerEvent, ReactNode } from 'react'
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
  onClic?: (e: MouseEvent<SVGElement>) => void
}

export function Voie({ segment, largeur, couleur, sortante, etat, interactive, titre, onSurvol, onClic }: PropsVoie) {
  return (
    <path
      className={classes('calque-voie', sortante && 'sortante', etat, interactive && 'interactive')}
      d={d(segment)}
      stroke={sortante ? undefined : couleur}
      strokeWidth={largeur}
      onPointerEnter={() => onSurvol(true)}
      onPointerLeave={() => onSurvol(false)}
      onClick={onClic}
    >
      <title>{titre}</title>
    </path>
  )
}

/** Couleur du feu qui commande un élément, pendant la lecture d'un programme ; « libre » : aucune ligne. */
export type EtatFeu = 'vert' | 'jaune' | 'rouge' | 'libre'

export function PassagePieton({ segment, largeur, feu }: { segment: [XY, XY]; largeur: number; feu?: EtatFeu }) {
  return (
    <path
      className={classes('calque-passage', feu && `feu-${feu}`)}
      d={d(segment)}
      strokeWidth={largeur}
      strokeDasharray={`${largeur / 5} ${largeur / 5}`}
    />
  )
}

export type EtatCourbe = 'normale' | 'survolee' | 'surlignee' | 'estompee' | 'a-retirer'

interface PropsCourbe {
  /** Bout de la voie entrante, point amont (pour la tangente), bout de la voie sortante, point aval. */
  entree: [XY, XY]
  sortie: [XY, XY]
  couleur: string
  etat: EtatCourbe
  feu?: EtatFeu
  titre: string
  onSurvol?: (survol: boolean) => void
  onClic?: (e: MouseEvent<SVGElement>) => void
}

export function Courbe({ entree, sortie, couleur, etat, feu, titre, onSurvol, onClic }: PropsCourbe) {
  const chemin = cheminConnexion(entree, sortie)
  const interactive = onSurvol !== undefined
  return (
    <g className={classes('calque-courbe', etat, feu && `feu-${feu}`)}>
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

/**
 * Cadre de la photo envoyée à l'IA : le reste de la carte est assombri. `coins` : haut gauche,
 * haut droite, bas droite, bas gauche.
 */
export function CadrePhoto({ coins, libelle }: { coins: [XY, XY, XY, XY]; libelle: string }) {
  const carre = `${d(coins)} Z`
  const [x, y] = coins[0]
  return (
    <g className="calque-cadre-photo">
      <path className="masque" d={`M-1e5,-1e5 H1e5 V1e5 H-1e5 Z ${carre}`} fillRule="evenodd" />
      <path className="bord" d={carre} />
      <text className="libelle" x={x + 8} y={y + 8} dominantBaseline="hanging">
        {libelle}
      </text>
    </g>
  )
}

export function Elastique({ depart, arrivee, valide }: { depart: XY; arrivee: XY; valide: boolean }) {
  return <path className={classes('calque-elastique', valide && 'valide')} d={d([depart, arrivee])} />
}

/** Voie en cours de tracé : bande pointillée, ligne d'arrêt au point de départ, longueur. */
export function TraceVoie({ segment, largeur, longueur_m }: { segment: [XY, XY]; largeur: number; longueur_m: number }) {
  const [[x0, y0], [x1, y1]] = segment
  return (
    <g className="calque-trace-voie">
      <path className="bande" d={d(segment)} strokeWidth={largeur} />
      <circle className="arret" cx={x0} cy={y0} r={5} />
      <text className="longueur" x={x1 + 10} y={y1} dominantBaseline="middle">
        {Math.round(longueur_m)} m
      </text>
    </g>
  )
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

/**
 * Écart entre la position OSM d'un feu (souvent au milieu de la chaussée) et son mât : trait
 * pointillé et point creux, sur lequel un clic remet le feu à sa position OSM.
 */
export function EcartOsm({ osm, position, onRemettre }: { osm: XY; position: XY; onRemettre?: () => void }) {
  return (
    <g className="calque-ecart-osm">
      <path className="trait" d={d([osm, position])} />
      <circle className={classes('origine', onRemettre && 'interactive')} cx={osm[0]} cy={osm[1]} r={5} onClick={onRemettre}>
        <title>Position OSM : cliquer pour y remettre le feu</title>
      </circle>
    </g>
  )
}

interface PropsEtiquette {
  position: XY
  children: ReactNode
  classe: string
  titre?: string
  onClic?: (e: MouseEvent<SVGElement>) => void
}

export function Etiquette({ position, children, classe, titre, onClic }: PropsEtiquette) {
  return (
    <text
      className={classes(classe, onClic && 'interactive')}
      x={position[0]}
      y={position[1]}
      textAnchor="middle"
      dominantBaseline="middle"
      onClick={onClic}
    >
      {titre && <title>{titre}</title>}
      {children}
    </text>
  )
}
