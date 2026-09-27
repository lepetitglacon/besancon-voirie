import { Badge, Box, Button, Text } from '@chakra-ui/react'
import type { LonLat } from '@voirie/engine'
import type { Bbox, CarrefourResume, CarrefoursGeoJson, EmpriseIa, FeuResume, FeuxGeoJson } from '@voirie/schema'
import type { Map as CarteMapLibre } from 'maplibre-gl'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import Map, {
  Layer,
  Source,
  type MapLayerMouseEvent,
  type MapMouseEvent,
  type MapRef,
} from 'react-map-gl/maplibre'
import { CalqueCarrefour, type ApercuFeu, type ClicCalque, type FeuPlacable } from '../configuration/calque/CalqueCarrefour'
import type { Poignee } from '../configuration/modele'
import type { AffichageConfiguration } from '../configuration/ConfigurationCarrefour'
import { Aide, BarreOutils, ControleZoom, Pastille, PopupCarte, PopupSurCarte } from '../ds'
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
  /** Clic sur un feu pendant la configuration : choix des feux d'une ligne, ou popup du feu. */
  onClicFeuConfiguration: (feu: FeuResume, position: LonLat) => void
  /** Clic ailleurs pendant la configuration : sur le carrefour configuré (`centre`) ou dans le vide. */
  onClicCarteConfiguration: (cible: 'centre' | 'vide', position: LonLat) => void
  /** Clic sur un élément du calque (voie, connexion, code de branche). */
  onClicCalque: (clic: ClicCalque) => void
  /** Reçoit l'élément où rendre le contenu de la popup de configuration (portail). */
  onCiblePopup: (cible: HTMLElement | null) => void
  /** Clic droit : position, pour le menu contextuel. */
  onMenuContextuel: (position: LonLat) => void
  /** Glisser-déposer dans l'éditeur de configuration. */
  onDeplacerPoignee: (poignee: Poignee, position: LonLat) => void
  onConnecter: (de: string, vers: string) => void
  /** Voie tracée à la main dans le carrefour configuré : [bout côté carrefour, bout éloigné]. */
  onTracerVoie: (geom: [LonLat, LonLat]) => void
  /** Zone de la photo IA tracée sur la carte : [ouest, sud, est, nord]. */
  onDessinerZoneIa: (emprise: EmpriseIa) => void
  /** Pose un feu sur son mât, ou le remet à sa position OSM (null). */
  onPlacerFeu: (id: string, position: LonLat | null) => Promise<void>
}

/** Zoom utilisé pour configurer un carrefour. */
const ZOOM_CONFIGURATION = 18.3

export function CarteCarrefours(props: Props) {
  const { carrefours, edition, configuration, afficherCarrefours, fond, children, onCiblePopup } = props
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
  // Rectangle tracé à la souris : feux à ajouter au carrefour composé, ou zone de la photo IA.
  const zoneIa = configuration?.cadreIa != null
  const traceActif = zoneIa || (edition !== null && (edition.modeRectangle || majEnfoncee))

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
    if (zoneIa) {
      const sudOuest = evenement.target.unproject([Math.min(debut.x, x), Math.max(debut.y, y)])
      const nordEst = evenement.target.unproject([Math.max(debut.x, x), Math.min(debut.y, y)])
      return props.onDessinerZoneIa([sudOuest.lng, sudOuest.lat, nordEst.lng, nordEst.lat])
    }
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
      setBulle(undefined)
      if (objet?.layer.id === 'feux') return props.onClicFeuConfiguration(objet.properties as FeuResume, [longitude, latitude])
      const centre = objet?.layer.id === 'carrefours' && objet.properties.id === configuration.carrefourId
      return props.onClicCarteConfiguration(centre ? 'centre' : 'vide', [longitude, latitude])
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
      id="carte"
      ref={carte}
      initialViewState={VUE_INITIALE}
      mapStyle={STYLE_CARTE}
      style={{ width: '100%', height: '100%' }}
      hash
      attributionControl={{ compact: true }}
      interactiveLayerIds={['feux', 'carrefours']}
      cursor={traceActif ? 'crosshair' : survol ? 'pointer' : 'grab'}
      dragPan={!traceActif}
      boxZoom={edition === null}
      onMouseDown={commencerTrace}
      onMouseMove={suivreTrace}
      onMouseUp={terminerTrace}
      onMouseEnter={() => setSurvol(true)}
      onMouseLeave={() => setSurvol(false)}
      onClick={cliquer}
      onContextMenu={(evenement) => props.onMenuContextuel([evenement.lngLat.lng, evenement.lngLat.lat])}
      onLoad={(evenement) => {
        // Attribution repliée (bouton « i ») : dépliée, elle passerait sous la barre d'outils.
        evenement.target.getContainer().querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show')
        props.onEmprise(emprise(evenement.target))
      }}
      onMoveEnd={(evenement) => props.onEmprise(emprise(evenement.target))}
    >
      <ControleZoom position="absolute" top="4" right="4" zIndex="1" />
      <FondDeCarte {...fond} />
      {children}
      {rectangle && (
        <Box
          position="absolute"
          zIndex="2"
          borderWidth="2px"
          borderStyle="dashed"
          borderColor="brand.solid"
          bg="color-mix(in srgb, var(--chakra-colors-brand-solid) 12%, transparent)"
          pointerEvents="none"
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
          onTracer={props.onTracerVoie}
          feuxPlacables={feuxPlacables}
          onPlacerFeu={props.onPlacerFeu}
          onApercuFeu={setApercuFeu}
          onClic={props.onClicCalque}
          selection={configuration.selection}
          cadrePhoto={configuration.cadreIa}
        />
      )}
      {configuration?.ancre && (
        <PopupSurCarte longitude={configuration.ancre[0]} latitude={configuration.ancre[1]} closeOnClick={false}>
          <div ref={onCiblePopup} />
        </PopupSurCarte>
      )}

      {bulle && !edition && !configuration && (
        <PopupSurCarte longitude={bulle.longitude} latitude={bulle.latitude} closeOnClick={false} onClose={() => setBulle(undefined)}>
          {bulle.type === 'carrefour' ? (
            <PopupCarte
              titre={bulle.carrefour.nom}
              soustitre={NATURES[bulle.carrefour.nature]}
              onFermer={() => setBulle(undefined)}
              pied={
                <>
                  <Button variant="plain" colorPalette="red" px="2" onClick={() => (setBulle(undefined), props.onSupprimer(bulle.carrefour))}>
                    Supprimer
                  </Button>
                  <BarreOutils.Espace />
                  <Button onClick={() => (setBulle(undefined), props.onModifier(bulle.carrefour))}>Feux</Button>
                  <Button
                    variant="solid"
                    onClick={() => {
                      const objet = carrefours?.features.find((f) => f.id === bulle.carrefour.id)
                      setBulle(undefined)
                      if (objet) props.onConfigurer(bulle.carrefour, objet.geometry.coordinates)
                    }}
                  >
                    Configurer
                  </Button>
                </>
              }
            >
              <Text display="flex" alignItems="center" gap="2">
                <Pastille couleur={`statut.${bulle.carrefour.statut}`} />
                {bulle.carrefour.nb_feux} feu(x) · programmation {STATUTS[bulle.carrefour.statut]}
              </Text>
              {bulle.carrefour.pres_tram && (
                <Badge colorPalette="orange" alignSelf="start">
                  Tram à proximité (priorité probable)
                </Badge>
              )}
            </PopupCarte>
          ) : (
            <PopupCarte
              titre={`Feu ${bulle.feu.type === 'pieton' ? 'piéton' : 'véhicule'} libre`}
              soustitre={bulle.feu.osm_id ? `Nœud OSM ${bulle.feu.osm_id}` : undefined}
              onFermer={() => setBulle(undefined)}
              pied={
                <>
                  <BarreOutils.Espace />
                  <Button variant="solid" onClick={() => (setBulle(undefined), props.onComposerDepuis(bulle.feu))}>
                    Composer un carrefour
                  </Button>
                </>
              }
            >
              {!bulle.feu.present_osm && <Badge colorPalette="red" alignSelf="start">Disparu d'OpenStreetMap</Badge>}
              {bulle.feu.position_manuelle && <Aide>Placé sur son mât (position OSM conservée)</Aide>}
            </PopupCarte>
          )}
        </PopupSurCarte>
      )}
    </Map>
  )
}
