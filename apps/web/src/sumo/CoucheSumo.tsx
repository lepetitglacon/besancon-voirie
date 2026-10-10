import type { MapLayerMouseEvent } from 'maplibre-gl'
import { useEffect } from 'react'
import { Layer, Source, useMap, type LineLayerSpecification } from 'react-map-gl/maplibre'
import { etatSumo, tranche, useDonneesEssai, useEtatSumo } from './etat'
import { INDICATEURS, type Indicateur } from './indicateurs'

const SOURCE = 'sumo-troncons'

/** Couleur et épaisseur lues dans l'état de chaque tronçon (`v` : valeur, `d` : débit) ; sans valeur, invisible. */
function couche(indicateur: Indicateur): LineLayerSpecification {
  const valeur = ['coalesce', ['feature-state', 'v'], -1]
  return {
    id: SOURCE,
    type: 'line',
    source: SOURCE,
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      'line-color': [
        'step',
        valeur,
        indicateur.paliers[0]!.couleur,
        ...indicateur.paliers.slice(0, -1).flatMap((palier, k) => [palier.jusqua, indicateur.paliers[k + 1]!.couleur]),
      ] as unknown as string,
      // Épaisseur selon le débit, quel que soit l'indicateur.
      'line-width': [
        'interpolate',
        ['linear'],
        ['zoom'],
        12,
        ['interpolate', ['linear'], ['coalesce', ['feature-state', 'd'], 0], 0, 1, 1000, 5],
        17,
        ['interpolate', ['linear'], ['coalesce', ['feature-state', 'd'], 0], 0, 3, 1000, 14],
      ] as unknown as number,
      'line-opacity': ['case', ['<', valeur, 0], 0, 0.9] as unknown as number,
    },
  }
}

const coucheChoisi: LineLayerSpecification = {
  id: `${SOURCE}-choisi`,
  type: 'line',
  source: SOURCE,
  layout: { 'line-join': 'round', 'line-cap': 'round' },
  // Liseré de part et d'autre du trait, au-dessus de la couche colorée.
  paint: {
    'line-color': '#ffffff',
    'line-width': 2,
    'line-gap-width': ['interpolate', ['linear'], ['zoom'], 12, 6, 17, 16],
  },
}

/** Tronçons de l'essai choisi, colorés d'après l'indicateur à l'heure de la timeline ou sur tout l'essai. */
export function CoucheSumo() {
  const { current: carte } = useMap()
  const { essai, troncons, series } = useDonneesEssai()
  const cle = useEtatSumo((e) => e.indicateur)
  const statistique = useEtatSumo((e) => e.statistique)
  const choisi = useEtatSumo((e) => e.troncon)
  const afficher = useEtatSumo((e) => e.afficherTroncons)
  const t = useEtatSumo((e) => (essai ? tranche(e.temps, essai.debut, essai.pas, essai.tranches) : 0))
  const indicateur = INDICATEURS[cle]
  // Valeurs dans l'état des entités : rien à reconstruire côté source, seul le style se recalcule.
  // La source n'existe qu'après le premier rendu, et ses données se chargent en tâche de fond :
  // tout de suite si elle est prête, sinon dès qu'elle l'est.
  useEffect(() => {
    const map = carte?.getMap()
    if (!map || !essai || !troncons || !series) return
    const appliquer = () => {
      const agregat = statistique === 'instant' ? null : indicateur.agregats[statistique]
      for (const { properties: troncon } of troncons.features) {
        const v = agregat ? agregat(troncon) : series.valeur(cle, t, troncon)
        const d = statistique === 'instant' ? series.valeur('debit', t, troncon) : troncon.debitMax
        map.setFeatureState({ source: SOURCE, id: troncon.i }, { v, d })
      }
    }
    if (map.getSource(SOURCE) && map.isSourceLoaded(SOURCE)) {
      appliquer()
      return
    }
    const auChargement = (e: { sourceId?: string; isSourceLoaded?: boolean }) => {
      if (e.sourceId !== SOURCE || !e.isSourceLoaded) return
      map.off('sourcedata', auChargement)
      appliquer()
    }
    map.on('sourcedata', auChargement)
    return () => {
      map.off('sourcedata', auChargement)
    }
  }, [carte, essai, troncons, series, cle, indicateur, statistique, t])

  useEffect(() => {
    if (!carte) return
    const auClic = (evenement: MapLayerMouseEvent) => {
      const i = evenement.features?.[0]?.id
      if (typeof i === 'number') etatSumo.modifier({ troncon: i })
    }
    carte.on('click', SOURCE, auClic)
    return () => {
      carte.off('click', SOURCE, auClic)
    }
  }, [carte])

  if (!troncons) return null
  return (
    <Source id={SOURCE} type="geojson" data={troncons}>
      <Layer {...couche(indicateur)} layout={{ ...couche(indicateur).layout, visibility: afficher ? 'visible' : 'none' }} />
      <Layer
        {...coucheChoisi}
        layout={{ ...coucheChoisi.layout, visibility: afficher ? 'visible' : 'none' }}
        filter={['==', ['id'], choisi ?? -1]}
      />
    </Source>
  )
}
