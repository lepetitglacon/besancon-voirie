import type { LonLat, XY } from '@voirie/engine'
import { LngLat, MercatorCoordinate, type Map as CarteMapLibre } from 'maplibre-gl'
import { useEffect, useState, type CSSProperties } from 'react'
import { useMap } from 'react-map-gl/maplibre'

/** Demi-côté (px du plan) du carré dont les coins calent la perspective. */
const DEMI_COTE_CALAGE = 256
/** Points relevés sur chaque bord de l'écran pour trouver la part du sol visible. */
const RELEVES_PAR_BORD = 8
/** Au plus loin (en tailles d'écran) que le plan s'étend vers l'horizon. */
const PORTEE_MAX_ECRANS = 12

/** Rectangle du plan, en px du plan. */
export interface Etendue {
  x: number
  y: number
  largeur: number
  hauteur: number
}

export interface Projection {
  /** lon/lat → px du plan. */
  px: (point: LonLat) => XY
  /** px du plan → lon/lat. */
  lonLat: (x: number, y: number) => LonLat
  /** Point du sol sous le pointeur. */
  pointeur: (e: { clientX: number; clientY: number }) => LonLat
  /** Échelle du plan, pour dessiner les voies à leur largeur réelle. */
  metresParPixel: number
  /** Part du plan qui couvre le sol visible : fonds et zones de clic s'y limitent. */
  etendue: Etendue
  /** Taille, viewBox et transformation 3D du <svg> qui porte le plan. */
  svg: { viewBox: string; style: CSSProperties }
}

type Matrice3 = [number, number, number, number, number, number, number, number, number]

/** Homographie qui envoie chaque point `de[i]` sur `vers[i]` (élimination de Gauss, h22 = 1). */
function homographie(de: readonly XY[], vers: readonly XY[]): Matrice3 | null {
  const a: number[][] = []
  de.forEach(([x, y], i) => {
    const [u, v] = vers[i]!
    a.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u])
    a.push([0, 0, 0, x, y, 1, -v * x, -v * y, v])
  })
  for (let c = 0; c < 8; c++) {
    let pivot = c
    for (let l = c + 1; l < 8; l++) if (Math.abs(a[l]![c]!) > Math.abs(a[pivot]![c]!)) pivot = l
    if (Math.abs(a[pivot]![c]!) < 1e-12) return null
    ;[a[c], a[pivot]] = [a[pivot]!, a[c]!]
    for (let l = 0; l < 8; l++) {
      if (l === c) continue
      const f = a[l]![c]! / a[c]![c]!
      for (let k = c; k < 9; k++) a[l]![k]! -= f * a[c]![k]!
    }
  }
  const h = a.map((ligne, i) => ligne[8]! / ligne[i]!)
  return [...h, 1] as Matrice3
}

function inverse([a, b, c, d, e, f, g, h, i]: Matrice3): Matrice3 {
  const A = e * i - f * h
  const B = f * g - d * i
  const C = d * h - e * g
  const det = a * A + b * B + c * C
  return [A / det, (c * h - b * i) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, (c * d - a * f) / det, C / det, (b * g - a * h) / det, (a * e - b * d) / det]
}

const moyenne = (valeurs: readonly number[]) => valeurs.reduce((s, v) => s + v, 0) / valeurs.length

/**
 * Plan z = a + b·x + c·y au plus près des points (moindres carrés) ; à plat, à leur altitude
 * moyenne, s'ils sont moins de trois ou alignés.
 */
function planMoyen(points: ReadonlyArray<readonly [number, number, number]>): [number, number, number] {
  const zm = moyenne(points.map((p) => p[2]))
  if (points.length < 3) return [zm, 0, 0]
  const xm = moyenne(points.map((p) => p[0]))
  const ym = moyenne(points.map((p) => p[1]))
  let sxx = 0
  let sxy = 0
  let syy = 0
  let sxz = 0
  let syz = 0
  for (const [x, y, z] of points) {
    const [dx, dy, dz] = [x - xm, y - ym, z - zm]
    sxx += dx * dx
    sxy += dx * dy
    syy += dy * dy
    sxz += dx * dz
    syz += dy * dz
  }
  const det = sxx * syy - sxy * sxy
  if (Math.abs(det) < 1e-9 * Math.max(1, sxx * syy)) return [zm, 0, 0]
  const b = (sxz * syy - syz * sxy) / det
  const c = (syz * sxx - sxz * sxy) / det
  return [zm - b * xm - c * ym, b, c]
}

const appliquer = (m: Matrice3, x: number, y: number): [number, number, number] => [
  m[0] * x + m[1] * y + m[2],
  m[3] * x + m[4] * y + m[5],
  m[6] * x + m[7] * y + m[8],
]

/**
 * Projection du calque, recalculée à chaque déplacement de la carte (au plus une fois par image).
 *
 * Le calque est un plan posé sur le sol, comme de la peinture sur la chaussée : on dessine en
 * « px du plan » (mercator à l'échelle du zoom, origine sur `ancre`), et une transformation CSS
 * `matrix3d` met ce plan en perspective sous la caméra. Largeurs, flèches et libellés rétrécissent
 * donc avec la distance quand la carte est inclinée.
 *
 * Avec le relief, le plan suit la pente : il est ajusté (moindres carrés) sur l'altitude du terrain
 * aux `reperes`, et son origine est leur centre. Sans repères, il passe par le centre de la vue,
 * à plat.
 */
export function useProjection(reperes?: readonly LonLat[]): Projection | null {
  const { current: carte } = useMap()
  const [, setVersion] = useState(0)

  useEffect(() => {
    const map = carte?.getMap()
    if (!map) return
    let image = 0
    const planifier = () => {
      if (image) return
      image = requestAnimationFrame(() => {
        image = 0
        setVersion((v) => v + 1)
      })
    }
    // « terrain » et « idle » : l'altitude de l'ancre change quand le relief s'affiche ou se charge.
    const evenements = ['move', 'resize', 'terrain', 'idle'] as const
    for (const e of evenements) map.on(e, planifier)
    return () => {
      for (const e of evenements) map.off(e, planifier)
      cancelAnimationFrame(image)
    }
  }, [carte])

  if (!carte) return null
  const map = carte.getMap()
  const origine = reperes?.length
    ? new LngLat(moyenne(reperes.map((p) => p[0])), moyenne(reperes.map((p) => p[1])))
    : map.getCenter()
  const monde = map.transform.worldSize
  const m0 = MercatorCoordinate.fromLngLat(origine)

  const px = ([lon, lat]: LonLat): XY => {
    const m = MercatorCoordinate.fromLngLat([lon, lat])
    return [(m.x - m0.x) * monde, (m.y - m0.y) * monde]
  }
  const lonLat = (x: number, y: number): LonLat => {
    const { lng, lat } = new MercatorCoordinate(m0.x + x / monde, m0.y + y / monde).toLngLat()
    return [lng, lat]
  }

  // Sol du plan : MapLibre projette chaque point à l'altitude que le plan lui donne.
  let sol: CarteMapLibre['terrain'] | undefined
  if (map.terrain) {
    const terrain = map.terrain
    const altitude = (p: LonLat) => terrain.getElevationForLngLat(new LngLat(p[0], p[1]), map.transform)
    const pente = planMoyen(reperes?.length ? reperes.map((p) => [...px(p), altitude(p)] as const) : [[0, 0, altitude([origine.lng, origine.lat])]])
    const z = (l: LngLat) => {
      const [x, y] = px([l.lng, l.lat])
      return pente[0] + pente[1] * x + pente[2] * y
    }
    sol = { getElevationForLngLat: z, getElevationForLngLatZoom: z } as unknown as CarteMapLibre['terrain']
  }
  const ecran = (x: number, y: number): XY => {
    const [lon, lat] = lonLat(x, y)
    const { x: u, y: v } = map.transform.locationToScreenPoint(new LngLat(lon, lat), sol)
    return [u, v]
  }

  const r = DEMI_COTE_CALAGE
  const coins: XY[] = [
    [-r, -r],
    [r, -r],
    [r, r],
    [-r, r],
  ]
  const h = homographie(
    coins,
    coins.map(([x, y]) => ecran(x, y)),
  )
  // h22 = 1 : l'ancre, supposée devant la caméra, a une profondeur positive ; derrière
  // l'horizon, un point du plan a une profondeur négative.
  if (!h || !h.every(Number.isFinite)) return null
  const versPlan = inverse(h)

  // Part du sol visible : bords de l'écran ramenés sur le plan, sans ce qui est au-dessus de l'horizon.
  const { clientWidth: largeur, clientHeight: hauteur } = map.getContainer()
  const portee = PORTEE_MAX_ECRANS * Math.max(largeur, hauteur)
  const xs: number[] = []
  const ys: number[] = []
  for (let i = 0; i <= RELEVES_PAR_BORD; i++) {
    const t = i / RELEVES_PAR_BORD
    for (const [sx, sy] of [
      [t * largeur, 0],
      [t * largeur, hauteur],
      [0, t * hauteur],
      [largeur, t * hauteur],
    ] as XY[]) {
      const [x, y, w] = appliquer(versPlan, sx, sy)
      if (w <= 0) continue
      xs.push(Math.max(-portee, Math.min(portee, x / w)))
      ys.push(Math.max(-portee, Math.min(portee, y / w)))
    }
  }
  if (!xs.length) return null
  const marge = 64
  const etendue: Etendue = {
    x: Math.min(...xs) - marge,
    y: Math.min(...ys) - marge,
    largeur: Math.max(...xs) - Math.min(...xs) + 2 * marge,
    hauteur: Math.max(...ys) - Math.min(...ys) + 2 * marge,
  }

  // Le <svg> a son coin haut gauche sur (etendue.x, etendue.y) du plan.
  const [a, b, c, d, e, f, g, k, l] = h
  const { x: ox, y: oy } = etendue
  const tx = a * ox + b * oy + c
  const ty = d * ox + e * oy + f
  const tw = g * ox + k * oy + l
  const matrice = [a, d, 0, g, b, e, 0, k, 0, 0, 1, 0, tx, ty, 0, tw]

  return {
    px,
    lonLat,
    pointeur: ({ clientX, clientY }) => {
      const cadre = map.getContainer().getBoundingClientRect()
      const [x, y, w] = appliquer(versPlan, clientX - cadre.left, clientY - cadre.top)
      return lonLat(x / w, y / w)
    },
    metresParPixel: 1 / (monde * m0.meterInMercatorCoordinateUnits()),
    etendue,
    svg: {
      viewBox: `${etendue.x} ${etendue.y} ${etendue.largeur} ${etendue.hauteur}`,
      style: { width: etendue.largeur, height: etendue.hauteur, transform: `matrix3d(${matrice.join(',')})` },
    },
  }
}
