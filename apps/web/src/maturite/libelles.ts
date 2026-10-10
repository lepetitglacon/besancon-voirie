import type { EtatNiveau, NiveauChaine } from '@voirie/schema'

/** Niveaux de la chaîne des données (docs/pipeline-donnees.md). */
export const NIVEAUX: Array<{ niveau: NiveauChaine; libelle: string; titre: string }> = [
  { niveau: 'N2', libelle: 'Carrefour', titre: 'Carrefour modélisé : branches, voies, connexions' },
  { niveau: 'N3', libelle: 'Feux', titre: 'Fonctionnement : lignes de feux, programme' },
  { niveau: 'N4', libelle: 'SUMO', titre: 'Sorties : export SUMO' },
]

export const COULEURS_ETAT: Record<EtatNiveau, string> = { ok: 'fg.success', avertissement: 'fg.warning', erreur: 'fg.error' }
export const SYMBOLES_ETAT: Record<EtatNiveau, string> = { ok: '✔', avertissement: '⚠', erreur: '✖' }
