import type { ReseauBus } from '@voirie/schema'

/** Familles de lignes Ginko, d'après le numéro public. */
export const CATEGORIES_BUS = [
  { cle: 'lianes', libelle: 'Lianes' },
  { cle: 'urbaines', libelle: 'Urbaines' },
  { cle: 'periurbaines', libelle: 'Périurbaines' },
  { cle: 'scolaires', libelle: 'Scolaires et renforts' },
] as const

export type CategorieBus = (typeof CATEGORIES_BUS)[number]['cle']

export interface LigneBus {
  ligne: string
  couleur: string
  couleurTexte: string
  categorie: CategorieBus
}

export function categorieBus(ligne: string): CategorieBus {
  if (/^L\d/.test(ligne)) return 'lianes'
  if (/^[DP]\d/.test(ligne)) return 'scolaires'
  if (/^\d+$/.test(ligne) && Number(ligne) > 50) return 'periurbaines'
  return 'urbaines'
}

/** Lignes du réseau (une par numéro public, tous tracés confondus), dans l'ordre naturel. */
export function lignesBus(reseau: ReseauBus): LigneBus[] {
  const lignes = new Map<string, LigneBus>()
  for (const { ligne, couleur, couleurTexte } of reseau.parcours) {
    if (!lignes.has(ligne)) lignes.set(ligne, { ligne, couleur, couleurTexte, categorie: categorieBus(ligne) })
  }
  return [...lignes.values()].sort((a, b) => a.ligne.localeCompare(b.ligne, 'fr', { numeric: true }))
}

/**
 * Lignes masquées, mémorisées dans le navigateur. `null` : le choix par défaut, qui masque les
 * scolaires (une centaine de lignes, quelques courses par jour).
 */
export interface ChoixLignesBus {
  masquees: string[] | null
}

export const CHOIX_LIGNES_BUS_DEFAUT: ChoixLignesBus = { masquees: null }

export function lignesMasquees(choix: ChoixLignesBus, lignes: LigneBus[]): Set<string> {
  return new Set(choix.masquees ?? lignes.filter((l) => l.categorie === 'scolaires').map((l) => l.ligne))
}

/** Réseau restreint aux lignes affichées. */
export function filtrerReseauBus(reseau: ReseauBus, masquees: Set<string>): ReseauBus {
  return { ...reseau, parcours: reseau.parcours.filter((p) => !masquees.has(p.ligne)) }
}
