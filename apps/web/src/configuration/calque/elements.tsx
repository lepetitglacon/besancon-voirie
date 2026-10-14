/**
 * Éléments SVG du calque de configuration. Chacun reçoit des coordonnées déjà projetées en
 * px du plan au sol (voir projection.ts) et un état, rendu par des classes CSS (voir index.css, « Calque de configuration »).
 */
import type { XY } from '@voirie/engine'
import type { MouseEvent, PointerEvent, ReactNode } from 'react'
import { cheminConnexion } from './chemins'
import type { Etendue } from './projection'

const d = (points: readonly XY[]) => points.map(([x, y], i) => `${i ? 'L' : 'M'}${x},${y}`).join(' ')
/** Rectangle de toute l'étendue du plan, à percer d'un tracé (fillRule evenodd). */
export const fond = ({ x, y, largeur, hauteur }: Etendue) => `M${x},${y} h${largeur} v${hauteur} h${-largeur} Z`
const classes = (...noms: Array<string | false | null | undefined>) => noms.filter(Boolean).join(' ')

export type EtatVoie = 'normale' | 'survolee' | 'liee' | 'estompee' | 'cible-possible' | 'cible' | 'choisie' | 'a-retirer'

interface PropsVoie {
  segment: [XY, XY]
  largeur: number
  couleur: string
  sortante: boolean
  etat: EtatVoie
  interactive: boolean
  /** Mode « Voie » : la voie entière se glisse. */
  deplacable?: boolean
  /** Mode « Voie », sous-outil Retirer : un clic retire la voie. */
  retirable?: boolean
  titre: string
  onSurvol: (survol: boolean) => void
  onClic?: (e: MouseEvent<SVGElement>) => void
  onPointerDown?: (e: PointerEvent<SVGElement>) => void
  onPointerMove?: (e: PointerEvent<SVGElement>) => void
  onPointerUp?: (e: PointerEvent<SVGElement>) => void
  onPointerCancel?: () => void
}

export function Voie({ segment, largeur, couleur, sortante, etat, interactive, deplacable, retirable, titre, onSurvol, onClic, ...pointeur }: PropsVoie) {
  return (
    <path
      className={classes('calque-voie', sortante && 'sortante', etat, interactive && 'interactive', deplacable && 'deplacable', retirable && 'retirable')}
      d={d(segment)}
      stroke={sortante ? undefined : couleur}
      strokeWidth={largeur}
      onPointerEnter={() => onSurvol(true)}
      onPointerLeave={() => onSurvol(false)}
      onClick={onClic}
      {...pointeur}
    >
      <title>{titre}</title>
    </path>
  )
}

/** Voie en cours de tracé, dans le sens de la circulation : la flèche montre où elle va. */
export function VoieTracee({ segment: [a, b], largeur }: { segment: [XY, XY]; largeur: number }) {
  const longueur = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
  const [ux, uy] = [(b[0] - a[0]) / longueur, (b[1] - a[1]) / longueur]
  const pointe = Math.max(8, largeur * 0.9)
  const base: XY = [b[0] - ux * pointe, b[1] - uy * pointe]
  const [nx, ny] = [-uy * pointe * 0.7, ux * pointe * 0.7]
  return (
    <g className="calque-voie-tracee">
      <path d={d([a, base])} strokeWidth={largeur} />
      <path className="pointe" d={`${d([[base[0] + nx, base[1] + ny], b, [base[0] - nx, base[1] - ny]])} Z`} />
    </g>
  )
}

/** Couleur du feu qui commande un élément, pendant la lecture d'un programme ; « libre » : aucune ligne. */
export type EtatFeu = 'vert' | 'jaune' | 'rouge' | 'libre'

export type EtatPassage = 'normale' | 'deplacable' | 'retirable' | 'a-retirer' | 'trace'

interface PropsPassage {
  segment: [XY, XY]
  largeur: number
  feu?: EtatFeu
  etat?: EtatPassage
  titre?: string
  onSurvol?: (survol: boolean) => void
  onClic?: (e: MouseEvent<SVGElement>) => void
  onPointerDown?: (e: PointerEvent<SVGElement>) => void
  onPointerMove?: (e: PointerEvent<SVGElement>) => void
  onPointerUp?: (e: PointerEvent<SVGElement>) => void
  onPointerCancel?: () => void
}

export function PassagePieton({ segment, largeur, feu, etat = 'normale', titre, onSurvol, onClic, ...pointeur }: PropsPassage) {
  return (
    <path
      className={classes('calque-passage', feu && `feu-${feu}`, etat !== 'normale' && etat)}
      d={d(segment)}
      strokeWidth={largeur}
      strokeDasharray={`${largeur / 5} ${largeur / 5}`}
      onPointerEnter={onSurvol && (() => onSurvol(true))}
      onPointerLeave={onSurvol && (() => onSurvol(false))}
      onClick={onClic}
      {...pointeur}
    >
      {titre && <title>{titre}</title>}
    </path>
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
  /** Chaînage d'une sortante vers une entrante (bouts éloignés), et non une connexion. */
  chainage?: boolean
  titre: string
  onSurvol?: (survol: boolean) => void
  onClic?: (e: MouseEvent<SVGElement>) => void
}

export function Courbe({ entree, sortie, couleur, etat, feu, chainage, titre, onSurvol, onClic }: PropsCourbe) {
  const chemin = cheminConnexion(entree, sortie)
  const interactive = onSurvol !== undefined
  return (
    <g className={classes('calque-courbe', chainage && 'chainage', etat, feu && `feu-${feu}`)}>
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

/** Tronçon d'anneau d'un giratoire, entre deux nœuds : la chaussée, à sa largeur réelle. */
export function TronconAnneau({ trace, largeur }: { trace: readonly XY[]; largeur: number }) {
  return <path className="calque-troncon" d={d(trace)} strokeWidth={Math.max(largeur, 3)} />
}

/** Nœud d'anneau (mini-carrefour), avec son code ; cliquable pour ouvrir ses réglages. */
export function NoeudAnneau({ centre, code, onClic }: { centre: XY; code: string; onClic?: (e: MouseEvent<SVGElement>) => void }) {
  return (
    <g className={classes('calque-noeud', onClic && 'interactive')} onClick={onClic}>
      <circle cx={centre[0]} cy={centre[1]} r={8} />
      <text x={centre[0]} y={centre[1]} textAnchor="middle" dominantBaseline="central">
        {code}
      </text>
      <title>Nœud {code}</title>
    </g>
  )
}

/**
 * Cadre de la photo envoyée à l'IA : le reste de la carte est assombri. `coins` : haut gauche,
 * haut droite, bas droite, bas gauche.
 */
export function CadrePhoto({ coins, libelle, etendue }: { coins: [XY, XY, XY, XY]; libelle: string; etendue: Etendue }) {
  const carre = `${d(coins)} Z`
  const [x, y] = coins[0]
  return (
    <g className="calque-cadre-photo">
      <path className="masque" d={`${fond(etendue)} ${carre}`} fillRule="evenodd" />
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

export type EtatPoignee = 'normale' | 'survolee' | 'active' | 'cible-possible' | 'cible' | 'inactive'

/**
 * Bouts d'une voie, comme une prise : rond (mâle) là où la circulation quitte la voie, carré
 * (femelle) là où elle y entre. Feux et passages piétons : rond.
 */
export type FormePoignee = 'rond' | 'carre'

interface PropsPoignee {
  centre: XY
  rayon: number
  forme?: FormePoignee
  couleur: string
  vide: boolean
  etat: EtatPoignee
  titre: string
  onPointerDown?: (e: PointerEvent<SVGElement>) => void
  onPointerMove?: (e: PointerEvent<SVGElement>) => void
  onPointerUp?: (e: PointerEvent<SVGElement>) => void
  onPointerCancel?: () => void
  onSurvol?: (survol: boolean) => void
}

export function Poignee({ centre, rayon, forme = 'rond', couleur, vide, etat, titre, onSurvol, ...pointeur }: PropsPoignee) {
  const communs = {
    className: classes('calque-poignee', forme === 'carre' && 'carre', vide && 'vide', etat),
    fill: vide ? undefined : couleur,
    onPointerEnter: () => onSurvol?.(true),
    onPointerLeave: () => onSurvol?.(false),
    ...pointeur,
  }
  if (forme === 'carre') {
    // Côté un peu plus petit que le diamètre : même surface apparente qu'un rond.
    const demi = rayon * 0.9
    return (
      <rect x={centre[0] - demi} y={centre[1] - demi} width={2 * demi} height={2 * demi} rx={1.5} {...communs}>
        <title>{titre}</title>
      </rect>
    )
  }
  return (
    <circle cx={centre[0]} cy={centre[1]} r={rayon} {...communs}>
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
