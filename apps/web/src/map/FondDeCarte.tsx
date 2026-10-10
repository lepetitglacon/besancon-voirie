import { useEffect, useState } from 'react'
import { Layer, NavigationControl, Source, useMap } from 'react-map-gl/maplibre'
import { aujourdhuiA, clarte, melanger, positionSoleil } from './soleil'

export type Fond = 'satellite' | 'plan'

export interface OptionsFond {
  fond: Fond
  batiments: boolean
  /** Interrupteur général des options 3D ci-dessous, qui ne comptent que s'il est actif. */
  affichage3d: boolean
  /** Bâtiments extrudés (avec `batiments`). Coûteux pour la carte graphique. */
  batiments3d: boolean
  /** Terrain en volume, la photo drapée dessus. Coûteux pour la carte graphique. */
  elevation: boolean
  /** Éclairage selon la position du soleil : ombrage du relief, faces des bâtiments, ciel, nuit. */
  soleil: boolean
  /** Heure simulée, en minutes depuis minuit ; null pour l'heure réelle. */
  heure: number | null
}

/** Orthophotos IGN (Géoplateforme, Licence Ouverte Etalab), sans clé, 20 cm/pixel. */
const ORTHO_IGN =
  'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS' +
  '&STYLE=normal&TILEMATRIXSET=PM&FORMAT=image/jpeg&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}'
const ATTRIBUTION_IGN = 'Photos : <a href="https://geoservices.ign.fr/">IGN</a> (Licence Ouverte)'

/** Altitudes Terrarium (Mapzen, AWS Open Data), sans clé, ~30 m de précision en France. */
const MNT_TERRARIUM = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'
const ATTRIBUTION_MNT = 'Relief : <a href="https://github.com/tilezen/joerd">Mapzen Terrarium</a>'
const SOURCE_MNT = 'mnt'
/** Le relief bisontin (collines de 100 à 200 m) se lit mieux un peu accentué. */
const EXAGERATION_RELIEF = 1.3

/** Sources du style OpenFreeMap « liberty ». */
const SOURCES_PLAN = new Set(['openmaptiles', 'ne2_shaded'])
/** Couches de décor masquées sous la photo : on n'y garde que les libellés (type symbol). */
const TYPES_DECOR = new Set(['fill', 'line', 'raster'])
const BATIMENTS_2D = 'building'
const BATIMENTS_3D = 'building-3d'
const INCLINAISON_3D = 50

const CIEL_JOUR = '#88c6fc'
const CIEL_NUIT = '#0b1026'
const HORIZON_JOUR = '#e8f2ff'
const HORIZON_CREPUSCULE = '#ff9a5c'
const LUMIERE_RASANTE = '#ffb36b'
const LUMIERE_ZENITH = '#ffffff'
/** Lumière par défaut de MapLibre, rétablie quand la simulation est coupée. */
const LUMIERE_DEFAUT = { anchor: 'viewport', position: [1.15, 210, 30], color: '#ffffff', intensity: 0.5 } as const

/** Heure réelle, rafraîchie chaque minute tant qu'elle sert. */
function useMaintenant(actif: boolean): Date {
  const [maintenant, setMaintenant] = useState(() => new Date())
  useEffect(() => {
    if (!actif) return undefined
    const rafraichir = () => setMaintenant(new Date())
    const immediat = setTimeout(rafraichir, 0)
    const minuteur = setInterval(rafraichir, 60_000)
    return () => {
      clearTimeout(immediat)
      clearInterval(minuteur)
    }
  }, [actif])
  return maintenant
}

/**
 * Règle le fond de la carte : photo aérienne avec les libellés du plan, ou plan seul ; bâtiments
 * à plat, en relief ou masqués ; terrain en volume et ombré. En affichage 3D, la carte s'incline et
 * tourne (clic droit ou Ctrl + glisser, deux doigts, boussole) ; sinon elle revient à plat, nord en haut.
 *
 * Le soleil simulé oriente l'ombrage du relief et l'éclairage des bâtiments, assombrit la photo
 * la nuit et colore le ciel. MapLibre ne calcule pas d'ombres portées (bâtiment sur la rue).
 */
export function FondDeCarte(options: OptionsFond) {
  const { fond, batiments, affichage3d } = options
  const batiments3d = affichage3d && options.batiments3d
  const elevation = affichage3d && options.elevation
  const soleil = affichage3d && options.soleil
  const inclinable = affichage3d

  const maintenant = useMaintenant(soleil && options.heure === null)
  const { azimut, hauteur } = positionSoleil(options.heure === null ? maintenant : aujourdhuiA(options.heure))
  const jour = clarte(hauteur)
  /** 0 au ras de l'horizon, 1 dès 30° : la lumière rasante est orangée. */
  const montee = Math.min(1, Math.max(0, hauteur / 30))

  const { current: carte } = useMap()

  useEffect(() => {
    if (!carte) return
    const m = carte.getMap()
    const appliquer = () => {
      for (const couche of m.getStyle().layers) {
        if (!('source' in couche) || !SOURCES_PLAN.has(couche.source)) continue
        if (couche.id === BATIMENTS_2D || couche.id === BATIMENTS_3D || !TYPES_DECOR.has(couche.type)) continue
        m.setLayoutProperty(couche.id, 'visibility', fond === 'plan' ? 'visible' : 'none')
      }
      if (m.getLayer(BATIMENTS_2D) && m.getLayer(BATIMENTS_3D)) {
        // Sans relief, les bâtiments restent à plat à tous les zooms (le style passe en 3D dès 14).
        m.setLayerZoomRange(BATIMENTS_2D, 13, batiments3d ? 14 : 24)
        m.setLayoutProperty(BATIMENTS_2D, 'visibility', batiments ? 'visible' : 'none')
        m.setLayoutProperty(BATIMENTS_3D, 'visibility', batiments && batiments3d ? 'visible' : 'none')
      }
      if (m.getSource(SOURCE_MNT)) {
        m.setTerrain(elevation ? { source: SOURCE_MNT, exaggeration: EXAGERATION_RELIEF } : null)
      }
      if (soleil) {
        m.setLight({
          anchor: 'map',
          position: [1.5, azimut, 90 - Math.min(89, Math.max(1, hauteur))],
          color: melanger(LUMIERE_RASANTE, LUMIERE_ZENITH, montee),
          intensity: 0.15 + 0.45 * jour,
        })
        m.setSky({
          'sky-color': melanger(CIEL_NUIT, CIEL_JOUR, jour),
          'horizon-color': melanger(CIEL_NUIT, melanger(HORIZON_CREPUSCULE, HORIZON_JOUR, montee), jour),
          'fog-color': melanger(CIEL_NUIT, HORIZON_JOUR, jour),
          'sky-horizon-blend': 0.5,
          'horizon-fog-blend': 0.6,
          'fog-ground-blend': 0.8,
        })
      } else {
        m.setLight({ ...LUMIERE_DEFAUT, position: [...LUMIERE_DEFAUT.position] })
        m.setSky({})
      }
      m.setMaxPitch(inclinable ? 70 : 0)
      if (inclinable && m.getPitch() === 0) m.easeTo({ pitch: INCLINAISON_3D })
      if (!inclinable && m.getBearing() !== 0) m.easeTo({ bearing: 0 })
    }
    // Pas isStyleLoaded() : il reste faux tant qu'une source charge des données, ce qui arrive
    // juste après un clic sur une couche ; seules les couches du style doivent exister.
    if (m.getLayer('background')) {
      appliquer()
      return undefined
    }
    const surStyle = () => {
      if (!m.getLayer('background')) return
      m.off('styledata', surStyle)
      appliquer()
    }
    m.on('styledata', surStyle)
    return () => {
      m.off('styledata', surStyle)
    }
  }, [carte, fond, batiments, batiments3d, elevation, soleil, azimut, hauteur, jour, montee, inclinable])

  return (
    <>
      {affichage3d && <NavigationControl position="bottom-right" visualizePitch showZoom={false} />}
      <Source
        id={SOURCE_MNT}
        type="raster-dem"
        tiles={[MNT_TERRARIUM]}
        encoding="terrarium"
        tileSize={256}
        maxzoom={15}
        attribution={ATTRIBUTION_MNT}
      >
        {/* Au-dessus de la photo, sous les libellés du plan. */}
        <Layer
          id="ombrage"
          type="hillshade"
          beforeId="natural_earth"
          layout={{ visibility: soleil && hauteur > -6 ? 'visible' : 'none' }}
          paint={{
            'hillshade-illumination-anchor': 'map',
            'hillshade-illumination-direction': azimut,
            'hillshade-illumination-altitude': Math.min(90, Math.max(2, hauteur)),
            'hillshade-exaggeration': 0.8 * jour,
            'hillshade-shadow-color': '#000000',
            'hillshade-highlight-color': melanger(LUMIERE_RASANTE, LUMIERE_ZENITH, montee),
            'hillshade-accent-color': '#000000',
          }}
        />
      </Source>
      <Source
        id="ign-ortho"
        type="raster"
        tiles={[ORTHO_IGN]}
        tileSize={256}
        maxzoom={19}
        attribution={ATTRIBUTION_IGN}
      >
        <Layer
          id="ign-ortho"
          type="raster"
          beforeId="natural_earth"
          layout={{ visibility: fond === 'satellite' ? 'visible' : 'none' }}
          paint={{
            'raster-brightness-max': soleil ? 0.2 + 0.8 * jour : 1,
            'raster-saturation': soleil ? -0.6 * (1 - jour) : 0,
          }}
        />
      </Source>
    </>
  )
}
