import type { ExpressionSpecification } from 'maplibre-gl'
import type { CircleLayerSpecification } from 'react-map-gl/maplibre'
import { STATUT } from '../theme/couleurs'

export const COULEURS = {
  selection: '#2f6fd6',
  feuLibre: '#e0561e',
  feuRattache: '#4b5563',
  feuAutreCarrefour: '#c3c8d1',
  statut: STATUT,
} as const

const estTraversee: ExpressionSpecification = ['==', ['get', 'nature'], 'traversee_pietonne']

/** Carrefours : disques pleins de loin, halos discrets de près pour laisser voir les feux. */
export function coucheCarrefours(edition: boolean): CircleLayerSpecification {
  return {
    id: 'carrefours',
    type: 'circle',
    source: 'carrefours',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, ['case', estTraversee, 2.5, 4], 17, ['case', estTraversee, 14, 26]],
      'circle-color': [
        'match',
        ['get', 'statut'],
        'a_confirmer', COULEURS.statut.a_confirmer,
        'estime', COULEURS.statut.estime,
        'mesure', COULEURS.statut.mesure,
        'verifie', COULEURS.statut.verifie,
        COULEURS.statut.non_releve,
      ],
      'circle-opacity': ['interpolate', ['linear'], ['zoom'], 14, edition ? 0.4 : 0.9, 16, 0.18],
      'circle-stroke-width': 1.5,
      'circle-stroke-color': '#ffffff',
    },
  }
}

/**
 * Feux : orange s'ils sont libres, gris s'ils appartiennent déjà à un carrefour, bleus s'ils
 * sont sélectionnés. En édition, les feux d'un autre carrefour sont estompés.
 */
export function coucheFeux(selection: string[], carrefourEdite: string | null, edition: boolean): CircleLayerSpecification {
  const libre: ExpressionSpecification = ['==', ['get', 'carrefour_id'], null]
  const autreCarrefour: ExpressionSpecification = ['all', ['!', libre], ['!=', ['get', 'carrefour_id'], carrefourEdite ?? '']]
  return {
    id: 'feux',
    type: 'circle',
    source: 'feux',
    minzoom: 14,
    paint: {
      'circle-radius': [
        'interpolate', ['linear'], ['zoom'],
        14, ['case', ['==', ['get', 'type'], 'pieton'], 2, 3],
        18, ['case', ['==', ['get', 'type'], 'pieton'], 6, 8],
      ],
      'circle-color': [
        'case',
        ['in', ['get', 'id'], ['literal', selection]], COULEURS.selection,
        edition ? autreCarrefour : ['literal', false], COULEURS.feuAutreCarrefour,
        libre, COULEURS.feuLibre,
        COULEURS.feuRattache,
      ],
      'circle-stroke-width': ['case', ['==', ['get', 'present_osm'], false], 2, 1],
      'circle-stroke-color': ['case', ['==', ['get', 'present_osm'], false], '#c0392b', '#ffffff'],
    },
  }
}
