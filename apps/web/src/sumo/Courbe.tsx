import { Box, type BoxProps } from '@chakra-ui/react'
import type { PointerEvent } from 'react'

export interface Serie {
  valeurs: (number | null)[]
  couleur: string
  /** Aire sous la courbe. */
  remplie?: boolean
  libelle: string
}

interface Props extends Omit<BoxProps, 'onChange'> {
  series: Serie[]
  /** Rang de la tranche courante (trait vertical). */
  curseur: number
  /** Clic ou glisser sur la courbe : rang de la tranche visée. */
  onChoisir?: (rang: number) => void
}

const L = 1000

/** Petite courbe par tranche, sans axes : `null` coupe le tracé. Échelle commune à toutes les séries. */
export function Courbe({ series, curseur, onChoisir, h = '48px', ...props }: Props) {
  const n = Math.max(1, ...series.map((s) => s.valeurs.length))
  const max = Math.max(1, ...series.flatMap((s) => s.valeurs.map((v) => v ?? 0)))
  const x = (k: number) => (n === 1 ? 0 : (k / (n - 1)) * L)
  const y = (v: number) => 100 - (v / max) * 96

  const traces = series.map((serie) => {
    const morceaux: string[] = []
    let morceau: string[] = []
    serie.valeurs.forEach((v, k) => {
      if (v === null) {
        if (morceau.length) morceaux.push(morceau.join(' '))
        morceau = []
      } else morceau.push(`${x(k).toFixed(1)},${y(v).toFixed(1)}`)
    })
    if (morceau.length) morceaux.push(morceau.join(' '))
    return { serie, morceaux }
  })

  const viser = (e: PointerEvent<SVGSVGElement>) => {
    if (!onChoisir || (e.type === 'pointermove' && e.buttons !== 1)) return
    const cadre = e.currentTarget.getBoundingClientRect()
    onChoisir(Math.round(((e.clientX - cadre.left) / cadre.width) * (n - 1)))
  }

  return (
    <Box h={h} {...props}>
      <svg
        viewBox={`0 0 ${L} 100`}
        preserveAspectRatio="none"
        width="100%"
        height="100%"
        role="img"
        aria-label={series.map((s) => s.libelle).join(', ')}
        style={{ cursor: onChoisir ? 'pointer' : undefined, touchAction: 'none', display: 'block' }}
        onPointerDown={viser}
        onPointerMove={viser}
      >
        {traces.map(({ serie, morceaux }) =>
          morceaux.map((points, m) => (
            <g key={`${serie.libelle}-${m}`}>
              {serie.remplie && (
                <polygon
                  points={`${points.split(' ')[0]!.split(',')[0]},100 ${points} ${points.split(' ').at(-1)!.split(',')[0]},100`}
                  fill={serie.couleur}
                  opacity={0.18}
                />
              )}
              <polyline points={points} fill="none" stroke={serie.couleur} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
            </g>
          )),
        )}
        <line
          x1={x(curseur)}
          x2={x(curseur)}
          y1={0}
          y2={100}
          stroke="currentColor"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </Box>
  )
}
