import { Badge, Box, Button } from '@chakra-ui/react'
import type { LonLat } from '@voirie/engine'
import type { Bbox, CarrefourResume, CarrefoursGeoJson, EmpriseIa, FeuResume, FeuxGeoJson } from '@voirie/schema'
import { AttributionControl, type Map as CarteMapLibre, type MapGeoJSONFeature } from 'maplibre-gl'
import { useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from 'react'
import Map, {
  Layer,
  Source,
  useMap,
  type MapLayerMouseEvent,
  type MapMouseEvent,
  type MapRef,
} from 'react-map-gl/maplibre'
import { CalqueCarrefour, type ApercuFeu, type ClicCalque, type FeuPlacable } from '../configuration/calque/CalqueCarrefour'
import { CalqueRues } from '../reseau/CalqueRues'
import type { Poignee } from '../configuration/modele'
import type { AffichageConfiguration } from '../configuration/ConfigurationCarrefour'
import { Aide, BarreOutils, ControleZoom, PopupCarte, PopupSurCarte } from '../ds'
import { coucheCarrefours, coucheFeux } from './couches'
import { FondDeCarte, type OptionsFond } from './FondDeCarte'

/** Centre de Besançon (Pont Battant). */
const VUE_INITIALE = { longitude: 6.0241, latitude: 47.2378, zoom: 13.5 }

/** Style vectoriel libre, sans clé d'API. Attribution OSM incluse dans le style. */
const STYLE_CARTE = 'https://tiles.openfreemap.org/styles/liberty'

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

/** Popup d'un feu libre (les carrefours s'affichent dans la carte d'en-tête). */
type Bulle = { longitude: number; latitude: number; feu: FeuResume }

interface Props {
  carrefours: CarrefoursGeoJson | undefined
  afficherCarrefours: boolean
  /** Mode Temps réel : carte en lecture seule, les feux sont dessinés par la couche temps réel. */
  tempsReel: boolean
  fond: OptionsFond
  /** Couches supplémentaires (trams…). */
  children?: ReactNode
  feux: FeuxGeoJson | undefined
  /** null hors édition ; en édition, les feux sélectionnés et le carrefour modifié (null si nouveau). */
  edition: { selection: string[]; carrefourId: string | null; modeRectangle: boolean } | null
  onEmprise: (bbox: Bbox, zoom: number) => void
  /**
   * Éditeur des voies sans carrefour ouvert : la couche du réseau gère les clics, sauf sur un
   * carrefour ou ses feux, qui l'ouvrent ; pas de bulle de feu.
   */
  reseauActif?: boolean
  /** Voies du réseau de la vue (éditeur des voies, zoom ≥ 16). */
  rues?: ComponentProps<typeof CalqueRues> | null
  /** Curseur imposé (tracé d'un tronçon). */
  curseur?: string
  onBasculerFeu: (feu: FeuResume) => void
  /** Feux couverts par un rectangle tracé en mode composition. */
  onAjouterFeux: (feux: FeuResume[]) => void
  onComposerDepuis: (feu: FeuResume) => void
  /** Clic sur un carrefour ou l'un de ses feux : il s'ouvre en configuration, à la place de celui qui l'était. */
  onOuvrir: (choix: { carrefour: CarrefourResume; position: [number, number] }) => void
  /** Carrefour en cours de configuration : voies et connexions dessinées, bulles désactivées. */
  configuration: (AffichageConfiguration & { carrefourId: string; position: [number, number] }) | null
  /** Clic sur un feu pendant la configuration : choix des feux d'une ligne, ou popup du feu. */
  onClicFeuConfiguration: (feu: FeuResume, position: LonLat) => void
  /** Clic ailleurs pendant la configuration : ferme la popup ouverte. */
  onClicCarteConfiguration: (position: [number, number]) => void
  /** Clic sur un élément du calque (voie, connexion, code de branche). */
  onClicCalque: (clic: ClicCalque) => void
  /** Reçoit l'élément où rendre le contenu de la popup de configuration (portail). */
  onCiblePopup: (cible: HTMLElement | null) => void
  /** Clic droit : position, pour le menu contextuel. */
  onMenuContextuel: (position: LonLat) => void
  /** Glisser-déposer dans l'éditeur de configuration. */
  onDeplacerPoignee: (poignee: Poignee, position: LonLat) => void
  onConnecter: (de: string, vers: string) => void
  /** Zone de la photo IA tracée sur la carte : [ouest, sud, est, nord]. */
  onDessinerZoneIa: (emprise: EmpriseIa) => void
  /** Pose un feu sur son mât, ou le remet à sa position OSM (null). */
  onPlacerFeu: (id: string, position: LonLat | null) => Promise<void>
}

/**
 * Au montage de la carte : attribution et première emprise. Sans attendre l'événement load,
 * qui se perd par moments (double montage de StrictMode) : les carrefours ne se chargeaient
 * alors qu'au premier déplacement.
 */
function Demarrage({ onEmprise }: { onEmprise: (bbox: Bbox, zoom: number) => void }) {
  const { current } = useMap()
  useEffect(() => {
    const carte = current?.getMap()
    if (!carte) return
    // En bas à gauche : le bas à droite accueille la carte de suivi.
    const attribution = new AttributionControl({ compact: true })
    carte.addControl(attribution, 'bottom-left')
    // Repliée (bouton « i ») : dépliée, elle passerait sous la barre d'outils. MapLibre la déplie
    // quand arrivent les premières attributions des sources : on la replie à ce moment-là.
    const conteneur = carte.getContainer().querySelector('.maplibregl-ctrl-attrib')
    const replier = new MutationObserver(() => {
      if (!conteneur?.classList.contains('maplibregl-compact-show')) return
      conteneur.classList.remove('maplibregl-compact-show')
      replier.disconnect()
    })
    if (conteneur) replier.observe(conteneur, { attributes: true, attributeFilter: ['class'] })
    onEmprise(emprise(carte), carte.getZoom())
    return () => {
      replier.disconnect()
      carte.removeControl(attribution)
    }
  }, [current, onEmprise])
  return null
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
  // Le panneau bas est fermé à l'ouverture : le décalage qu'il imposait est remis à zéro.
  useEffect(() => {
    if (lon !== undefined && lat !== undefined) {
      carte.current?.flyTo({
        center: [lon, lat],
        zoom: ZOOM_CONFIGURATION,
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
        duration: 800,
      })
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

  /** Carrefour visé par un clic : le disque du carrefour, ou l'un de ses feux. */
  const carrefourVise = (objet: MapGeoJSONFeature | undefined) => {
    const id =
      objet?.layer.id === 'carrefours'
        ? (objet.properties.id as string)
        : objet?.layer.id === 'feux' || objet?.layer.id === 'feux-temps-reel'
          ? (objet.properties as Pick<FeuResume, 'carrefour_id'>).carrefour_id
          : null
    const trouve = id ? carrefours?.features.find((f) => f.id === id) : undefined
    return trouve && { carrefour: trouve.properties, position: trouve.geometry.coordinates as [number, number] }
  }

  const cliquer = (evenement: MapLayerMouseEvent) => {
    const objet = evenement.features?.[0]
    const { lng: longitude, lat: latitude } = evenement.lngLat
    const vise = carrefourVise(objet)
    if (props.tempsReel || props.reseauActif) {
      if (vise) props.onOuvrir(vise)
      return
    }
    if (configuration) {
      setBulle(undefined)
      // Un autre carrefour remplace celui qu'on configure (ses brouillons sont conservés),
      // sauf pendant un tracé ou le choix des feux d'une ligne.
      const autre = vise && vise.carrefour.id !== configuration.carrefourId
      if (autre && configuration.mode !== null && !configuration.choixFeux) return props.onOuvrir(vise)
      if (objet?.layer.id === 'feux') return props.onClicFeuConfiguration(objet.properties as FeuResume, [longitude, latitude])
      return props.onClicCarteConfiguration([longitude, latitude])
    }
    if (edition) {
      if (objet?.layer.id === 'feux') props.onBasculerFeu(objet.properties as FeuResume)
      return
    }
    if (vise) {
      setBulle(undefined)
      return props.onOuvrir(vise)
    }
    setBulle(objet?.layer.id === 'feux' ? { longitude, latitude, feu: objet.properties as FeuResume } : undefined)
  }

  return (
    <Map
      id="carte"
      ref={carte}
      initialViewState={VUE_INITIALE}
      mapStyle={STYLE_CARTE}
      style={{ width: '100%', height: '100%' }}
      hash
      attributionControl={false}
      interactiveLayerIds={['feux', 'carrefours', 'feux-temps-reel']}
      cursor={props.curseur ?? (traceActif ? 'crosshair' : survol ? 'pointer' : 'grab')}
      dragPan={!traceActif}
      boxZoom={edition === null}
      onMouseDown={commencerTrace}
      onMouseMove={suivreTrace}
      onMouseUp={terminerTrace}
      onMouseEnter={() => setSurvol(true)}
      onMouseLeave={() => setSurvol(false)}
      onClick={cliquer}
      onContextMenu={(evenement) => props.onMenuContextuel([evenement.lngLat.lng, evenement.lngLat.lat])}
      onMoveEnd={(evenement) => props.onEmprise(emprise(evenement.target), evenement.target.getZoom())}
    >
      <Demarrage onEmprise={props.onEmprise} />
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
          <Layer
            {...coucheCarrefours(edition !== null, configuration?.carrefourId ?? null)}
            layout={{ visibility: afficherCarrefours ? 'visible' : 'none' }}
          />
        </Source>
      )}
      {feux && (
        <Source id="feux" type="geojson" data={feux}>
          <Layer
            {...(configuration
              ? coucheFeux(configuration.feuxSurlignes, configuration.carrefourId, true)
              : coucheFeux(edition?.selection ?? [], edition?.carrefourId ?? null, edition !== null))}
            layout={{ visibility: props.tempsReel ? 'none' : 'visible' }}
          />
        </Source>
      )}
      {props.rues && <CalqueRues {...props.rues} />}
      {configuration && (
        <CalqueCarrefour
          branches={configuration.branches}
          connexions={configuration.connexions}
          traces={configuration.traces}
          anneau={configuration.anneau}
          mode={configuration.mode}
          surlignees={new Set(configuration.connexionsSurlignees)}
          feux={configuration.feux}
          onDeplacer={props.onDeplacerPoignee}
          onConnecter={props.onConnecter}
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

      {bulle && !edition && !configuration && !props.reseauActif && (
        <PopupSurCarte longitude={bulle.longitude} latitude={bulle.latitude} closeOnClick={false} onClose={() => setBulle(undefined)}>
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
        </PopupSurCarte>
      )}
    </Map>
  )
}
