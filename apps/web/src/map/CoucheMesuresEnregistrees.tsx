import { useMemo } from 'react'
import { Layer, Source } from 'react-map-gl/maplibre'
import { COULEUR_MESURE, COULEUR_MESURE_VISEE, distancesMesure, formaterDistance } from './mesure'
import type { MesureEnregistree } from './useMesures'

interface Props {
  mesures: MesureEnregistree[]
  /** Mesure survolée dans la liste, surlignée. */
  survolee: string | null
}

/** Mesures enregistrées, en lecture seule : tracé, extrémités et nom le long de la ligne. */
export function CoucheMesuresEnregistrees({ mesures, survolee }: Props) {
  const donnees = useMemo(
    () => ({
      type: 'FeatureCollection' as const,
      features: mesures.flatMap((m) => {
        const vise = m.id === survolee
        const libelle = `${m.nom} · ${formaterDistance(distancesMesure(m.points).total)}`
        return [
          ...(m.points.length > 1
            ? [{ type: 'Feature' as const, properties: { vise, libelle }, geometry: { type: 'LineString' as const, coordinates: m.points } }]
            : []),
          ...m.points.map((p) => ({ type: 'Feature' as const, properties: { vise, sommet: true }, geometry: { type: 'Point' as const, coordinates: p } })),
        ]
      }),
    }),
    [mesures, survolee],
  )
  const couleur = ['case', ['get', 'vise'], COULEUR_MESURE_VISEE, COULEUR_MESURE] as unknown as string

  return (
    <Source id="mesures-enregistrees" type="geojson" data={donnees}>
      <Layer
        id="mesures-enregistrees-ligne"
        type="line"
        filter={['==', ['geometry-type'], 'LineString']}
        layout={{ 'line-cap': 'round', 'line-join': 'round', 'line-sort-key': ['case', ['get', 'vise'], 1, 0] as unknown as number }}
        paint={{ 'line-color': couleur, 'line-width': ['case', ['get', 'vise'], 4, 2.5] as unknown as number, 'line-opacity': 0.9 }}
      />
      <Layer
        id="mesures-enregistrees-sommets"
        type="circle"
        filter={['has', 'sommet']}
        paint={{ 'circle-radius': 4, 'circle-color': couleur, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.5 }}
      />
      <Layer
        id="mesures-enregistrees-noms"
        type="symbol"
        filter={['==', ['geometry-type'], 'LineString']}
        layout={{
          'symbol-placement': 'line-center',
          'text-field': ['get', 'libelle'],
          'text-size': 12,
          'text-font': ['Noto Sans Regular'],
          'text-offset': [0, -0.9],
          'text-allow-overlap': true,
        }}
        paint={{ 'text-color': '#ffffff', 'text-halo-color': '#3d2a06', 'text-halo-width': 1.5 }}
      />
    </Source>
  )
}
