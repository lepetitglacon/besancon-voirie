import type { XY } from '@voirie/engine'

/** Même construction que `courbeConnexionXY` du moteur, directement en pixels (la projection est conforme). */
export function cheminConnexion([p0, amont]: [XY, XY], [p3, aval]: [XY, XY]): string {
  const unitaire = ([x, y]: XY): XY => {
    const n = Math.hypot(x, y) || 1
    return [x / n, y / n]
  }
  const dIn = unitaire([p0[0] - amont[0], p0[1] - amont[1]])
  const dOut = unitaire([aval[0] - p3[0], aval[1] - p3[1]])
  const k = 0.4 * Math.hypot(p3[0] - p0[0], p3[1] - p0[1])
  return `M${p0[0]},${p0[1]} C${p0[0] + dIn[0] * k},${p0[1] + dIn[1] * k} ${p3[0] - dOut[0] * k},${p3[1] - dOut[1] * k} ${p3[0]},${p3[1]}`
}
