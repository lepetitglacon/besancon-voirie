/**
 * Réglages des outils de l'éditeur des voies (docs/pipeline-donnees.md, étape 1) : ce que fait le
 * prochain geste de chaque outil. Gardés dans le navigateur d'une visite à l'autre.
 */
import type { TraverseePieton, TypeVoie } from '@voirie/schema'
import type { OutilReseau } from './CoucheReseau'

export interface ReglagesOutils {
  /** Tronçon tracé : nom, voies par sens et leur type, vitesse (null : celle du type de voie). */
  tracer: { nom: string | null; voies_avant: number; voies_arriere: number; type: TypeVoie; vitesse_kmh: number | null }
  /** Nœud posé en coupant une rue : rien (début de présélection), ligne d'arrêt à feux, passage piéton. */
  couper: { pose: 'rien' | 'feux' | 'pieton'; pieton: TraverseePieton }
  /** Voie ajoutée (au bord de la chaussée ou contre l'axe), ou retirée. */
  voie: { action: 'ajouter' | 'retirer'; type: TypeVoie; position: 'bord' | 'axe' }
  /** Passage piéton : tracé librement (deux clics), ou posé sur une rue ou un nœud. */
  passage: { mode: 'libre' | 'noeud'; pieton: TraverseePieton }
}

export const REGLAGES_DEFAUT: ReglagesOutils = {
  tracer: { nom: null, voies_avant: 1, voies_arriere: 1, type: 'generale', vitesse_kmh: null },
  couper: { pose: 'rien', pieton: 'marquee' },
  voie: { action: 'ajouter', type: 'generale', position: 'bord' },
  passage: { mode: 'libre', pieton: 'marquee' },
}

/** Réglages gardés lors d'une visite précédente, complétés de ceux ajoutés depuis (outil par outil). */
export const completerReglages = (lus: Partial<ReglagesOutils>): ReglagesOutils => ({
  tracer: { ...REGLAGES_DEFAUT.tracer, ...lus.tracer },
  couper: { ...REGLAGES_DEFAUT.couper, ...lus.couper },
  voie: { ...REGLAGES_DEFAUT.voie, ...lus.voie },
  passage: { ...REGLAGES_DEFAUT.passage, ...lus.passage },
})

export const TYPES_VOIE: Array<{ valeur: TypeVoie; libelle: string }> = [
  { valeur: 'generale', libelle: 'Générale' },
  { valeur: 'bus', libelle: 'Bus' },
  { valeur: 'velo', libelle: 'Vélo' },
  { valeur: 'tram', libelle: 'Tram' },
]

export const PASSAGES: Array<{ valeur: TraverseePieton; libelle: string }> = [
  { valeur: 'marquee', libelle: 'Marqué' },
  { valeur: 'feux', libelle: 'À feux' },
  { valeur: 'non_marquee', libelle: 'Non marqué' },
]

/** Outils qui ont des réglages. */
export const avecReglages = (outil: OutilReseau | null | undefined) => outil === 'tracer' || outil === 'couper' || outil === 'voie' || outil === 'passage'
