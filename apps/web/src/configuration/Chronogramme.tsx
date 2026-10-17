import type { Demande, EtapeCalculee, Intervalle, LigneProgramme } from '@voirie/engine'
import type { PointerEvent } from 'react'

/** Ce que le chronogramme dessine : un cycle calculé, ou une simulation du graphe des étapes. */
export interface Chronologie {
  duree_s: number
  etapes: readonly EtapeCalculee[]
  transitions: ReadonlyArray<{ debut_s: number; duree_s: number }>
  verts: Readonly<Record<string, Intervalle[]>>
  jaunes: Readonly<Record<string, Intervalle[]>>
}

interface Props {
  chronologie: Chronologie
  lignes: readonly LigneProgramme[]
  instant: number
  onInstant: (t: number) => void
  /** Demandes d'un scénario de simulation, marquées sur la rangée de leur ligne. */
  demandes?: readonly Demande[]
  /** Étire l'étape `index` pour que son vert finisse à `finVoulue` : rend le bord de chaque étape déplaçable. */
  onEtirer?: (index: number, finActuelle: number, finVoulue: number) => void
  /**
   * Largeur du dessin, en unités du viewBox (400 par défaut). La donner égale à la largeur affichée,
   * en pixels, garde le texte à sa taille quelle que soit la place.
   */
  largeur?: number
}

const LARGEUR = 400
const LARGEUR_POIGNEE = 5
const MARGE_GAUCHE = 30
const MARGE_DROITE = 8
const HAUT_ETAPES = 16
const HAUT_LIGNE = 13
const ECART = 4
const HAUT_AXE = 16

/**
 * Diagramme de feux (chronogramme) : une rangée par ligne de feux sur un cycle (ou une simulation),
 * vert, jaune et rouge, avec les étapes au-dessus. Cliquer ou glisser place le curseur de
 * lecture, que la carte reflète. Avec `onEtirer`, tirer le bord droit d'une étape change sa durée.
 */
export function Chronogramme({ chronologie: resultat, lignes, instant, onInstant, demandes = [], onEtirer, largeur = LARGEUR }: Props) {
  const { duree_s: cycle_s } = resultat
  const largeurUtile = largeur - MARGE_GAUCHE - MARGE_DROITE
  const x = (t: number) => MARGE_GAUCHE + (t / cycle_s) * largeurUtile
  const y = (rang: number) => HAUT_ETAPES + ECART + rang * (HAUT_LIGNE + ECART)
  const hauteur = y(lignes.length) + HAUT_AXE
  const pas = cycle_s > 150 ? 30 : cycle_s > 60 ? 10 : 5
  const graduations = Array.from({ length: Math.floor(cycle_s / pas) + 1 }, (_, i) => i * pas)

  /** Instant du cycle sous le pointeur, borné au cycle. */
  const instantSous = (e: PointerEvent<SVGElement>) => {
    const cadre = (e.currentTarget.ownerSVGElement ?? e.currentTarget).getBoundingClientRect()
    const vx = ((e.clientX - cadre.left) / cadre.width) * largeur
    return Math.min(cycle_s, Math.max(0, ((vx - MARGE_GAUCHE) / largeurUtile) * cycle_s))
  }
  const placer = (e: PointerEvent<SVGSVGElement>) => onInstant(Math.min(cycle_s - 0.01, instantSous(e)))

  return (
    <svg
      className="chronogramme"
      viewBox={`0 0 ${largeur} ${hauteur}`}
      role="img"
      aria-label={`Diagramme de feux sur ${cycle_s} s`}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        placer(e)
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) placer(e)
      }}
    >
      {resultat.transitions.map((t, i) =>
        t.duree_s > 0 ? (
          <rect key={`t${i}`} className="transition" x={x(t.debut_s)} y={0} width={x(t.debut_s + t.duree_s) - x(t.debut_s)} height={HAUT_ETAPES} />
        ) : null,
      )}
      {resultat.etapes.map((etape, i) => (
        <g key={`e${i}`} className="etape">
          <rect x={x(etape.debut_s)} y={0} width={x(etape.fin_s) - x(etape.debut_s)} height={HAUT_ETAPES} />
          {x(etape.fin_s) - x(etape.debut_s) >= 12 && (
            <text x={(x(etape.debut_s) + x(etape.fin_s)) / 2} y={HAUT_ETAPES / 2} textAnchor="middle" dominantBaseline="central">
              É{etape.index + 1}
            </text>
          )}
          {onEtirer && (
            <rect
              className="poignee"
              x={x(etape.fin_s) - LARGEUR_POIGNEE / 2}
              y={0}
              width={LARGEUR_POIGNEE}
              height={HAUT_ETAPES}
              rx={1.5}
              onPointerDown={(e) => {
                // Le glisser change la durée : il ne doit pas déplacer le curseur de lecture.
                e.stopPropagation()
                e.currentTarget.setPointerCapture(e.pointerId)
              }}
              onPointerMove={(e) => {
                if (e.currentTarget.hasPointerCapture(e.pointerId)) onEtirer(etape.index, etape.fin_s, instantSous(e))
              }}
            >
              <title>
                Tirer pour changer la durée de l'étape {etape.index + 1} ({Math.round(etape.fin_s - etape.debut_s)} s de vert)
              </title>
            </rect>
          )}
        </g>
      ))}

      {lignes.map((ligne, rang) => (
        <g key={ligne.code}>
          <text className="code" x={MARGE_GAUCHE - 4} y={y(rang) + HAUT_LIGNE / 2} textAnchor="end" dominantBaseline="central">
            {ligne.code}
          </text>
          <rect className="rouge" x={x(0)} y={y(rang) + HAUT_LIGNE / 2 - 1.5} width={largeurUtile} height={3} />
          {(resultat.jaunes[ligne.code] ?? []).map(([a, b]) => (
            <rect key={`j${a}`} className="jaune" x={x(a)} y={y(rang)} width={x(b) - x(a)} height={HAUT_LIGNE} />
          ))}
          {(resultat.verts[ligne.code] ?? []).map(([a, b]) => (
            <rect key={`v${a}`} className="vert" x={x(a)} y={y(rang)} width={x(b) - x(a)} height={HAUT_LIGNE}>
              <title>
                {ligne.code} au vert de {a} à {b} s ({Math.round((b - a) * 10) / 10} s)
              </title>
            </rect>
          ))}
          {demandes
            .filter((d) => d.ligne === ligne.code && d.t <= cycle_s)
            .map((d, k) => (
              <path key={`d${k}`} className="demande" d={`M${x(d.t)},${y(rang) - 1} l4,${HAUT_LIGNE / 2 + 1} l-4,${HAUT_LIGNE / 2 + 1} l-4,${-HAUT_LIGNE / 2 - 1} Z`}>
                <title>
                  Demande {d.ligne} à {d.t} s
                </title>
              </path>
            ))}
        </g>
      ))}

      <g className="axe">
        {graduations.map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={y(lignes.length) - ECART} y2={y(lignes.length)} />
            <text x={x(t)} y={y(lignes.length) + 9} textAnchor="middle">
              {t}
            </text>
          </g>
        ))}
      </g>

      <g className="curseur">
        <line x1={x(instant)} x2={x(instant)} y1={0} y2={y(lignes.length) - ECART} />
        <path d={`M${x(instant) - 4},0 L${x(instant) + 4},0 L${x(instant)},5 Z`} />
      </g>
    </svg>
  )
}
