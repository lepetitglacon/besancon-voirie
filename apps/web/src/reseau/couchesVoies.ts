/** Couches MapLibre de l'éditeur des voies : lesquelles répondent au pointeur, et où les insérer. */
import { useMap } from 'react-map-gl/maplibre'
import type { OutilReseau } from './CoucheReseau'

/** Outil actif : `autre` pour les outils propres au carrefour ouvert (poser ses feux). */
export type OutilVoies = OutilReseau | 'autre'

/**
 * Zones de prise, invisibles et plus larges que ce qu'elles couvrent (un nœud, une poignée, une
 * liaison de 2,5 px) : c'est elles que visent le pointeur et les clics.
 */
export const ZONES = {
  noeuds: 'reseau-voies-noeuds-zone',
  arrivees: 'reseau-poignees-arrivees-zone',
  liaisons: 'reseau-liaisons-zone',
} as const

/** Zones de prise de l'outil Forme (CoucheForme) : sommets et milieux des segments. */
export const ZONES_FORME = { sommets: 'reseau-forme-sommets-zone', milieux: 'reseau-forme-milieux-zone' } as const

/**
 * Axe des tronçons au cœur d'un carrefour : le carrefour est une boîte noire (ses liaisons vont
 * d'une branche à l'autre), on n'en dessine pas les voies.
 */
export const COUCHE_COEUR = 'reseau-voies-coeur'

/** Couches de CoucheVoies qui répondent au pointeur selon l'outil (curseur de la carte, survols). */
export function couchesInteractivesVoies(outil: OutilVoies | null): string[] {
  if (outil === 'selection' || outil === 'couper' || outil === 'passage') return [ZONES.noeuds, 'reseau-voies']
  if (outil === 'voie' || outil === 'emprise') return ['reseau-voies']
  if (outil === 'forme') return ['reseau-voies', ZONES_FORME.sommets, ZONES_FORME.milieux]
  if (outil === 'noeuds' || outil === 'embranchements') return [ZONES.noeuds]
  if (outil === 'connecter') return [ZONES.arrivees, ZONES.liaisons]
  return []
}

/**
 * Couche sous laquelle dessiner le réseau : les feux restent au-dessus, même quand le réseau
 * arrive après eux sur la carte (ouverture de l'éditeur, passage au zoom des voies). Le disque
 * des carrefours reste dessous : au zoom des voies, on vise les nœuds qu'il recouvre.
 */
export function useCoucheDessous(): string | undefined {
  const { current: carte } = useMap()
  const map = carte?.getMap()
  return ['feux', 'carrefours'].find((id) => map?.getLayer(id))
}
