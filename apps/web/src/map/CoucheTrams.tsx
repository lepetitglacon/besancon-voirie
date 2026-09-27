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
import type { Coordonnees } from '@voirie/engine'
import { Aide, PopupCarte } from '../ds'
import {
  positionnerRames,
  preparerReseau,
  type ProprietesRame,
  type SuiviRames,
} from '../tram/positionsTrams'

const ATTRIBUTION = 'Tram : <a href="https://api.ginko.voyage/">Ginko</a> (ODbL)'

/** Données initiales des sources animées : la boucle d'animation les remplace à chaque image. */
const VIDE = { type: 'FeatureCollection', features: [] } as const

/**
 * Économie de rendu : chaque envoi de données redessine toute la carte (GPU). On n'envoie que si
 * une rame a bougé d'au moins ça à l'écran, et au moins une fois par intervalle (zones, textes).
 */
const DEPLACEMENT_MIN_PX = 0.5
const ENVOI_MAX_MS = 1000

/** Couches tram affichées. */
export interface CouchesTram {
  lignes: boolean
  arrets: boolean
  zones: boolean
  rames: boolean
}

const visibilite = (visible: boolean) => (visible ? 'visible' : 'none')

const coucheLignes: LineLayerSpecification = {
  id: 'tram-lignes',
  type: 'line',
  source: 'tram-lignes',
  layout: { 'line-cap': 'round', 'line-join': 'round' },
  paint: { 'line-color': ['get', 'couleur'], 'line-width': 3, 'line-opacity': 0.8 },
}

const coucheArrets: CircleLayerSpecification = {
  id: 'tram-arrets',
  type: 'circle',
  source: 'tram-arrets',
  minzoom: 12,
  paint: {
    'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 2, 17, 6],
    'circle-color': '#ffffff',
    'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 12, 1, 17, 2],
    'circle-stroke-color': ['get', 'couleur'],
  },
}

/** Noms des arrêts. Les quais des deux sens sont proches : la collision n'en garde qu'un. */
const coucheNomsArrets: SymbolLayerSpecification = {
  id: 'tram-noms-arrets',
  type: 'symbol',
  source: 'tram-arrets',
  minzoom: 14.5,
  layout: {
    'text-field': ['get', 'nom'],
    'text-font': ['Noto Sans Regular'],
    'text-size': 11,
    'text-anchor': 'top',
    'text-offset': [0, 0.8],
  },
  paint: { 'text-color': '#1d2330', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 },
}

/** Portion de voie où la rame peut se trouver. */
const coucheZones: LineLayerSpecification = {
  id: 'tram-zones',
  type: 'line',
  source: 'tram-zones',
  layout: { 'line-cap': 'round', 'line-join': 'round' },
  paint: {
    'line-color': ['get', 'couleur'],
    'line-width': ['interpolate', ['linear'], ['zoom'], 12, 8, 17, 18],
    'line-opacity': 0.35,
  },
}

const coucheRames: CircleLayerSpecification = {
  id: 'tram-rames',
  type: 'circle',
  source: 'tram-rames',
  paint: {
    'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 5, 17, 9],
    'circle-color': ['get', 'couleur'],
    'circle-opacity': ['match', ['get', 'etat'], 'au_terminus', 0.5, 1],
    'circle-stroke-width': 2,
    'circle-stroke-color': '#ffffff',
  },
}

/** Couches tram, de bas en haut, au-dessus de tout le reste : les rames en premier plan. */
const ORDRE_COUCHES = [
  'tram-lignes',
  'tram-pertes',
  'tram-zones',
  'tram-arrets',
  'tram-noms-arrets',
  'tram-rames',
]

/**
 * Remet les couches tram dans l'ordre, au-dessus des autres. react-map-gl ajoute les couches au
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

function DetailRame({ rame, onFermer }: { rame: ProprietesRame; onFermer: () => void }) {
  return (
    <PopupCarte taille="compacte" titre={`${rame.ligne} → ${rame.destination}`} soustitre={`Rame ${rame.vehicule}`} onFermer={onFermer}>
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
  reseau: ReseauTram
  tempsReel: TramsTempsReel | undefined
  couches: CouchesTram
}

/**
 * Lignes de tram et rames en temps réel. Les positions sont estimées (packages/engine) et
 * recalculées à chaque image, hors de React : les sources MapLibre et la bulle de détail
 * sont mises à jour directement, React ne rafraîchit que le texte de la bulle, chaque seconde.
 */
export function CoucheTrams({ reseau, tempsReel, couches }: Props) {
  const { current: carte } = useMap()
  const prepare = useMemo(() => preparerReseau(reseau), [reseau])
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

  // Boucle d'animation : une estimation lissée par image, envoyée à la carte seulement si elle
  // change quelque chose à l'écran.
  useEffect(() => {
    if (!carte) return
    const carteMapLibre = carte.getMap()
    const suivi: SuiviRames = new Map()
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
      const positions = positionnerRames(prepare, donnees.current, maintenant, suivi)
      derniereImage.current = positions
      const rame = rameAffichee(choisie.current)
      if (rame) bulle.setLngLat(rame.geometry.coordinates)

      const aJour =
        envoi.donnees === donnees.current &&
        envoi.couches === visibles &&
        maintenant - envoi.instant < ENVOI_MAX_MS &&
        !aBouge(positions.rames)
      if (aJour) return
      if (visibles.zones) carte.getSource<GeoJSONSource>('tram-zones')?.setData(positions.zones)
      if (visibles.rames) carte.getSource<GeoJSONSource>('tram-rames')?.setData(positions.rames)
      envoi.instant = maintenant
      envoi.donnees = donnees.current
      envoi.couches = visibles
      envoi.rames = new Map(positions.rames.features.map((f) => [f.properties.vehicule, f.geometry.coordinates]))
    }
    image = requestAnimationFrame(animer)
    return () => cancelAnimationFrame(image)
  }, [carte, prepare, bulle])

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
    carte.on('click', 'tram-rames', auClic)
    carte.on('mouseenter', 'tram-rames', survol)
    carte.on('mouseleave', 'tram-rames', sortie)
    return () => {
      carte.off('click', 'tram-rames', auClic)
      carte.off('mouseenter', 'tram-rames', survol)
      carte.off('mouseleave', 'tram-rames', sortie)
    }
  }, [carte])

  return (
    <>
      <Source id="tram-lignes" type="geojson" data={prepare.lignes} attribution={ATTRIBUTION}>
        <Layer {...coucheLignes} layout={{ ...coucheLignes.layout, visibility: visibilite(couches.lignes) }} />
      </Source>
      <Source id="tram-zones" type="geojson" data={VIDE}>
        <Layer {...coucheZones} layout={{ ...coucheZones.layout, visibility: visibilite(couches.zones) }} />
      </Source>
      <Source id="tram-arrets" type="geojson" data={prepare.arrets}>
        <Layer {...coucheArrets} layout={{ visibility: visibilite(couches.arrets) }} />
        <Layer
          {...coucheNomsArrets}
          layout={{ ...coucheNomsArrets.layout, visibility: visibilite(couches.arrets) }}
        />
      </Source>
      <Source id="tram-rames" type="geojson" data={VIDE}>
        <Layer {...coucheRames} layout={{ visibility: visibilite(couches.rames) }} />
      </Source>
      {selection !== undefined && detail && createPortal(<DetailRame rame={detail} onFermer={() => bulle.remove()} />, contenuBulle)}
    </>
  )
}
