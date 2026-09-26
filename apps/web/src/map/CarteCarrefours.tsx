import type { Bbox, CarrefourResume, CarrefoursGeoJson, FeuResume, FeuxGeoJson } from '@voirie/schema'
import type { Map as CarteMapLibre } from 'maplibre-gl'
import { useState } from 'react'
import Map, { Layer, NavigationControl, Popup, Source, type MapLayerMouseEvent } from 'react-map-gl/maplibre'
import { coucheCarrefours, coucheFeux } from './couches'

/** Centre de Besançon (Pont Battant). */
const VUE_INITIALE = { longitude: 6.0241, latitude: 47.2378, zoom: 13.5 }

/** Style vectoriel libre, sans clé d'API. Attribution OSM incluse dans le style. */
const STYLE_CARTE = 'https://tiles.openfreemap.org/styles/liberty'

const NATURES: Record<CarrefourResume['nature'], string> = {
  carrefour: 'Carrefour à feux',
  traversee_pietonne: 'Traversée piétonne à feux',
}

const STATUTS: Record<CarrefourResume['statut'], string> = {
  a_confirmer: 'à confirmer',
  non_releve: 'non relevée',
  estime: 'estimée',
  mesure: 'mesurée',
  verifie: 'vérifiée',
}

function emprise(carte: CarteMapLibre): Bbox {
  const limites = carte.getBounds()
  return [limites.getWest(), limites.getSouth(), limites.getEast(), limites.getNorth()]
}

type Bulle =
  | { type: 'carrefour'; longitude: number; latitude: number; carrefour: CarrefourResume }
  | { type: 'feu'; longitude: number; latitude: number; feu: FeuResume }

interface Props {
  carrefours: CarrefoursGeoJson | undefined
  feux: FeuxGeoJson | undefined
  /** null hors édition ; en édition, les feux sélectionnés et le carrefour modifié (null si nouveau). */
  edition: { selection: string[]; carrefourId: string | null } | null
  onEmprise: (bbox: Bbox) => void
  onBasculerFeu: (feu: FeuResume) => void
  onComposerDepuis: (feu: FeuResume) => void
  onModifier: (carrefour: CarrefourResume) => void
  onSupprimer: (carrefour: CarrefourResume) => void
}

export function CarteCarrefours(props: Props) {
  const { carrefours, feux, edition } = props
  const [bulle, setBulle] = useState<Bulle>()
  const [survol, setSurvol] = useState(false)

  const cliquer = (evenement: MapLayerMouseEvent) => {
    const objet = evenement.features?.[0]
    const { lng: longitude, lat: latitude } = evenement.lngLat
    if (!objet) return setBulle(undefined)

    if (objet.layer.id === 'feux') {
      const feu = objet.properties as FeuResume
      if (edition) return props.onBasculerFeu(feu)
      const carrefour = feu.carrefour_id
        ? carrefours?.features.find((f) => f.id === feu.carrefour_id)?.properties
        : undefined
      return setBulle(
        carrefour ? { type: 'carrefour', longitude, latitude, carrefour } : { type: 'feu', longitude, latitude, feu },
      )
    }
    if (!edition) setBulle({ type: 'carrefour', longitude, latitude, carrefour: objet.properties as CarrefourResume })
  }

  return (
    <Map
      initialViewState={VUE_INITIALE}
      mapStyle={STYLE_CARTE}
      style={{ width: '100%', height: '100%' }}
      hash
      interactiveLayerIds={['feux', 'carrefours']}
      cursor={survol ? 'pointer' : 'grab'}
      onMouseEnter={() => setSurvol(true)}
      onMouseLeave={() => setSurvol(false)}
      onClick={cliquer}
      onLoad={(evenement) => props.onEmprise(emprise(evenement.target))}
      onMoveEnd={(evenement) => props.onEmprise(emprise(evenement.target))}
    >
      <NavigationControl position="top-right" />
      {carrefours && (
        <Source id="carrefours" type="geojson" data={carrefours}>
          <Layer {...coucheCarrefours(edition !== null)} />
        </Source>
      )}
      {feux && (
        <Source id="feux" type="geojson" data={feux}>
          <Layer {...coucheFeux(edition?.selection ?? [], edition?.carrefourId ?? null, edition !== null)} />
        </Source>
      )}

      {bulle && !edition && (
        <Popup
          longitude={bulle.longitude}
          latitude={bulle.latitude}
          offset={10}
          closeOnClick={false}
          onClose={() => setBulle(undefined)}
        >
          {bulle.type === 'carrefour' ? (
            <>
              <strong>{bulle.carrefour.nom}</strong>
              <div>{NATURES[bulle.carrefour.nature]}</div>
              <div>
                {bulle.carrefour.nb_feux} feu(x) · programmation {STATUTS[bulle.carrefour.statut]}
              </div>
              {bulle.carrefour.pres_tram && <div>Tram à proximité (priorité probable)</div>}
              <div className="actions">
                <button onClick={() => (setBulle(undefined), props.onModifier(bulle.carrefour))}>Modifier</button>
                <button className="danger" onClick={() => (setBulle(undefined), props.onSupprimer(bulle.carrefour))}>
                  Supprimer
                </button>
              </div>
            </>
          ) : (
            <>
              <strong>Feu {bulle.feu.type === 'pieton' ? 'piéton' : 'véhicule'} libre</strong>
              {bulle.feu.osm_id && <div>Nœud OSM {bulle.feu.osm_id}</div>}
              {!bulle.feu.present_osm && <div>Disparu d'OpenStreetMap</div>}
              <div className="actions">
                <button onClick={() => (setBulle(undefined), props.onComposerDepuis(bulle.feu))}>
                  Composer un carrefour
                </button>
              </div>
            </>
          )}
        </Popup>
      )}
    </Map>
  )
}
