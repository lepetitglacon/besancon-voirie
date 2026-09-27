import type { ArcAffiche, EtapeProgramme } from '@voirie/engine'

interface Props {
  etapes: readonly EtapeProgramme[]
  arcs: readonly ArcAffiche[]
  /** Étape en cours à l'instant lu (simulation), mise en avant. */
  courante: number | null
  /** Arc qu'on vient d'emprunter, mis en avant. */
  arcCourant?: { de: number; vers: number } | null
}

const LARGEUR = 400
const HAUTEUR = 290
const CENTRE: [number, number] = [LARGEUR / 2, HAUTEUR / 2]
const RAYON = 108
const NOEUD: [number, number] = [70, 38]

type Point = [number, number]

/** Position de chaque étape : cycle de base sur un cercle, étapes hors cycle au centre. */
function positions(etapes: readonly EtapeProgramme[]): Point[] {
  const base = etapes.flatMap((e, i) => (e.hors_cycle ? [] : [i]))
  const hors = etapes.flatMap((e, i) => (e.hors_cycle ? [i] : []))
  const resultat: Point[] = []
  base.forEach((i, rang) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * rang) / Math.max(base.length, 1)
    resultat[i] = [CENTRE[0] + RAYON * 1.35 * Math.cos(angle), CENTRE[1] + RAYON * Math.sin(angle)]
  })
  hors.forEach((i, rang) => {
    const decalage = (rang - (hors.length - 1) / 2) * (NOEUD[0] + 10)
    resultat[i] = [CENTRE[0] + decalage, CENTRE[1]]
  })
  return resultat
}

/** Point où le segment centre → cible sort du rectangle du nœud. */
function bord([cx, cy]: Point, [tx, ty]: Point): Point {
  const [dx, dy] = [tx - cx, ty - cy]
  const k = Math.min(Math.abs(NOEUD[0] / 2 / (dx || 1e-9)), Math.abs(NOEUD[1] / 2 / (dy || 1e-9)))
  return [cx + dx * k, cy + dy * k]
}

/**
 * Graphe des étapes : un nœud par étape (lignes au vert, durée), un arc par enchaînement
 * possible avec sa condition et la durée de sa transition.
 */
export function GrapheEtapes({ etapes, arcs, courante, arcCourant }: Props) {
  const pos = positions(etapes)
  return (
    <svg className="graphe-etapes" viewBox={`0 0 ${LARGEUR} ${HAUTEUR}`} role="img" aria-label="Graphe des étapes">
      <defs>
        {['suite', 'saut', 'demande', 'reprise', 'actif'].map((nature) => (
          <marker key={nature} id={`fleche-${nature}`} className={`fleche ${nature}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 Z" />
          </marker>
        ))}
      </defs>

      {arcs.map((arc, k) => {
        const a = pos[arc.de]
        const b = pos[arc.vers]
        if (!a || !b) return null
        const actif = arcCourant?.de === arc.de && arcCourant.vers === arc.vers
        // Courbe décalée sur la gauche du trajet : les arcs aller et retour ne se superposent pas.
        const [dx, dy] = [b[0] - a[0], b[1] - a[1]]
        const longueur = Math.hypot(dx, dy) || 1
        const courbure = arc.nature === 'saut' ? 0.35 : 0.18
        const controle: Point = [(a[0] + b[0]) / 2 + (dy / longueur) * longueur * courbure, (a[1] + b[1]) / 2 - (dx / longueur) * longueur * courbure]
        const depart = bord(a, controle)
        const arrivee = bord(b, controle)
        const milieu: Point = [0.25 * depart[0] + 0.5 * controle[0] + 0.25 * arrivee[0], 0.25 * depart[1] + 0.5 * controle[1] + 0.25 * arrivee[1]]
        const libelle = [arc.condition, arc.anticipe ? 'écourte' : '', `${arc.transition_s} s`].filter(Boolean).join(' · ')
        return (
          <g key={k} className={`arc ${arc.nature}${actif ? ' actif' : ''}`}>
            <path
              d={`M${depart[0]},${depart[1]} Q${controle[0]},${controle[1]} ${arrivee[0]},${arrivee[1]}`}
              markerEnd={`url(#fleche-${actif ? 'actif' : arc.nature})`}
            />
            <text x={milieu[0]} y={milieu[1]} textAnchor="middle" dominantBaseline="central">
              {libelle}
            </text>
          </g>
        )
      })}

      {etapes.map((etape, i) => {
        const p = pos[i]
        if (!p) return null
        const classes = ['noeud', etape.hors_cycle && 'hors-cycle', etape.appel && 'appel', courante === i && 'courant'].filter(Boolean).join(' ')
        return (
          <g key={i} className={classes} transform={`translate(${p[0] - NOEUD[0] / 2},${p[1] - NOEUD[1] / 2})`}>
            <rect width={NOEUD[0]} height={NOEUD[1]} rx={7} />
            <text className="titre" x={NOEUD[0] / 2} y={12} textAnchor="middle">
              É{i + 1} · {etape.duree_s} s
            </text>
            <text className="lignes" x={NOEUD[0] / 2} y={27} textAnchor="middle">
              {etape.lignes.join(' ') || '—'}
            </text>
            {etape.hors_cycle && !arcs.some((a) => a.de === i && a.nature === 'reprise') && (
              <text className="reprise" x={NOEUD[0] / 2} y={NOEUD[1] + 10} textAnchor="middle">
                puis suite de l'étape interrompue
              </text>
            )}
            <title>
              {`Étape ${i + 1}${etape.hors_cycle ? ' (hors cycle)' : ''}${etape.appel ? ` sur appel ${etape.appel}` : ''} : ${etape.lignes.join(', ') || 'aucune ligne'}, ${etape.duree_s} s`}
            </title>
          </g>
        )
      })}
    </svg>
  )
}
