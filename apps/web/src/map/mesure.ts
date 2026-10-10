import { distanceMetres, pointADistance, preparerPolyligne, type LonLat } from '@voirie/engine'

/** Distance de chaque point au précédent (0 pour le premier), cumul depuis le départ et total. */
export function distancesMesure(points: LonLat[]): { troncons: number[]; cumuls: number[]; total: number } {
  const troncons = points.map((p, i) => (i === 0 ? 0 : distanceMetres(points[i - 1]!, p)))
  const cumuls: number[] = []
  troncons.forEach((t, i) => cumuls.push((cumuls[i - 1] ?? 0) + t))
  return { troncons, cumuls, total: cumuls.at(-1) ?? 0 }
}

/** Points régulièrement espacés le long du tracé, sommets compris, pour le profil d'altitude. */
export function echantillonner(points: LonLat[], nombre = 120): { distance: number; position: LonLat }[] {
  if (points.length < 2) return points.map((position) => ({ distance: 0, position }))
  const ligne = preparerPolyligne(points)
  const distances = new Set([...ligne.cumul, ...Array.from({ length: nombre + 1 }, (_, i) => (ligne.longueur * i) / nombre)])
  return [...distances].sort((a, b) => a - b).map((distance) => ({ distance, position: pointADistance(ligne, distance) }))
}

/** Dénivelés cumulés, positif et négatif, d'une suite d'altitudes. */
export function denivele(altitudes: number[]): { montee: number; descente: number } {
  let montee = 0
  let descente = 0
  for (let i = 1; i < altitudes.length; i++) {
    const ecart = altitudes[i]! - altitudes[i - 1]!
    if (ecart > 0) montee += ecart
    else descente -= ecart
  }
  return { montee, descente }
}

/** « 85 m », « 1,24 km ». */
export function formaterDistance(metres: number): string {
  if (metres < 1000) return `${Math.round(metres)} m`
  return `${(metres / 1000).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} km`
}
