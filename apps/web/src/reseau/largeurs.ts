/**
 * Largeurs au sol sur la carte : MapLibre dessine les lignes et les cercles en pixels, on lui
 * donne des mètres convertis à chaque zoom.
 */
import type { ExpressionSpecification } from 'maplibre-gl'

/** Latitude de Besançon : l'échelle varie de moins de 0,1 % d'un bout à l'autre de la ville. */
const LATITUDE = 47.24
/** Circonférence équatoriale (m), tuiles MapLibre de 512 px. */
const CIRCONFERENCE_M = 40_075_016.686
const PX_PAR_METRE_ZOOM_0 = 512 / (CIRCONFERENCE_M * Math.cos((LATITUDE * Math.PI) / 180))
/** Zooms où la conversion est donnée ; entre deux, l'interpolation de base 2 la suit exactement. */
const ZOOMS = [12, 14, 16, 18, 20, 22]

/**
 * Taille MapLibre (px) d'une longueur au sol (m, nombre ou expression sur l'objet), au moins
 * `minimum` px, plus `marge` px. MapLibre n'accepte le zoom qu'en tête de l'expression.
 */
export function metresEnPixels(metres: number | ExpressionSpecification, minimum = 0, marge = 0): ExpressionSpecification {
  const stops = ZOOMS.flatMap((zoom) => [zoom, ['+', ['max', minimum, ['*', metres, PX_PAR_METRE_ZOOM_0 * 2 ** zoom]], marge]])
  return ['interpolate', ['exponential', 2], ['zoom'], ...stops] as ExpressionSpecification
}
