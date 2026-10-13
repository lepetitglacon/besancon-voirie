/**
 * Calque de la zone d'import OSM (outil « Zone OSM » du mode Édition) : le polygone, la carte
 * assombrie au-dehors, et en retouche des poignées pour caler le tracé. Glisser un sommet le
 * déplace ; glisser (ou cliquer) le « + » au milieu d'un côté y ajoute un sommet ; un
 * double-clic sur un sommet le retire (trois sommets au moins). En mode « dessiner », chaque clic
 * sur la carte pose un sommet du polygone en cours ; un clic sur son premier sommet le ferme.
 */
import type { LonLat, XY } from '@voirie/engine'
import type { PolygonesZone } from '@voirie/schema'
import { useState, type PointerEvent } from 'react'
import { useProjection } from '../configuration/calque/projection'

export type ModeZone = 'retoucher' | 'choisir' | 'dessiner'

interface Props {
  polygones: PolygonesZone | null
  /** Zone du dernier import, en pointillé dessous. */
  importee: PolygonesZone | null
  mode: ModeZone
  onChanger: (polygones: PolygonesZone) => void
  /** Point choisi, marqué sur la carte. */
  point: LonLat | null
  /** Mode « dessiner » : sommets du polygone en cours. */
  trace: LonLat[]
  /** Clic sur le premier sommet du polygone en cours : il se ferme. */
  onFermerTrace: () => void
}

/** Sommet saisi : polygone, indice du sommet ; `insere` : ajouté par un « + », à cet indice. */
type Saisie = { polygone: number; sommet: number; position: LonLat; insere: boolean }

const chemin = (points: readonly XY[]) => `${points.map(([x, y], i) => `${i ? 'L' : 'M'}${x},${y}`).join(' ')} Z`

export function CalqueZoneOsm({ polygones, importee, mode, onChanger, point, trace, onFermerTrace }: Props) {
  const projection = useProjection()
  const [saisie, setSaisie] = useState<Saisie | null>(null)
  if (!projection) return null
  const { px, lonLat } = projection

  // Pendant un glisser, le polygone suit le pointeur ; il n'est remonté qu'au relâché.
  const affiches: PolygonesZone | null =
    polygones && saisie
      ? polygones.map((contour, i) => {
          if (i !== saisie.polygone) return contour
          const { sommet, position: p } = saisie
          return saisie.insere ? [...contour.slice(0, sommet), p, ...contour.slice(sommet)] : contour.map((q, j) => (j === sommet ? p : q))
        })
      : polygones

  const position = (e: PointerEvent<SVGElement>): LonLat => {
    const cadre = e.currentTarget.ownerSVGElement!.getBoundingClientRect()
    return lonLat(e.clientX - cadre.left, e.clientY - cadre.top)
  }

  const saisir = (polygone: number, sommet: number, insere: LonLat | null) => (e: PointerEvent<SVGElement>) => {
    if (e.button !== 0 || !polygones) return
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    setSaisie({ polygone, sommet, position: insere ?? polygones[polygone]![sommet]!, insere: insere !== null })
  }
  const suivre = (e: PointerEvent<SVGElement>) => saisie && setSaisie({ ...saisie, position: position(e) })
  const relacher = () => {
    if (saisie && affiches) onChanger(affiches)
    setSaisie(null)
  }
  const retirer = (polygone: number, sommet: number) => {
    if (!polygones || polygones[polygone]!.length <= 3) return
    onChanger(polygones.map((contour, i) => (i === polygone ? contour.filter((_, j) => j !== sommet) : contour)))
  }

  const contours = affiches?.map((contour) => contour.map(px)) ?? []
  const anciens = importee?.map((contour) => contour.map(px)) ?? []
  // La carte est assombrie hors du tracé, ou à défaut hors de la zone importée.
  const masque = contours.length > 0 ? contours : anciens
  return (
    <svg className={`calque-zone-osm ${mode}`} aria-label="Zone d'import OSM">
      {masque.length > 0 && <path className="masque" d={`M-1e5,-1e5 H1e5 V1e5 H-1e5 Z ${masque.map(chemin).join(' ')}`} fillRule="evenodd" />}
      {anciens.map((contour, i) => (
        <path key={`importee-${i}`} className="importee" d={chemin(contour)}>
          <title>Zone du dernier import</title>
        </path>
      ))}
      {contours.length > 0 && (
        <>
          {contours.map((contour, i) => (
            <path key={i} className="bord" d={chemin(contour)} />
          ))}
        </>
      )}

      {point && <circle className="point-choisi" cx={px(point)[0]} cy={px(point)[1]} r={7} />}

      {mode === 'dessiner' && trace.length > 0 && (
        <g className="trace">
          {trace.length > 2 && <path className="fermeture" d={`M${px(trace.at(-1)!).join(',')} L${px(trace[0]!).join(',')}`} />}
          <path className="ligne" d={trace.map(px).map(([x, y], i) => `${i ? 'L' : 'M'}${x},${y}`).join(' ')} />
          {trace.map((p, i) => {
            const [x, y] = px(p)
            return i === 0 && trace.length > 2 ? (
              <circle key={i} className="premier" cx={x} cy={y} r={7} onClick={onFermerTrace}>
                <title>Cliquer pour fermer le polygone</title>
              </circle>
            ) : (
              <circle key={i} className="point" cx={x} cy={y} r={4} />
            )
          })}
        </g>
      )}

      {mode === 'retoucher' &&
        contours.map((contour, i) =>
          contour.map((sommet, j) => {
            const suivant = contour[(j + 1) % contour.length]!
            const milieu: XY = [(sommet[0] + suivant[0]) / 2, (sommet[1] + suivant[1]) / 2]
            const geste = { onPointerMove: suivre, onPointerUp: relacher, onPointerCancel: () => setSaisie(null) }
            return (
              <g key={`${i}-${j}`}>
                {/* Un côté trop court pour y glisser un « + » n'en a pas. */}
                {Math.hypot(suivant[0] - sommet[0], suivant[1] - sommet[1]) > 24 && (
                  <circle
                    className="ajout"
                    cx={milieu[0]}
                    cy={milieu[1]}
                    r={4}
                    onPointerDown={saisir(i, j + 1, lonLat(milieu[0], milieu[1]))}
                    {...geste}
                  >
                    <title>Glisser pour ajouter un sommet</title>
                  </circle>
                )}
                <circle
                  className={saisie?.polygone === i && saisie.sommet === j ? 'sommet actif' : 'sommet'}
                  cx={sommet[0]}
                  cy={sommet[1]}
                  r={5}
                  onPointerDown={saisir(i, j, null)}
                  onDoubleClick={() => retirer(i, j)}
                  {...geste}
                >
                  <title>Glisser pour déplacer ; double-clic pour retirer</title>
                </circle>
              </g>
            )
          }),
        )}
    </svg>
  )
}
