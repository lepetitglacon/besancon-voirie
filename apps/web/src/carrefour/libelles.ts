import type { CarrefourResume, Jour, Plage } from '@voirie/schema'

/** Libellés des carrefours, partagés par la carte et la configuration. */
export const NATURES: Record<CarrefourResume['nature'], string> = {
  carrefour: 'Carrefour à feux',
  giratoire: 'Giratoire à feux',
  traversee_pietonne: 'Traversée piétonne à feux',
}

export const STATUTS: Record<CarrefourResume['statut'], string> = {
  a_confirmer: 'à confirmer',
  non_releve: 'non relevée',
  estime: 'estimée',
  mesure: 'mesurée',
  verifie: 'vérifiée',
}

const ORDRE_JOURS: Jour[] = ['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim']

/** « lun.–ven. 07:00–09:00 », « sam., dim. », « tous les jours, toute la journée ». */
export function libellePlage({ jours, de, a }: Plage): string {
  let quand = 'tous les jours'
  if (jours !== 'tous') {
    const rangs = jours.map((j) => ORDRE_JOURS.indexOf(j)).sort((x, y) => x - y)
    const suivis = rangs.every((r, i) => i === 0 || r === rangs[i - 1]! + 1)
    quand =
      suivis && rangs.length > 2
        ? `${ORDRE_JOURS[rangs[0]!]}.–${ORDRE_JOURS[rangs.at(-1)!]}.`
        : rangs.map((r) => `${ORDRE_JOURS[r]}.`).join(', ')
  }
  return de === a ? `${quand}, toute la journée` : `${quand} ${de}–${a}`
}
