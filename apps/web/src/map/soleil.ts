/** Centre de Besançon, pour la position du soleil. */
const LATITUDE = 47.2378
const LONGITUDE = 6.0241

const RAD = Math.PI / 180

export interface PositionSoleil {
  /** Direction du soleil, en degrés depuis le nord, sens horaire. */
  azimut: number
  /** Hauteur au-dessus de l'horizon, en degrés (négative la nuit). */
  hauteur: number
}

/**
 * Position du soleil vue de Besançon (formules simplifiées de la NOAA, à quelques dixièmes de
 * degré près : largement assez pour un éclairage).
 */
export function positionSoleil(date: Date): PositionSoleil {
  const jours = date.getTime() / 86_400_000 - 10_957.5 // depuis le 1er janvier 2000 à midi UTC
  const anomalie = (357.529 + 0.985_600_28 * jours) * RAD
  const longitudeMoyenne = 280.459 + 0.985_647_36 * jours
  const longitudeEcliptique =
    (longitudeMoyenne + 1.915 * Math.sin(anomalie) + 0.02 * Math.sin(2 * anomalie)) * RAD
  const obliquite = (23.439 - 0.000_000_36 * jours) * RAD

  const declinaison = Math.asin(Math.sin(obliquite) * Math.sin(longitudeEcliptique))
  const ascensionDroite = Math.atan2(Math.cos(obliquite) * Math.sin(longitudeEcliptique), Math.cos(longitudeEcliptique))
  const tempsSideral = (280.461 + 360.985_647_37 * jours + LONGITUDE) * RAD
  const angleHoraire = tempsSideral - ascensionDroite

  const latitude = LATITUDE * RAD
  const hauteur = Math.asin(
    Math.sin(latitude) * Math.sin(declinaison) + Math.cos(latitude) * Math.cos(declinaison) * Math.cos(angleHoraire),
  )
  const azimut = Math.atan2(
    Math.sin(angleHoraire),
    Math.cos(angleHoraire) * Math.sin(latitude) - Math.tan(declinaison) * Math.cos(latitude),
  )
  // atan2 donne l'azimut depuis le sud ; on le ramène au nord.
  return { azimut: (azimut / RAD + 180 + 360) % 360, hauteur: hauteur / RAD }
}

/** 0 en pleine nuit (soleil 6° sous l'horizon), 1 en plein jour (soleil à 10°). */
export function clarte(hauteur: number): number {
  const t = Math.min(1, Math.max(0, (hauteur + 6) / 16))
  return t * t * (3 - 2 * t)
}

/** Date du jour à l'heure donnée (minutes depuis minuit, heure locale). */
export function aujourdhuiA(minutes: number): Date {
  const date = new Date()
  date.setHours(0, minutes, 0, 0)
  return date
}

/** Mélange deux couleurs `#rrggbb`. */
export function melanger(a: string, b: string, t: number): string {
  const canal = (c: string, i: number) => Number.parseInt(c.slice(1 + 2 * i, 3 + 2 * i), 16)
  return `#${[0, 1, 2]
    .map((i) => Math.round(canal(a, i) + (canal(b, i) - canal(a, i)) * t).toString(16).padStart(2, '0'))
    .join('')}`
}
