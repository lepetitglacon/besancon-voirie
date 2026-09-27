import type { LonLat } from '@voirie/engine'
import type { Bbox, CarrefourResume, CarrefoursGeoJson, FeuResume, FeuxGeoJson } from '@voirie/schema'
import type { Map as CarteMapLibre } from 'maplibre-gl'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import Map, {
  Layer,
  NavigationControl,
  Popup,
  Source,
  type MapLayerMouseEvent,
  type MapMouseEvent,
  type MapRef,
} from 'react-map-gl/maplibre'
import { CalqueCarrefour, type ApercuFeu, type FeuPlacable } from '../configuration/calque/CalqueCarrefour'
import type { Poignee } from '../configuration/modele'
import type { AffichageConfiguration } from '../configuration/PanneauConfiguration'
import { coucheCarrefours, coucheFeux } from './couches'
import { FondDeCarte, type OptionsFond } from './FondDeCarte'

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

interface Rectangle {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** En dessous de cette taille (px), un glisser est traité comme un simple clic. */
const TAILLE_MIN_RECTANGLE = 4

/** Suit l'état de la touche Maj, pour la sélection par Maj + glisser. */
function useMajEnfoncee(): boolean {
  const [enfoncee, setEnfoncee] = useState(false)
  useEffect(() => {
    const suivre = (e: KeyboardEvent) => setEnfoncee(e.shiftKey)
    const relacher = () => setEnfoncee(false)
    window.addEventListener('keydown', suivre)
    window.addEventListener('keyup', suivre)
    window.addEventListener('blur', relacher)
    return () => {
      window.removeEventListener('keydown', suivre)
      window.removeEventListener('keyup', suivre)
      window.removeEventListener('blur', relacher)
    }
  }, [])
  return enfoncee
}

type Bulle =
  | { type: 'carrefour'; longitude: number; latitude: number; carrefour: CarrefourResume }
  | { type: 'feu'; longitude: number; latitude: number; feu: FeuResume }

interface Props {
  carrefours: CarrefoursGeoJson | undefined
  afficherCarrefours: boolean
  fond: OptionsFond
  /** Couches supplémentaires (trams…). */
  children?: ReactNode
  feux: FeuxGeoJson | undefined
  /** null hors édition ; en édition, les feux sélectionnés et le carrefour modifié (null si nouveau). */
  edition: { selection: string[]; carrefourId: string | null; modeRectangle: boolean } | null
  onEmprise: (bbox: Bbox) => void
  onBasculerFeu: (feu: FeuResume) => void
  /** Feux couverts par un rectangle tracé en mode composition. */
  onAjouterFeux: (feux: FeuResume[]) => void
  onComposerDepuis: (feu: FeuResume) => void
  onModifier: (carrefour: CarrefourResume) => void
  onSupprimer: (carrefour: CarrefourResume) => void
  onConfigurer: (carrefour: CarrefourResume, position: [number, number]) => void
  /** Carrefour en cours de configuration : voies et connexions dessinées, bulles désactivées. */
  configuration: (AffichageConfiguration & { carrefourId: string; position: [number, number] }) | null
  /** Clic sur un feu pendant la configuration (choix des feux d'une ligne). */
  onClicFeuConfiguration: (feu: FeuResume) => void
  /** Glisser-déposer dans l'éditeur de configuration. */
  onDeplacerPoignee: (poignee: Poignee, position: LonLat) => void
  onConnecter: (de: string, vers: string) => void
  /** Pose un feu sur son mât, ou le remet à sa position OSM (null). */
  onPlacerFeu: (id: string, position: LonLat | null) => Promise<void>
}

/** Zoom utilisé pour configurer un carrefour. */
const ZOOM_CONFIGURATION = 18.3

export function CarteCarrefours(props: Props) {
  const { carrefours, edition, configuration, afficherCarrefours, fond, children } = props
  const carte = useRef<MapRef>(null)

  // Feux du carrefour configuré, déplaçables ; celui qu'on tire est dessiné à sa nouvelle place.
  const [apercuFeu, setApercuFeu] = useState<ApercuFeu | null>(null)
  const idConfigure = configuration?.carrefourId
  const feuxPlacables = useMemo(
    () =>
      (props.feux?.features ?? [])
        .filter((f) => f.properties.carrefour_id === idConfigure)
        .map(
          ({ id, geometry, properties: p }): FeuPlacable => ({
            id,
            type: p.type,
            position: geometry.coordinates,
            osm: p.osm_lon === null || p.osm_lat === null ? null : [p.osm_lon, p.osm_lat],
            placeALaMain: p.position_manuelle,
          }),
        ),
    [props.feux, idConfigure],
  )
  const feux = useMemo(() => {
    if (!props.feux || !apercuFeu) return props.feux
    return {
      ...props.feux,
      features: props.feux.features.map((f) =>
        f.id === apercuFeu.id ? { ...f, geometry: { ...f.geometry, coordinates: apercuFeu.position } } : f,
      ),
    }
  }, [props.feux, apercuFeu])

  // Recentre la carte sur le carrefour quand on entre en configuration.
  const [lon, lat] = configuration?.position ?? []
  useEffect(() => {
    if (lon !== undefined && lat !== undefined) {
      carte.current?.flyTo({ center: [lon, lat], zoom: ZOOM_CONFIGURATION, duration: 800 })
    }
  }, [lon, lat])

  const [bulle, setBulle] = useState<Bulle>()
  const [survol, setSurvol] = useState(false)
  const [rectangle, setRectangle] = useState<Rectangle | null>(null)
  const depart = useRef<{ x: number; y: number } | null>(null)
  const majEnfoncee = useMajEnfoncee()
  const traceActif = edition !== null && (edition.modeRectangle || majEnfoncee)

  const commencerTrace = (evenement: MapMouseEvent) => {
    if (!traceActif) return
    depart.current = evenement.point
    setRectangle({ x0: evenement.point.x, y0: evenement.point.y, x1: evenement.point.x, y1: evenement.point.y })
  }

  const suivreTrace = (evenement: MapMouseEvent) => {
    if (!depart.current) return
    setRectangle({ x0: depart.current.x, y0: depart.current.y, x1: evenement.point.x, y1: evenement.point.y })
  }

  const terminerTrace = (evenement: MapMouseEvent) => {
    const debut = depart.current
    depart.current = null
    setRectangle(null)
    if (!debut) return
    const { x, y } = evenement.point
    if (Math.abs(x - debut.x) < TAILLE_MIN_RECTANGLE && Math.abs(y - debut.y) < TAILLE_MIN_RECTANGLE) return
    const couverts = evenement.target.queryRenderedFeatures(
      [
        [Math.min(debut.x, x), Math.min(debut.y, y)],
        [Math.max(debut.x, x), Math.max(debut.y, y)],
      ],
      { layers: ['feux'] },
    )
    const parId = new globalThis.Map(couverts.map((f) => [f.properties.id as string, f.properties as FeuResume]))
    props.onAjouterFeux([...parId.values()])
  }

  const cliquer = (evenement: MapLayerMouseEvent) => {
    const objet = evenement.features?.[0]
    const { lng: longitude, lat: latitude } = evenement.lngLat
    if (configuration) {
      if (objet?.layer.id === 'feux') props.onClicFeuConfiguration(objet.properties as FeuResume)
      return setBulle(undefined)
    }
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
      ref={carte}
      initialViewState={VUE_INITIALE}
      mapStyle={STYLE_CARTE}
      style={{ width: '100%', height: '100%' }}
      hash
      interactiveLayerIds={configuration ? ['feux'] : ['feux', 'carrefours']}
      cursor={traceActif ? 'crosshair' : survol ? 'pointer' : 'grab'}
      dragPan={!traceActif}
      boxZoom={edition === null}
      onMouseDown={commencerTrace}
      onMouseMove={suivreTrace}
      onMouseUp={terminerTrace}
      onMouseEnter={() => setSurvol(true)}
      onMouseLeave={() => setSurvol(false)}
      onClick={cliquer}
      onLoad={(evenement) => props.onEmprise(emprise(evenement.target))}
      onMoveEnd={(evenement) => props.onEmprise(emprise(evenement.target))}
    >
      <NavigationControl position="top-right" visualizePitch={fond.relief3d} />
      <FondDeCarte {...fond} />
      {children}
      {rectangle && (
        <div
          className="rectangle-selection"
          style={{
            left: Math.min(rectangle.x0, rectangle.x1),
            top: Math.min(rectangle.y0, rectangle.y1),
            width: Math.abs(rectangle.x1 - rectangle.x0),
            height: Math.abs(rectangle.y1 - rectangle.y0),
          }}
        />
      )}
      {carrefours && (
        <Source id="carrefours" type="geojson" data={carrefours}>
          <Layer {...coucheCarrefours(edition !== null)} layout={{ visibility: afficherCarrefours ? 'visible' : 'none' }} />
        </Source>
      )}
      {feux && (
        <Source id="feux" type="geojson" data={feux}>
          <Layer
            {...(configuration
              ? coucheFeux(configuration.feuxSurlignes, configuration.carrefourId, true)
              : coucheFeux(edition?.selection ?? [], edition?.carrefourId ?? null, edition !== null))}
          />
        </Source>
      )}
      {configuration && (
        <CalqueCarrefour
          branches={configuration.branches}
          connexions={configuration.connexions}
          mode={configuration.mode}
          surlignees={new Set(configuration.connexionsSurlignees)}
          feux={configuration.feux}
          onDeplacer={props.onDeplacerPoignee}
          onConnecter={props.onConnecter}
          feuxPlacables={feuxPlacables}
          onPlacerFeu={props.onPlacerFeu}
          onApercuFeu={setApercuFeu}
        />
      )}

      {bulle && !edition && !configuration && (
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
                <button
                  className="principal"
                  onClick={() => {
                    const objet = carrefours?.features.find((f) => f.id === bulle.carrefour.id)
                    setBulle(undefined)
                    if (objet) props.onConfigurer(bulle.carrefour, objet.geometry.coordinates)
                  }}
                >
                  Configurer
                </button>
                <button onClick={() => (setBulle(undefined), props.onModifier(bulle.carrefour))}>Feux</button>
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
              {bulle.feu.position_manuelle && <div>Placé sur son mât (position OSM conservée)</div>}
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
