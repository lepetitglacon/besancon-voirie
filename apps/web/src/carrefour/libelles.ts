import type { CarrefourResume } from '@voirie/schema'

/** Libellés des carrefours, partagés par la carte et la configuration. */
export const NATURES: Record<CarrefourResume['nature'], string> = {
  carrefour: 'Carrefour à feux',
  traversee_pietonne: 'Traversée piétonne à feux',
}

export const STATUTS: Record<CarrefourResume['statut'], string> = {
  a_confirmer: 'à confirmer',
  non_releve: 'non relevée',
  estime: 'estimée',
  mesure: 'mesurée',
  verifie: 'vérifiée',
}
