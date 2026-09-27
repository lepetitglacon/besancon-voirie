import type { FeuxTempsReel } from '@voirie/schema'
import { useMemo } from 'react'
import { Layer, Source, type CircleLayerSpecification, type SymbolLayerSpecification } from 'react-map-gl/maplibre'
import { etatCarrefour, type EtatTempsReel, type Fiabilite } from '../tempsReel/etats'
import { approchesA, type ContexteTram } from '../tempsReel/priorite'
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

/** Anneau à la couleur de la ligne de tram autour d'un carrefour en priorité tram. */
const anneauPriorite: CircleLayerSpecification = {
  id: 'priorite-tram',
  type: 'circle',
  source: 'priorite-tram',
  minzoom: 12,
  paint: {
    'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 7, 18, 34],
    'circle-color': 'transparent',
    'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 12, 2, 18, 4],
    'circle-stroke-color': ['get', 'couleur'],
  },
}

const etiquettePriorite: SymbolLayerSpecification = {
  id: 'priorite-tram-etiquette',
  type: 'symbol',
  source: 'priorite-tram',
  minzoom: 14,
  layout: {
    'text-field': ['get', 'texte'],
    'text-font': ['Noto Sans Regular'],
    'text-size': 12,
    'text-anchor': 'bottom',
    'text-offset': [0, -2.6],
    'text-allow-overlap': true,
  },
  paint: { 'text-color': '#ffffff', 'text-halo-color': ['get', 'couleur'], 'text-halo-width': 2.5 },
}

interface Props {
  tempsReel: FeuxTempsReel
  /** Null tant que le réseau ou le flux tram ne sont pas chargés : pas de priorité tram. */
  tram: ContexteTram | null
}

/** Feux des carrefours programmés, à la couleur qu'ils affichent à l'heure réelle. */
export function CoucheFeuxTempsReel({ tempsReel, tram }: Props) {
  const maintenant = useMaintenant()
  const approches = useMemo(() => approchesA(tram, maintenant), [tram, maintenant])

  // État de chaque feu résumé en une chaîne : la source n'est renvoyée à la carte que lorsqu'un
  // feu change de couleur, pas à chaque relecture.
  // Même chose pour les carrefours en priorité tram, avec la ligne et le temps avant le passage.
  const { cle, clePriorites } = useMemo(() => {
    const parFeu: string[] = []
    const parPriorite: string[] = []
    for (const carrefour of tempsReel.carrefours) {
      const { etats, fiabilite, priorite } = etatCarrefour(carrefour, maintenant, approches.get(carrefour.id))
      for (const ligne of carrefour.lignes) parFeu.push(`${carrefour.id}|${ligne.code}|${etats.get(ligne.code)}|${fiabilite}`)
      if (priorite) parPriorite.push(`${carrefour.id}|${priorite.couleur}|${priorite.ligne}${priorite.dans_s > 0 ? ` · ${priorite.dans_s} s` : ''}`)
    }
    return { cle: parFeu.join(','), clePriorites: parPriorite.join(',') }
  }, [tempsReel, maintenant, approches])
  const priorites = useMemo(() => {
    const position = new Map(tempsReel.carrefours.map((c) => [c.id, c.position]))
    return {
      type: 'FeatureCollection' as const,
      features: clePriorites
        ? clePriorites.split(',').map((entree) => {
            const [id, couleur, texte] = entree.split('|') as [string, string, string]
            return {
              type: 'Feature' as const,
              geometry: { type: 'Point' as const, coordinates: position.get(id)! },
              properties: { carrefour_id: id, couleur, texte },
            }
          })
        : [],
    }
  }, [clePriorites, tempsReel])

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
    <>
      <Source id="priorite-tram" type="geojson" data={priorites}>
        <Layer {...anneauPriorite} />
        <Layer {...etiquettePriorite} />
      </Source>
      <Source id="feux-temps-reel" type="geojson" data={donnees}>
        <Layer {...halo} />
        <Layer {...couche} />
      </Source>
    </>
  )
}
