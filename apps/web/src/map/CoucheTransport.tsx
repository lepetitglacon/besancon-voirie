import type { ReseauTram, TramsTempsReel } from '@voirie/schema'
import {
  Popup as PopupMapLibre,
  type GeoJSONSource,
  type Map as CarteMapLibre,
  type MapLayerMouseEvent,
} from 'maplibre-gl'
import { Text } from '@chakra-ui/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Layer,
  Source,
  useMap,
  type CircleLayerSpecification,
  type LineLayerSpecification,
  type SymbolLayerSpecification,
} from 'react-map-gl/maplibre'
import { PARAMETRES_BUS, PARAMETRES_TRAM, type Coordonnees } from '@voirie/engine'
import { Aide, EtiquetteVehicule, PopupCarte } from '../ds'
import { fournirIcones, idIcone } from './iconesVehicules'
import {
  positionnerRames,
  preparerReseau,
  type ProprietesRame,
  type SuiviRames,
} from '../tram/positionsTrams'

/** Réglages de dessin et d'estimation propres à chaque mode. */
const STYLES = {
  tram: {
    attribution: 'Tram : <a href="https://api.ginko.voyage/">Ginko</a> (ODbL)',
    vehicule: 'Rame',
    largeurLigne: 3,
    minzoomArrets: 12,
    minzoomNoms: 14.5,
    opaciteZone: 0.35,
    parametres: PARAMETRES_TRAM,
  },
  bus: {
    attribution: 'Bus : <a href="https://api.ginko.voyage/">Ginko</a> (ODbL)',
    vehicule: 'Bus',
    largeurLigne: 2,
    minzoomArrets: 14,
    minzoomNoms: 16,
    // Sur une ligne de même couleur : plus marquée que celle du tram pour se détacher du tracé.
    opaciteZone: 0.45,
    parametres: PARAMETRES_BUS,
  },
} as const

export type Transport = keyof typeof STYLES

/** Données initiales des sources animées : la boucle d'animation les remplace à chaque image. */
const VIDE = { type: 'FeatureCollection', features: [] } as const

/**
 * Économie de rendu : chaque envoi de données redessine toute la carte (GPU). On n'envoie que si
 * un véhicule a bougé d'au moins ça à l'écran, et au moins une fois par intervalle (zones, textes).
 */
const DEPLACEMENT_MIN_PX = 0.5
const ENVOI_MAX_MS = 1000

/** Couches d'un mode affichées. */
export interface CouchesTram {
  lignes: boolean
  arrets: boolean
  zones: boolean
  rames: boolean
}

const visibilite = (visible: boolean) => (visible ? 'visible' : 'none')

function specifications(transport: Transport) {
  const style = STYLES[transport]
  const lignes: LineLayerSpecification = {
    id: `${transport}-lignes`,
    type: 'line',
    source: `${transport}-lignes`,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': ['get', 'couleur'], 'line-width': style.largeurLigne, 'line-opacity': 0.8 },
  }
  const arrets: CircleLayerSpecification = {
    id: `${transport}-arrets`,
    type: 'circle',
    source: `${transport}-arrets`,
    minzoom: style.minzoomArrets,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], style.minzoomArrets, 2, 17, transport === 'tram' ? 6 : 4],
      'circle-color': '#ffffff',
      'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], style.minzoomArrets, 1, 17, 2],
      'circle-stroke-color': ['get', 'couleur'],
    },
  }
  /** Noms des arrêts. Les quais des deux sens sont proches : la collision n'en garde qu'un. */
  const nomsArrets: SymbolLayerSpecification = {
    id: `${transport}-noms-arrets`,
    type: 'symbol',
    source: `${transport}-arrets`,
    minzoom: style.minzoomNoms,
    layout: {
      'text-field': ['get', 'nom'],
      'text-font': ['Noto Sans Regular'],
      'text-size': 11,
      'text-anchor': 'top',
      'text-offset': [0, 0.8],
    },
    paint: { 'text-color': '#1d2330', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 },
  }
  /** Traînée : portion de voie où le véhicule peut se trouver. */
  const zones: LineLayerSpecification = {
    id: `${transport}-zones`,
    type: 'line',
    source: `${transport}-zones`,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': ['get', 'couleur'],
      'line-width': ['interpolate', ['linear'], ['zoom'], 12, 8, 17, 18],
      'line-opacity': style.opaciteZone,
    },
  }
  /**
   * Véhicules : étiquette pictogramme + numéro de ligne (iconesVehicules), plus petite de loin.
   * Toutes affichées, même superposées : un véhicule masqué serait un véhicule perdu.
   */
  const rames: SymbolLayerSpecification = {
    id: `${transport}-rames`,
    type: 'symbol',
    source: `${transport}-rames`,
    layout: {
      'icon-image': ['concat', idIcone(transport, ''), ['get', 'ligne']],
      'icon-size': ['interpolate', ['linear'], ['zoom'], 11, transport === 'tram' ? 0.7 : 0.55, 15, 1, 18, 1.15],
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      // Les véhicules en ligne devant ceux qui attendent au terminus.
      'symbol-sort-key': ['match', ['get', 'etat'], 'au_terminus', 0, 1],
    },
    paint: { 'icon-opacity': ['match', ['get', 'etat'], 'au_terminus', 0.55, 1] },
  }
  return { lignes, arrets, nomsArrets, zones, rames }
}

/** Couches des deux modes, de bas en haut, au-dessus de tout le reste : les trams en premier plan. */
const ORDRE_COUCHES = [
  'bus-lignes',
  'bus-zones',
  'bus-arrets',
  'bus-noms-arrets',
  'bus-rames',
  'tram-lignes',
  'tram-pertes',
  'tram-zones',
  'tram-arrets',
  'tram-noms-arrets',
  'tram-rames',
]

/**
 * Remet les couches tram et bus dans l'ordre, au-dessus des autres. Les deux modes partagent cet
 * ordre : chacun le rétablit sans défaire celui de l'autre. react-map-gl ajoute les couches au
 * fil des rendus sans garantir leur ordre (rechargement à chaud, couches ajoutées ensuite par un
 * autre composant) : un arrêt pourrait alors recouvrir la rame à quai.
 */
function garderDevant(carte: CarteMapLibre) {
  const ordre = carte.getLayersOrder()
  const presentes = ORDRE_COUCHES.filter((id) => ordre.includes(id))
  const enTete = ordre.slice(-presentes.length)
  if (presentes.some((id, i) => enTete[i] !== id)) {
    for (const id of presentes) carte.moveLayer(id)
  }
}

function duree(secondes: number): string {
  if (secondes < 60) return `${Math.max(secondes, 0)} s`
  return `${Math.round(secondes / 60)} min`
}

function DetailRame({ rame, transport, onFermer }: { rame: ProprietesRame; transport: Transport; onFermer: () => void }) {
  return (
    <PopupCarte
      taille="compacte"
      icone={<EtiquetteVehicule mode={transport} ligne={rame.ligne} couleur={rame.couleur} couleurTexte={rame.couleurTexte} />}
      titre={`${rame.ligne} → ${rame.destination}`}
      soustitre={`${STYLES[transport].vehicule} ${rame.vehicule}`}
      onFermer={onFermer}
    >
      {rame.etat === 'au_terminus' ? (
        <Text>
          Au terminus {rame.arretSuivant}, départ dans {duree(rame.restant)}
        </Text>
      ) : (
        <>
          <Text>
            {rame.arretPrecedent} → {rame.arretSuivant}
          </Text>
          <Text>
            {rame.aQuai === 'precedent'
              ? `À quai à ${rame.arretPrecedent}, départ dans ${duree(rame.departDans ?? 0)}`
              : rame.aQuai === 'suivant'
                ? `À quai à ${rame.arretSuivant}`
                : `Arrivée prévue dans ${duree(rame.restant)}`}
          </Text>
          <Text>
            Vitesse moyenne du tronçon : {rame.vitesse} km/h · zone probable : {rame.zone} m
          </Text>
          <Aide textStyle="2xs">
            {rame.sourceDuree === 'historique'
              ? `Durée du tronçon : médiane de ${rame.echantillons} passages observés`
              : rame.sourceDuree === 'flux'
                ? 'Durée du tronçon : prévisions Ginko (historique insuffisant)'
                : 'Durée du tronçon : horaires théoriques (historique insuffisant)'}
          </Aide>
        </>
      )}
    </PopupCarte>
  )
}

interface Props {
  transport: Transport
  reseau: ReseauTram
  /** Pour les bus, `trams` porte les bus (même estimation). */
  tempsReel: TramsTempsReel | undefined
  couches: CouchesTram
}

/**
 * Lignes de tram ou de bus et véhicules en temps réel. Les positions sont estimées
 * (packages/engine) et recalculées à chaque image, hors de React : les sources MapLibre et la
 * bulle de détail sont mises à jour directement, React ne rafraîchit que le texte de la bulle,
 * chaque seconde. La traînée (zone probable) montre où le véhicule peut se trouver.
 */
export function CoucheTransport({ transport, reseau, tempsReel, couches }: Props) {
  const { current: carte } = useMap()
  const prepare = useMemo(() => preparerReseau(reseau), [reseau])
  const specs = useMemo(() => specifications(transport), [transport])
  const [selection, setSelection] = useState<string>()
  const [detail, setDetail] = useState<ProprietesRame>()

  // Lus par la boucle d'animation sans la relancer.
  const donnees = useRef(tempsReel)
  const choisie = useRef(selection)
  const couchesVisibles = useRef(couches)
  const derniereImage = useRef<ReturnType<typeof positionnerRames>>(undefined)
  useEffect(() => {
    donnees.current = tempsReel
  }, [tempsReel])
  useEffect(() => {
    couchesVisibles.current = couches
  }, [couches])
  useEffect(() => {
    choisie.current = selection
  }, [selection])

  const [contenuBulle] = useState(() => document.createElement('div'))
  const [bulle] = useState(() => new PopupMapLibre({ offset: 12, closeOnClick: false, closeButton: false, maxWidth: 'none', className: 'popup-carte-ancre' }))

  const rameAffichee = (vehicule: string | undefined) =>
    derniereImage.current?.rames.features.find((rame) => rame.properties.vehicule === vehicule)

  // Étiquettes des véhicules, dessinées à la demande aux couleurs de chaque ligne.
  useEffect(() => {
    if (!carte) return
    const lignes = new Map(reseau.parcours.map((p) => [p.ligne, p]))
    return fournirIcones(carte.getMap(), transport, (ligne) => lignes.get(ligne))
  }, [carte, reseau, transport])

  // Boucle d'animation : une estimation lissée par image, envoyée à la carte seulement si elle
  // change quelque chose à l'écran.
  useEffect(() => {
    if (!carte) return
    const carteMapLibre = carte.getMap()
    const suivi: SuiviRames = new Map()
    const { parametres } = STYLES[transport]
    const envoi = { instant: 0, donnees: undefined as unknown, couches: undefined as unknown, rames: new Map<string, Coordonnees>() }
    const aBouge = (rames: ReturnType<typeof positionnerRames>['rames']) => {
      if (rames.features.length !== envoi.rames.size) return true
      return rames.features.some(({ properties, geometry }) => {
        const avant = envoi.rames.get(properties.vehicule)
        if (!avant) return true
        const a = carteMapLibre.project(avant)
        const b = carteMapLibre.project(geometry.coordinates)
        return Math.hypot(a.x - b.x, a.y - b.y) >= DEPLACEMENT_MIN_PX
      })
    }
    let image = 0
    const animer = () => {
      image = requestAnimationFrame(animer)
      garderDevant(carteMapLibre)
      const visibles = couchesVisibles.current
      if (!donnees.current || (!visibles.rames && !visibles.zones)) return
      const maintenant = Date.now()
      const positions = positionnerRames(prepare, donnees.current, maintenant, suivi, parametres)
      derniereImage.current = positions
      const rame = rameAffichee(choisie.current)
      if (rame) bulle.setLngLat(rame.geometry.coordinates)

      const aJour =
        envoi.donnees === donnees.current &&
        envoi.couches === visibles &&
        maintenant - envoi.instant < ENVOI_MAX_MS &&
        !aBouge(positions.rames)
      if (aJour) return
      if (visibles.zones) carte.getSource<GeoJSONSource>(`${transport}-zones`)?.setData(positions.zones)
      if (visibles.rames) carte.getSource<GeoJSONSource>(`${transport}-rames`)?.setData(positions.rames)
      envoi.instant = maintenant
      envoi.donnees = donnees.current
      envoi.couches = visibles
      envoi.rames = new Map(positions.rames.features.map((f) => [f.properties.vehicule, f.geometry.coordinates]))
    }
    image = requestAnimationFrame(animer)
    return () => cancelAnimationFrame(image)
  }, [carte, prepare, bulle, transport])

  // Bulle de détail : ouverte sur la rame choisie, texte rafraîchi chaque seconde.
  useEffect(() => {
    if (!carte || selection === undefined) return
    const rafraichir = () => setDetail(rameAffichee(selection)?.properties)
    const rame = rameAffichee(selection)
    // Contenu rattaché à l'ouverture : en StrictMode, l'initialiseur de `bulle` s'exécute deux fois.
    if (rame) bulle.setDOMContent(contenuBulle).setLngLat(rame.geometry.coordinates).addTo(carte.getMap())
    rafraichir()
    const fermer = () => setSelection(undefined)
    bulle.on('close', fermer)
    const minuterie = setInterval(rafraichir, 1000)
    return () => {
      clearInterval(minuterie)
      bulle.off('close', fermer)
      bulle.remove()
    }
  }, [carte, bulle, contenuBulle, selection])

  useEffect(() => {
    if (!carte) return
    const auClic = (evenement: MapLayerMouseEvent) => {
      const vehicule = evenement.features?.[0]?.properties?.vehicule
      if (vehicule !== undefined) setSelection(String(vehicule))
    }
    const survol = () => (carte.getCanvas().style.cursor = 'pointer')
    const sortie = () => (carte.getCanvas().style.cursor = '')
    const couche = `${transport}-rames`
    carte.on('click', couche, auClic)
    carte.on('mouseenter', couche, survol)
    carte.on('mouseleave', couche, sortie)
    return () => {
      carte.off('click', couche, auClic)
      carte.off('mouseenter', couche, survol)
      carte.off('mouseleave', couche, sortie)
    }
  }, [carte, transport])

  return (
    <>
      <Source id={`${transport}-lignes`} type="geojson" data={prepare.lignes} attribution={STYLES[transport].attribution}>
        <Layer {...specs.lignes} layout={{ ...specs.lignes.layout, visibility: visibilite(couches.lignes) }} />
      </Source>
      <Source id={`${transport}-zones`} type="geojson" data={VIDE}>
        <Layer {...specs.zones} layout={{ ...specs.zones.layout, visibility: visibilite(couches.zones) }} />
      </Source>
      <Source id={`${transport}-arrets`} type="geojson" data={prepare.arrets}>
        <Layer {...specs.arrets} layout={{ visibility: visibilite(couches.arrets) }} />
        <Layer {...specs.nomsArrets} layout={{ ...specs.nomsArrets.layout, visibility: visibilite(couches.arrets) }} />
      </Source>
      <Source id={`${transport}-rames`} type="geojson" data={VIDE}>
        <Layer {...specs.rames} layout={{ ...specs.rames.layout, visibility: visibilite(couches.rames) }} />
      </Source>
      {selection !== undefined &&
        detail &&
        createPortal(<DetailRame rame={detail} transport={transport} onFermer={() => bulle.remove()} />, contenuBulle)}
    </>
  )
}
