import type { PolygonesZone } from '@voirie/schema'

/** Superficie approchée (km²) des polygones, dans un repère local en mètres. */
export function superficieKm2(polygones: PolygonesZone): number {
  const [lon0, lat0] = polygones[0]?.[0] ?? [0, 0]
  const kx = 111_320 * Math.cos((lat0 * Math.PI) / 180)
  const ky = 110_574
  return (
    polygones.reduce((total, contour) => {
      let double = 0
      contour.forEach(([lon, lat], i) => {
        const [lon2, lat2] = contour[(i + 1) % contour.length]!
        double += (lon - lon0) * kx * ((lat2 - lat0) * ky) - (lon2 - lon0) * kx * ((lat - lat0) * ky)
      })
      return total + Math.abs(double) / 2
    }, 0) / 1e6
  )
}
