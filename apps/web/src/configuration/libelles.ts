import type { Mouvement, Signal } from '@voirie/schema'

export const FLECHES: Array<{ direction: Mouvement; symbole: string; titre: string }> = [
  { direction: 'demi_tour', symbole: '↶', titre: 'Demi-tour' },
  { direction: 'gauche', symbole: '←', titre: 'Tourne-à-gauche' },
  { direction: 'tout_droit', symbole: '↑', titre: 'Tout droit' },
  { direction: 'droite', symbole: '→', titre: 'Tourne-à-droite' },
]

export const DIRECTIONS: Record<Mouvement, string> = {
  gauche: 'à gauche',
  tout_droit: 'tout droit',
  droite: 'à droite',
  demi_tour: 'demi-tour',
}

export const SIGNAUX: Record<Signal, { libelle: string; prefixe: string }> = {
  R11v: { libelle: 'Véhicules (R11v)', prefixe: 'F' },
  R12: { libelle: 'Piétons (R12)', prefixe: 'P' },
  R13c: { libelle: 'Vélos (R13c)', prefixe: 'V' },
  R17: { libelle: 'Tram / bus (R17)', prefixe: 'T' },
  R18: { libelle: 'Tram / bus (R18)', prefixe: 'T' },
}
