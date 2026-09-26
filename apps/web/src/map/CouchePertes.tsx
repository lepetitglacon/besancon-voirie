import type { HistoriqueTroncons, ReseauTram } from '@voirie/schema'
import type { MapLayerMouseEvent } from 'maplibre-gl'
import { useEffect, useMemo, useState } from 'react'
import { Layer, Popup, Source, useMap, type LineLayerSpecification } from 'react-map-gl/maplibre'
import { PALIERS_PERTE } from '../tram/pertes'
import { preparerReseau, tronconsObserves, type ProprietesTroncon } from '../tram/positionsTrams'

const couchePertes: LineLayerSpecification = {
  id: 'tram-pertes',
  type: 'line',
  source: 'tram-pertes',
  layout: { 'line-join': 'round' },
  paint: {
    'line-color': [
      'step',
      ['get', 'perte'],
      PALIERS_PERTE[0]!.couleur,
      ...PALIERS_PERTE.slice(0, -1).flatMap((palier, i) => [palier.jusqua, PALIERS_PERTE[i + 1]!.couleur]),
    ] as unknown as string,
    'line-width': ['interpolate', ['linear'], ['zoom'], 12, 5, 17, 12],
    // Un sens de chaque côté de la voie.
    'line-offset': ['interpolate', ['linear'], ['zoom'], 12, 3, 17, 7],
    // Moins de 5 passages : couleur indicative, estompée.
    'line-opacity': ['case', ['<', ['get', 'n'], 5], 0.35, 0.85],
  },
}

interface Props {
  reseau: ReseauTram
  historique: HistoriqueTroncons
}

/**
 * Données brutes : tronçons colorés par le temps perdu habituel, durée médiane observée sur le
 * créneau moins la durée quand ça roule bien (p10 toutes heures confondues).
 */
export function CouchePertes({ reseau, historique }: Props) {
  const { current: carte } = useMap()
  const donnees = useMemo(() => tronconsObserves(preparerReseau(reseau), historique), [reseau, historique])
  const [choisi, setChoisi] = useState<{ lngLat: [number, number]; troncon: ProprietesTroncon }>()

  useEffect(() => {
    if (!carte) return
    const auClic = (evenement: MapLayerMouseEvent) => {
      // Une rame cliquée a sa propre bulle.
      if (carte.getLayer('tram-rames') && carte.queryRenderedFeatures(evenement.point, { layers: ['tram-rames'] }).length) {
        return
      }
      const troncon = evenement.features?.[0]?.properties as ProprietesTroncon | undefined
      if (troncon) setChoisi({ lngLat: [evenement.lngLat.lng, evenement.lngLat.lat], troncon })
    }
    carte.on('click', 'tram-pertes', auClic)
    return () => {
      carte.off('click', 'tram-pertes', auClic)
    }
  }, [carte])

  return (
    <>
      <Source id="tram-pertes" type="geojson" data={donnees}>
        <Layer {...couchePertes} />
      </Source>
      {choisi && (
        <Popup
          longitude={choisi.lngLat[0]}
          latitude={choisi.lngLat[1]}
          closeOnClick={false}
          onClose={() => setChoisi(undefined)}
        >
          <div className="popup-rame">
            <strong>
              {choisi.troncon.ligne} · {choisi.troncon.depart} → {choisi.troncon.arrivee}
            </strong>
            <span>
              Durée habituelle {choisi.troncon.p50} s ({choisi.troncon.vitesse} km/h), temps perdu{' '}
              {choisi.troncon.perte} s
            </span>
            <span>
              Rapide {choisi.troncon.p10} s · lent {choisi.troncon.p90} s · fluide {choisi.troncon.reference} s
            </span>
            <span className="source">{choisi.troncon.n} passages observés</span>
          </div>
        </Popup>
      )}
    </>
  )
}
