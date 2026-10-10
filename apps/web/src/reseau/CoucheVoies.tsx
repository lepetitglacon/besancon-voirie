/**
 * Réseau de la vue voie par voie (docs/RESEAU.md §7), à la TM:PE, en couches MapLibre :
 * - chaque tronçon est dessiné voie par voie, chaque voie à sa largeur (les voies vélo sont moins
 *   larges) ; les voies vélo, bus et tram dans leur couleur, les autres dans celle de leur
 *   origine (OSM, corrigée, tracée à la main) ;
 * - chaque nœud montre ce qu'il porte : ligne d'arrêt à feux, passage piéton (zébras en travers
 *   de la rue), appartenance à un carrefour (cercle, avec l'outil Nœuds) ;
 * - un carrefour est une boîte noire : ses liaisons vont d'une branche à l'autre (calque du
 *   carrefour) ; en son cœur, on ne dessine que l'axe des tronçons, sans nœuds ni liaisons ;
 * - outil Sélection : glisser un nœud le déplace (les tronçons suivent) ;
 * - outil Liaison : du bout d'une voie qui arrive au début d'une voie qui repart (« lane
 *   connector »), à chaque nœud ; refaire le geste, ou cliquer une liaison, la retire.
 * Les clics (popup, coupe, nœud du carrefour) passent par la couche du réseau, qui interroge
 * aussi ces couches-ci.
 */
import { boutsAuNoeud, courbeConnexion, liaisonsRetenues, repereLocal, type Liaison, type LonLat, type TypeVoieReseau } from '@voirie/engine'
import type { ReseauGeoJson } from '@voirie/schema'
import type { ExpressionSpecification, MapLayerMouseEvent, MapMouseEvent } from 'maplibre-gl'
import { useEffect, useEffectEvent, useMemo, useState } from 'react'
import { Layer, Source, useMap } from 'react-map-gl/maplibre'
import { TOLERANCE_CLIC_PX } from '../configuration/calque/relais'
import { FEU } from '../theme/couleurs'
import { COULEURS_RESEAU } from './couleurs'
import { COUCHE_COEUR, couchesInteractivesVoies, useCoucheDessous, ZONES, type OutilVoies } from './couchesVoies'
import { metresEnPixels } from './largeurs'
import { ZOOM_VOIES, type SelectionReseau } from './modeReseau'
import { geometrieRues, type BoutVoie } from './voiesRues'

interface Props {
  reseau: ReseauGeoJson
  outil: OutilVoies | null
  selection: SelectionReseau | null
  /** Carrefour ouvert : ses nœuds sont cerclés d'orange. */
  carrefourOuvert: string | null
  onDeplacerNoeud: (id: string, position: LonLat) => void
  /** Ajoute la liaison au nœud, ou la retire si elle existe (les liaisons proposées deviennent saisies). */
  onBasculerLiaison: (noeud: string, liaison: Liaison) => void
}

/** Les voies sont dessinées aux 8/10 de leur largeur, comme dans le calque du carrefour : on voit les séparations. */
const PART_DESSINEE = 0.8
/** Débord des zébras de part et d'autre de la chaussée (m). */
const DEBORD_ZEBRAS_M = 0.5
/** Distance (px) à laquelle un début de voie attire l'élastique. */
const TOLERANCE_CIBLE_PX = 14
const GRIS = '#e5e7eb'
/** Bout d'une voie qui arrive : c'est lui qu'on tire (les voies qui repartent sont des cibles, creuses). */
const BLEU_ARRIVEE = '#2f6fd6'
const CONTOUR = '#1d2330'

const COULEUR_SOURCE = { osm: GRIS, modifie: COULEURS_RESEAU.modifie, manuel: COULEURS_RESEAU.manuel } as const
const COULEUR_TYPE: Partial<Record<TypeVoieReseau, string>> = { velo: COULEURS_RESEAU.velo, bus: COULEURS_RESEAU.bus, tram: COULEURS_RESEAU.tram }

/** Opacité qui apparaît avec les voies (le réseau par tronçons s'efface au même moment). */
const enApparaissant = (opacite: number | ExpressionSpecification): ExpressionSpecification => [
  'interpolate', ['linear'], ['zoom'], ZOOM_VOIES - 0.5, 0, ZOOM_VOIES, opacite,
]

type Collection<G> = { type: 'FeatureCollection'; features: Array<{ type: 'Feature'; geometry: G; properties: Record<string, unknown> }> }
type Ligne = { type: 'LineString'; coordinates: LonLat[] }
type Point = { type: 'Point'; coordinates: LonLat }
const collection = <G,>(features: Collection<G>['features']): Collection<G> => ({ type: 'FeatureCollection', features })

const cleLiaison = (noeud: string, l: Liaison) => `${noeud}|${l.de}:${l.voie_de}>${l.vers}:${l.voie_vers}`

/** Voie qui arrive, tirée vers une voie qui repart du même nœud. */
interface Glisse {
  noeud: string
  depart: BoutVoie
  pointeur: LonLat
  cible: BoutVoie | null
}

/** Nœud saisi à la souris : où il a été pris, où il est maintenant. */
interface Deplacement {
  id: string
  appui: [number, number]
  position: LonLat
  bouge: boolean
}

export function CoucheVoies({ reseau, outil, selection, carrefourOuvert, onDeplacerNoeud, onBasculerLiaison }: Props) {
  const { current: carte } = useMap()
  const dessous = useCoucheDessous()
  const [survol, setSurvol] = useState<{ troncon: string | null; noeud: string | null; liaison: string | null }>({
    troncon: null,
    noeud: null,
    liaison: null,
  })
  const [glisse, setGlisse] = useState<Glisse | null>(null)
  const [deplacement, setDeplacement] = useState<Deplacement | null>(null)

  const troncons = reseau.troncons.features
  const noeuds = reseau.noeuds.features
  const geometrie = useMemo(() => geometrieRues(troncons, noeuds), [troncons, noeuds])
  const autour = useMemo(() => {
    const parNoeud = new Map<string, typeof troncons>()
    for (const t of troncons) {
      for (const n of [t.properties.noeud_de, t.properties.noeud_vers]) parNoeud.set(n, [...(parNoeud.get(n) ?? []), t])
    }
    return parNoeud
  }, [troncons])

  // Un carrefour est une boîte noire : ses liaisons vont d'une branche à l'autre (calque du
  // carrefour). Au cœur, entre ses lignes d'arrêt, on ne dessine ni voies, ni nœuds, ni liaisons.
  const { coeur, interieurs } = useMemo(() => {
    const carrefourDe = new Map(noeuds.map((n) => [n.id, n.properties.carrefour_id]))
    /** Tronçon au cœur d'un carrefour : ses deux bouts en sont, et il ne porte aucune de ses branches. */
    const auCoeur = new Set(
      troncons
        .filter((t) => {
          const { noeud_de, noeud_vers, branche_de, branche_vers } = t.properties
          const carrefour = carrefourDe.get(noeud_de)
          return carrefour != null && carrefour === carrefourDe.get(noeud_vers) && !branche_de && !branche_vers
        })
        .map((t) => t.id),
    )
    /** Nœud d'un carrefour dont tous les tronçons sont au cœur. */
    const dedans = new Set(
      noeuds.filter((n) => n.properties.carrefour_id && (autour.get(n.id) ?? []).every((t) => auCoeur.has(t.id))).map((n) => n.id),
    )
    return { coeur: auCoeur, interieurs: dedans }
  }, [troncons, noeuds, autour])
  // L'outil Nœuds montre tous les nœuds : on y ajoute ou retire ceux des carrefours.
  const tousLesNoeuds = outil === 'noeuds'

  // ── Données des couches : ne changent qu'avec le réseau ──

  const voies = useMemo(() => {
    const parId = new Map(troncons.map((t) => [t.id, t.properties]))
    return collection<Ligne>(
      geometrie.voies.filter((v) => !coeur.has(v.troncon)).map((v) => {
        const t = parId.get(v.troncon)!
        const origine = t.source === 'manuel' ? 'manuel' : t.modifie ? 'modifie' : 'osm'
        return {
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: v.points },
          properties: {
            troncon: v.troncon,
            // Sens et rang : l'outil Voie retire la voie visée, l'outil Emprise la dessine.
            sens: v.cle.includes(':a') ? 'avant' : 'arriere',
            rang: v.rang,
            couleur: COULEUR_TYPE[v.type] ?? COULEUR_SOURCE[origine],
            largeur: v.largeur * PART_DESSINEE,
          },
        }
      }),
    )
  }, [geometrie, troncons, coeur])

  // Emprises réelles des voies, posées sur la photo à côté de leur axe (outil Emprise).
  const emprises = useMemo(
    () =>
      collection<{ type: 'Polygon'; coordinates: LonLat[][] }>(
        troncons.flatMap((t) =>
          Object.entries(t.properties.emprises ?? {}).map(([cle, polygone]) => ({
            type: 'Feature' as const,
            geometry: { type: 'Polygon' as const, coordinates: [[...polygone, polygone[0]!]] },
            properties: { troncon: t.id, cle },
          })),
        ),
      ),
    [troncons],
  )

  const axesCoeur = useMemo(
    () =>
      collection<Ligne>(
        troncons
          .filter((t) => coeur.has(t.id))
          .map((t) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: t.geometry.coordinates }, properties: { troncon: t.id } })),
      ),
    [troncons, coeur],
  )

  const pastilles = useMemo(
    () =>
      collection<Point>(
        noeuds
          .filter((n) => tousLesNoeuds || !interieurs.has(n.id))
          .map((n) => ({
            type: 'Feature',
            geometry: n.geometry,
            properties: { id: n.id, feux: n.properties.feux, cul_de_sac: n.properties.degre === 1, carrefour_id: n.properties.carrefour_id ?? '' },
          })),
      ),
    [noeuds, interieurs, tousLesNoeuds],
  )

  // Zébras en travers de la rue, sur la plus large de celles qui arrivent au nœud.
  const zebras = useMemo(
    () =>
      collection<Ligne>(
        noeuds.flatMap((n) => {
          const t = autour.get(n.id)?.[0]
          if (!n.properties.pieton || !t || interieurs.has(n.id)) return []
          const repere = repereLocal(n.geometry.coordinates)
          const points = t.properties.noeud_de === n.id ? t.geometry.coordinates : [...t.geometry.coordinates].reverse()
          const [x, y] = repere.versXY(points[1] ?? points[0]!)
          const l = Math.hypot(x, y) || 1
          const demi = (geometrie.largeurs.get(n.id) ?? 0) / 2 + DEBORD_ZEBRAS_M
          const travers: [number, number] = [(-y / l) * demi, (x / l) * demi]
          return [
            {
              type: 'Feature' as const,
              geometry: { type: 'LineString' as const, coordinates: [repere.versLonLat(travers), repere.versLonLat([-travers[0], -travers[1]])] },
              properties: {},
            },
          ]
        }),
      ),
    [noeuds, autour, geometrie, interieurs],
  )

  // Passages piétons tracés librement : zébras sur leur tracé, à la largeur d'un passage.
  const passagesLibres = useMemo(
    () =>
      collection<Ligne>(
        (reseau.passages?.features ?? []).map((p) => ({
          type: 'Feature' as const,
          geometry: p.geometry,
          properties: { id: p.id, type: p.properties.type, choisi: selection?.type === 'passage' && selection.id === p.id },
        })),
      ),
    [reseau.passages, selection],
  )

  const connecter = outil === 'connecter'
  // Liaisons de chaque nœud hors des carrefours, saisies ou proposées (outil Liaison seulement :
  // c'est le calcul le plus long). Celles d'un carrefour se relient dans son calque.
  const liaisons = useMemo(() => {
    if (!connecter) return collection<Ligne>([])
    return collection<Ligne>(
      noeuds.flatMap((n) => {
        const touchent = autour.get(n.id) ?? []
        if (touchent.length < 2 || n.properties.carrefour_id) return []
        const bouts = boutsAuNoeud(
          n.id,
          touchent.map((t) => ({ ...t.properties, points: t.geometry.coordinates })),
        )
        const { liaisons: retenues, auto } = liaisonsRetenues(bouts, n.properties.liaisons)
        return retenues.flatMap((l) => {
          const depuis = geometrie.arrivees.get(n.id)?.find((b) => b.troncon === l.de && b.rang === l.voie_de)
          const vers = geometrie.departs.get(n.id)?.find((b) => b.troncon === l.vers && b.rang === l.voie_vers)
          if (!depuis || !vers) return []
          return [
            {
              type: 'Feature' as const,
              geometry: { type: 'LineString' as const, coordinates: courbeConnexion([depuis.bout, depuis.suivant], [vers.bout, vers.suivant], 12) },
              properties: { cle: cleLiaison(n.id, l), noeud: n.id, auto, ...l },
            },
          ]
        })
      }),
    )
  }, [connecter, noeuds, autour, geometrie])

  // Bouts des voies qui arrivent (à tirer) et débuts de celles qui repartent (cibles), aux nœuds où l'on peut relier.
  const poignees = useMemo(() => {
    if (!connecter) return null
    const relies = noeuds.filter((n) => (autour.get(n.id)?.length ?? 0) >= 2 && !n.properties.carrefour_id)
    const point = (noeud: string, b: BoutVoie, sens: 'arrivee' | 'depart') => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: b.bout },
      properties: { cle: `${sens}|${noeud}|${b.troncon}:${b.rang}`, noeud, troncon: b.troncon, rang: b.rang },
    })
    return {
      arrivees: collection<Point>(relies.flatMap((n) => (geometrie.arrivees.get(n.id) ?? []).map((b) => point(n.id, b, 'arrivee')))),
      departs: collection<Point>(relies.flatMap((n) => (geometrie.departs.get(n.id) ?? []).map((b) => point(n.id, b, 'depart')))),
    }
  }, [connecter, noeuds, autour, geometrie])

  // ── Gestes : glisser un nœud (Sélection), tirer une liaison (Liaison), survols ──

  const surAppuiNoeud = useEffectEvent((e: MapLayerMouseEvent) => {
    if (outil !== 'selection' || e.originalEvent.button !== 0) return
    const id = e.features?.[0]?.properties.id as string | undefined
    if (!id) return
    e.preventDefault() // la carte ne se déplace pas
    setDeplacement({ id, appui: [e.point.x, e.point.y], position: [e.lngLat.lng, e.lngLat.lat], bouge: false })
  })
  const surAppuiArrivee = useEffectEvent((e: MapLayerMouseEvent) => {
    if (outil !== 'connecter' || e.originalEvent.button !== 0) return
    const p = e.features?.[0]?.properties
    const depart = p && geometrie.arrivees.get(p.noeud as string)?.find((b) => b.troncon === p.troncon && b.rang === p.rang)
    if (!p || !depart) return
    e.preventDefault()
    setGlisse({ noeud: p.noeud as string, depart, pointeur: depart.bout, cible: null })
  })
  const surMouvement = useEffectEvent((e: MapMouseEvent) => {
    const pointeur: LonLat = [e.lngLat.lng, e.lngLat.lat]
    if (deplacement) {
      const bouge = deplacement.bouge || Math.hypot(e.point.x - deplacement.appui[0], e.point.y - deplacement.appui[1]) > TOLERANCE_CLIC_PX
      setDeplacement({ ...deplacement, position: pointeur, bouge })
    }
    if (glisse && carte) {
      const cible =
        geometrie.departs.get(glisse.noeud)?.find((b) => {
          const p = carte.project(b.bout)
          return Math.hypot(p.x - e.point.x, p.y - e.point.y) <= TOLERANCE_CIBLE_PX
        }) ?? null
      setGlisse({ ...glisse, pointeur, cible })
    }
  })
  const surRelache = useEffectEvent(() => {
    if (deplacement?.bouge) onDeplacerNoeud(deplacement.id, deplacement.position)
    // Sans bouger, c'est un clic : la couche du réseau ouvre la popup du nœud.
    setDeplacement(null)
    if (glisse?.cible) {
      const { depart, cible } = glisse
      onBasculerLiaison(glisse.noeud, { de: depart.troncon, voie_de: depart.rang, vers: cible.troncon, voie_vers: cible.rang })
    }
    setGlisse(null)
  })
  const surClicLiaison = useEffectEvent((e: MapLayerMouseEvent) => {
    const p = e.features?.[0]?.properties
    if (outil !== 'connecter' || !p || glisse) return
    onBasculerLiaison(p.noeud as string, { de: p.de as string, voie_de: p.voie_de as number, vers: p.vers as string, voie_vers: p.voie_vers as number })
  })
  const surSurvol = useEffectEvent((e: MapMouseEvent) => {
    const map = carte?.getMap()
    if (!map) return
    const couches = couchesInteractivesVoies(outil).filter((id) => map.getLayer(id))
    const objet = couches.length > 0 ? map.queryRenderedFeatures(e.point, { layers: couches })[0] : undefined
    const id = objet?.layer.id
    const suivant = {
      troncon: id === 'reseau-voies' ? (objet!.properties.troncon as string) : null,
      noeud: id === ZONES.noeuds ? (objet!.properties.id as string) : null,
      liaison: id === ZONES.liaisons ? (objet!.properties.cle as string) : null,
    }
    setSurvol((actuel) =>
      actuel.troncon === suivant.troncon && actuel.noeud === suivant.noeud && actuel.liaison === suivant.liaison ? actuel : suivant,
    )
  })

  useEffect(() => {
    const map = carte?.getMap()
    if (!map) return
    const mouvement = (e: MapMouseEvent) => {
      surMouvement(e)
      surSurvol(e)
    }
    // Relâché hors de la carte : le geste se termine quand même.
    const relache = () => surRelache()
    map.on('mousedown', ZONES.noeuds, surAppuiNoeud)
    map.on('mousedown', ZONES.arrivees, surAppuiArrivee)
    map.on('click', ZONES.liaisons, surClicLiaison)
    map.on('mousemove', mouvement)
    window.addEventListener('mouseup', relache)
    return () => {
      map.off('mousedown', ZONES.noeuds, surAppuiNoeud)
      map.off('mousedown', ZONES.arrivees, surAppuiArrivee)
      map.off('click', ZONES.liaisons, surClicLiaison)
      map.off('mousemove', mouvement)
      window.removeEventListener('mouseup', relache)
    }
  }, [carte])

  // ── Ce qui suit le pointeur : nœud déplacé, élastique ──

  const enCours = useMemo(() => {
    if (deplacement?.bouge) {
      // Le nœud à sa nouvelle place, et ses tronçons qui le suivent.
      const lignes = (autour.get(deplacement.id) ?? []).map((t) => {
        const points = [...t.geometry.coordinates]
        if (t.properties.noeud_de === deplacement.id) points[0] = deplacement.position
        if (t.properties.noeud_vers === deplacement.id) points[points.length - 1] = deplacement.position
        return { type: 'Feature' as const, geometry: { type: 'LineString' as const, coordinates: points }, properties: { valide: false } }
      })
      return collection<Ligne | Point>([
        ...lignes,
        { type: 'Feature', geometry: { type: 'Point', coordinates: deplacement.position }, properties: {} },
      ])
    }
    if (glisse) {
      const arrivee = glisse.cible?.bout ?? glisse.pointeur
      return collection<Ligne | Point>([
        { type: 'Feature', geometry: { type: 'LineString', coordinates: [glisse.depart.bout, arrivee] }, properties: { valide: glisse.cible !== null } },
      ])
    }
    return collection<Ligne | Point>([])
  }, [deplacement, glisse, autour])

  // ── Styles ──

  const troncon = selection?.type === 'troncon' ? selection.id : ''
  const noeud = selection?.type === 'noeud' ? selection.id : ''
  const selectionner = outil === 'selection'
  const voiesEnAvant: ExpressionSpecification = ['in', ['get', 'troncon'], ['literal', [troncon, survol.troncon ?? '']]]
  const noeudEnAvant: ExpressionSpecification = ['in', ['get', 'id'], ['literal', [noeud, selectionner ? (survol.noeud ?? '') : '']]]
  const cleDepart = glisse ? `arrivee|${glisse.noeud}|${glisse.depart.troncon}:${glisse.depart.rang}` : ''
  const cleCible = glisse?.cible ? `depart|${glisse.noeud}|${glisse.cible.troncon}:${glisse.cible.rang}` : ''
  const couleurLiaison: ExpressionSpecification = ['case', ['==', ['get', 'cle'], survol.liaison ?? ''], FEU.rouge, '#ffffff']
  const largeurLiaison: ExpressionSpecification = ['case', ['==', ['get', 'cle'], survol.liaison ?? ''], 4, 2.5]
  const minzoom = ZOOM_VOIES - 0.5

  return (
    <>
      <Source id="reseau-emprises" type="geojson" data={emprises}>
        <Layer
          id="reseau-emprises"
          type="fill"
          minzoom={minzoom}
          beforeId={dessous}
          paint={{ 'fill-color': COULEURS_RESEAU.emprise, 'fill-opacity': enApparaissant(0.25) }}
        />
        <Layer
          id="reseau-emprises-bord"
          type="line"
          minzoom={minzoom}
          beforeId={dessous}
          paint={{ 'line-color': COULEURS_RESEAU.emprise, 'line-width': 1.5, 'line-dasharray': [2, 1], 'line-opacity': enApparaissant(0.9) }}
        />
      </Source>
      <Source id="reseau-voies" type="geojson" data={voies}>
        <Layer
          id="reseau-voies"
          type="line"
          minzoom={minzoom}
          beforeId={dessous}
          layout={{ 'line-cap': 'butt', 'line-join': 'round' }}
          paint={{
            'line-color': ['get', 'couleur'],
            'line-width': metresEnPixels(['get', 'largeur'], 2),
            'line-opacity': enApparaissant(['case', voiesEnAvant, 0.85, 0.4]),
          }}
        />
      </Source>
      <Source id={COUCHE_COEUR} type="geojson" data={axesCoeur}>
        <Layer
          id={COUCHE_COEUR}
          type="line"
          minzoom={minzoom}
          beforeId={dessous}
          paint={{ 'line-color': '#ffffff', 'line-width': 1.5, 'line-dasharray': [2, 2], 'line-opacity': enApparaissant(0.5) }}
        />
      </Source>
      <Source id="reseau-voies-zebras" type="geojson" data={zebras}>
        <Layer
          id="reseau-voies-zebras"
          type="line"
          minzoom={minzoom}
          beforeId={dessous}
          paint={{
            'line-color': COULEURS_RESEAU.pieton,
            'line-width': metresEnPixels(2.5, 4),
            // En largeurs de ligne : des bandes de 0,5 m.
            'line-dasharray': [0.2, 0.2],
            'line-opacity': enApparaissant(0.85),
          }}
        />
      </Source>
      <Source id="reseau-passages" type="geojson" data={passagesLibres}>
        <Layer
          id="reseau-passages-choisi"
          type="line"
          minzoom={minzoom}
          beforeId={dessous}
          filter={['get', 'choisi']}
          paint={{ 'line-color': COULEURS_RESEAU.selection, 'line-width': metresEnPixels(3.5, 7), 'line-opacity': 0.6 }}
        />
        <Layer
          id="reseau-passages"
          type="line"
          minzoom={minzoom}
          beforeId={dessous}
          paint={{
            // À feux : bandes cerclées du rouge des feux ; non marqué : en tirets plus espacés.
            'line-color': ['case', ['==', ['get', 'type'], 'feux'], COULEURS_RESEAU.feux, COULEURS_RESEAU.pieton],
            'line-width': metresEnPixels(2.5, 4),
            'line-dasharray': [0.2, 0.2],
            'line-opacity': enApparaissant(['case', ['==', ['get', 'type'], 'non_marquee'], 0.45, 0.9]),
          }}
        />
        <Layer id={ZONES.passages} type="line" minzoom={minzoom} beforeId={dessous} paint={{ 'line-width': 14, 'line-opacity': 0 }} />
      </Source>
      <Source id="reseau-voies-noeuds" type="geojson" data={pastilles}>
        <Layer
          id="reseau-voies-anneaux"
          type="circle"
          minzoom={minzoom}
          beforeId={dessous}
          // Appartenance à un carrefour : montrée avec l'outil Nœuds seulement.
          filter={['all', tousLesNoeuds, ['!=', ['get', 'carrefour_id'], '']]}
          paint={{
            'circle-radius': 9,
            'circle-opacity': 0,
            'circle-stroke-width': 2.5,
            'circle-stroke-color': ['case', ['==', ['get', 'carrefour_id'], carrefourOuvert ?? ''], COULEURS_RESEAU.carrefourOuvert, COULEURS_RESEAU.carrefour],
            'circle-stroke-opacity': enApparaissant(1),
          }}
        />
        <Layer
          id="reseau-voies-noeuds"
          type="circle"
          minzoom={minzoom}
          beforeId={dessous}
          paint={{
            'circle-radius': ['case', ['get', 'feux'], 5, selectionner ? 4 : ['case', ['==', ['get', 'id'], noeud], 4, 2.5]],
            'circle-color': ['case', ['get', 'feux'], COULEURS_RESEAU.feux, ['get', 'cul_de_sac'], COULEURS_RESEAU.culDeSac, '#ffffff'],
            'circle-stroke-color': ['case', noeudEnAvant, '#ffffff', CONTOUR],
            'circle-stroke-width': ['case', noeudEnAvant, 2.5, 1],
            'circle-opacity': enApparaissant(1),
            'circle-stroke-opacity': enApparaissant(1),
          }}
        />
        <Layer id={ZONES.noeuds} type="circle" minzoom={ZOOM_VOIES} beforeId={dessous} paint={{ 'circle-radius': 10, 'circle-opacity': 0 }} />
      </Source>
      {connecter && (
        <>
          <Source id="reseau-liaisons" type="geojson" data={liaisons}>
            {/* Proposées par défaut en tirets, saisies en trait plein. */}
            <Layer
              id="reseau-liaisons-auto"
              type="line"
              beforeId={dessous}
              filter={['get', 'auto']}
              layout={{ 'line-cap': 'round' }}
              paint={{ 'line-color': couleurLiaison, 'line-width': largeurLiaison, 'line-dasharray': [1.6, 1.2], 'line-opacity': 0.6 }}
            />
            <Layer
              id="reseau-liaisons"
              type="line"
              beforeId={dessous}
              filter={['!', ['get', 'auto']]}
              layout={{ 'line-cap': 'round' }}
              paint={{ 'line-color': couleurLiaison, 'line-width': largeurLiaison, 'line-opacity': 0.9 }}
            />
            <Layer id={ZONES.liaisons} type="line" beforeId={dessous} paint={{ 'line-width': 10, 'line-opacity': 0 }} />
          </Source>
          {poignees && (
            <>
              <Source id="reseau-poignees-departs" type="geojson" data={poignees.departs}>
                <Layer
                  id="reseau-poignees-departs"
                  type="circle"
                  beforeId={dessous}
                  paint={{
                    'circle-radius': 4,
                    'circle-color': ['case', ['==', ['get', 'cle'], cleCible], FEU.vert, '#ffffff'],
                    'circle-stroke-color': ['case', ['==', ['get', 'cle'], cleCible], '#ffffff', CONTOUR],
                    'circle-stroke-width': ['case', ['==', ['get', 'cle'], cleCible], 3, 2],
                  }}
                />
              </Source>
              <Source id="reseau-poignees-arrivees" type="geojson" data={poignees.arrivees}>
                <Layer
                  id="reseau-poignees-arrivees"
                  type="circle"
                  beforeId={dessous}
                  paint={{
                    'circle-radius': 5,
                    'circle-color': BLEU_ARRIVEE,
                    'circle-stroke-color': ['case', ['==', ['get', 'cle'], cleDepart], BLEU_ARRIVEE, '#ffffff'],
                    'circle-stroke-width': ['case', ['==', ['get', 'cle'], cleDepart], 3, 2],
                    // Pendant le geste, les autres voies qui arrivent s'effacent.
                    'circle-opacity': glisse ? ['case', ['==', ['get', 'cle'], cleDepart], 1, 0.35] : 1,
                    'circle-stroke-opacity': glisse ? ['case', ['==', ['get', 'cle'], cleDepart], 1, 0.35] : 1,
                  }}
                />
                <Layer id={ZONES.arrivees} type="circle" beforeId={dessous} paint={{ 'circle-radius': 10, 'circle-opacity': 0 }} />
              </Source>
            </>
          )}
        </>
      )}
      <Source id="reseau-voies-geste" type="geojson" data={enCours}>
        {/* Élastique en tirets tant qu'il ne tient pas une voie, plein et vert quand il en tient une. */}
        <Layer
          id="reseau-voies-geste-lignes"
          type="line"
          filter={['all', ['==', ['geometry-type'], 'LineString'], ['!', ['get', 'valide']]]}
          paint={{ 'line-color': '#ffffff', 'line-width': 2.5, 'line-dasharray': [2.4, 1.6] }}
        />
        <Layer
          id="reseau-voies-geste-valide"
          type="line"
          filter={['all', ['==', ['geometry-type'], 'LineString'], ['get', 'valide']]}
          paint={{ 'line-color': FEU.vert, 'line-width': 3 }}
        />
        <Layer
          id="reseau-voies-geste-point"
          type="circle"
          filter={['==', ['geometry-type'], 'Point']}
          paint={{ 'circle-radius': 6, 'circle-color': '#ffffff', 'circle-stroke-color': BLEU_ARRIVEE, 'circle-stroke-width': 2.5 }}
        />
      </Source>
    </>
  )
}
