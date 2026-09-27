import type { FeuxTempsReel } from '@voirie/schema'
import { useMemo } from 'react'
import { Layer, Source, type CircleLayerSpecification } from 'react-map-gl/maplibre'
import { etatCarrefour, type EtatTempsReel, type Fiabilite } from '../tempsReel/etats'
import { useMaintenant } from '../tempsReel/useMaintenant'
import { FEU } from '../theme/couleurs'

const COULEUR: Record<EtatTempsReel, string> = {
  vert: FEU.vert,
  jaune: FEU.orange,
  clignotant: FEU.orange,
  rouge: FEU.rouge,
  eteint: '#3a3f4b',
  inconnu: '#9aa1ad',
}

const OPACITE_FIABILITE: Record<Fiabilite, number> = {
  synchronisee: 1,
  estimee: 0.85,
  indicative: 0.55,
  inconnue: 0.45,
}

const couche: CircleLayerSpecification = {
  id: 'feux-temps-reel',
  type: 'circle',
  source: 'feux-temps-reel',
  minzoom: 13,
  paint: {
    'circle-radius': ['interpolate', ['linear'], ['zoom'], 13, 2.5, 18, ['case', ['get', 'pieton'], 7, 9]],
    'circle-color': ['get', 'couleur'],
    'circle-opacity': ['get', 'opacite'],
    'circle-stroke-width': ['case', ['==', ['get', 'fiabilite'], 'synchronisee'], 1.5, 1],
    'circle-stroke-color': '#ffffff',
    'circle-stroke-opacity': ['get', 'opacite'],
  },
}

/** Halo des feux allumés (vert, jaune), pour les repérer de loin. */
const halo: CircleLayerSpecification = {
  id: 'feux-temps-reel-halo',
  type: 'circle',
  source: 'feux-temps-reel',
  minzoom: 13,
  filter: ['in', ['get', 'etat'], ['literal', ['vert', 'jaune', 'clignotant']]],
  paint: {
    'circle-radius': ['interpolate', ['linear'], ['zoom'], 13, 5, 18, 18],
    'circle-color': ['get', 'couleur'],
    'circle-opacity': ['*', 0.3, ['get', 'opacite']],
    'circle-blur': 0.8,
  },
}

interface Props {
  tempsReel: FeuxTempsReel
}

/** Feux des carrefours programmés, à la couleur qu'ils affichent à l'heure réelle. */
export function CoucheFeuxTempsReel({ tempsReel }: Props) {
  const maintenant = useMaintenant()

  // État de chaque feu résumé en une chaîne : la source n'est renvoyée à la carte que lorsqu'un
  // feu change de couleur, pas à chaque relecture.
  const cle = useMemo(() => {
    const parFeu: string[] = []
    for (const carrefour of tempsReel.carrefours) {
      const { etats, fiabilite } = etatCarrefour(carrefour, maintenant)
      for (const ligne of carrefour.lignes) parFeu.push(`${carrefour.id}|${ligne.code}|${etats.get(ligne.code)}|${fiabilite}`)
    }
    return parFeu.join(',')
  }, [tempsReel, maintenant])

  const donnees = useMemo(() => {
    const lignes = new Map(tempsReel.carrefours.flatMap((c) => c.lignes.map((l) => [`${c.id}|${l.code}`, l] as const)))
    return {
      type: 'FeatureCollection' as const,
      features: cle
        ? cle.split(',').flatMap((entree) => {
            const [carrefour_id, code, etat, fiabilite] = entree.split('|') as [string, string, EtatTempsReel, Fiabilite]
            const ligne = lignes.get(`${carrefour_id}|${code}`)
            return (ligne?.positions ?? []).map((coordinates) => ({
              type: 'Feature' as const,
              geometry: { type: 'Point' as const, coordinates },
              properties: {
                carrefour_id,
                ligne: code,
                pieton: ligne!.pieton,
                etat,
                fiabilite,
                couleur: COULEUR[etat],
                opacite: OPACITE_FIABILITE[fiabilite],
              },
            }))
          })
        : [],
    }
  }, [cle, tempsReel])

  return (
    <Source id="feux-temps-reel" type="geojson" data={donnees}>
      <Layer {...halo} />
      <Layer {...couche} />
    </Source>
  )
}
