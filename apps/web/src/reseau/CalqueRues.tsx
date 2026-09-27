/**
 * Réseau de la vue voie par voie, dans un calque SVG (docs/RESEAU.md §7), à la TM:PE :
 * - chaque tronçon est dessiné voie par voie, à sa largeur ; les voies vélo, bus et tram dans
 *   leur couleur, les autres dans celle de leur origine (OSM, corrigée, tracée à la main) ;
 * - chaque nœud montre ce qu'il porte : ligne d'arrêt à feux, passage piéton (zébras en travers
 *   de la rue), appartenance à un carrefour (cercle) ;
 * - outil Sélection : glisser un nœud le déplace (les tronçons suivent), un clic sur un nœud ou
 *   une voie ouvre sa popup ; outil Couper : un clic sur une voie coupe son tronçon à cet endroit ;
 * - outil Liaison : du bout d'une voie qui arrive au début d'une voie qui repart (« lane
 *   connector »), à chaque nœud ; refaire le geste, ou cliquer une liaison, la retire.
 * Le reste des clics traverse le calque : la couche du réseau trouve le tronçon ou le nœud visé.
 */
import { boutsAuNoeud, liaisonsRetenues, typesVoies, type Liaison, type LonLat, type XY } from '@voirie/engine'
import type { ReseauGeoJson, TypeVoie } from '@voirie/schema'
import { useMemo, useRef, useState, type MouseEvent, type PointerEvent } from 'react'
import { cheminConnexion } from '../configuration/calque/chemins'
import { Elastique, Poignee } from '../configuration/calque/elements'
import { useProjection } from '../configuration/calque/projection'
import { TOLERANCE_CLIC_PX, useRelaisCarte } from '../configuration/calque/relais'
import type { OutilReseau } from './CoucheReseau'
import { COULEURS_RESEAU } from './couleurs'
import type { SelectionReseau } from './modeReseau'
import { geometrieRues, type BoutVoie } from './voiesRues'

/** Outil actif : `autre` pour les outils propres au carrefour ouvert (poser ses feux). */
export type OutilVoies = OutilReseau | 'autre'

interface Props {
  reseau: ReseauGeoJson
  outil: OutilVoies | null
  selection: SelectionReseau | null
  /** Carrefour ouvert : ses nœuds sont cerclés. */
  carrefourOuvert: string | null
  onClicNoeud: (id: string, position: LonLat) => void
  /** Clic sur une voie (outils Sélection et Couper) : son tronçon, au point cliqué. */
  onClicTroncon: (id: string, position: LonLat) => void
  onDeplacerNoeud: (id: string, position: LonLat) => void
  /** Ajoute la liaison au nœud, ou la retire si elle existe (les liaisons proposées deviennent saisies). */
  onBasculerLiaison: (noeud: string, liaison: Liaison) => void
}

/** Largeur réelle d'une voie (m), dessinée aux 8/10 comme dans le calque du carrefour. */
const LARGEUR_VOIE_M = 3.25 * 0.8
/** Distance (px) à laquelle un bout de voie attire l'élastique. */
const TOLERANCE_CIBLE_PX = 14
const GRIS = '#e5e7eb'
/** Bout d'une voie qui arrive : c'est lui qu'on tire (les voies qui repartent sont des cibles, creuses). */
const BLEU_ARRIVEE = '#2f6fd6'

const COULEUR_SOURCE = { osm: GRIS, modifie: COULEURS_RESEAU.modifie, manuel: COULEURS_RESEAU.manuel } as const
const COULEUR_TYPE: Partial<Record<TypeVoie, string>> = { velo: COULEURS_RESEAU.velo, bus: COULEURS_RESEAU.bus, tram: COULEURS_RESEAU.tram }

interface Depart {
  noeud: string
  troncon: string
  rang: number
  position: LonLat
}

interface Glisse {
  depart: Depart
  pointeur: LonLat
  cible: { troncon: string; rang: number } | null
  position: LonLat | null
}

/** Nœud saisi à la souris : où il a été pris, où il est maintenant (en pixels et sur la carte). */
interface Deplacement {
  id: string
  appui: XY
  position: LonLat
  bouge: boolean
}

export function CalqueRues({ reseau, outil, selection, carrefourOuvert, onClicNoeud, onClicTroncon, onDeplacerNoeud, onBasculerLiaison }: Props) {
  const projection = useProjection()
  const refSvg = useRef<SVGSVGElement>(null)
  useRelaisCarte(refSvg)
  const [glisse, setGlisse] = useState<Glisse | null>(null)
  const [deplacement, setDeplacement] = useState<Deplacement | null>(null)

  const troncons = reseau.troncons.features
  const geometrie = useMemo(() => geometrieRues(troncons, reseau.noeuds.features), [troncons, reseau.noeuds.features])
  const parTroncon = useMemo(() => new Map(troncons.map((t) => [t.id, t])), [troncons])
  const autour = useMemo(() => {
    const carte = new Map<string, typeof troncons>()
    for (const t of troncons) {
      for (const n of [t.properties.noeud_de, t.properties.noeud_vers]) carte.set(n, [...(carte.get(n) ?? []), t])
    }
    return carte
  }, [troncons])

  // Liaisons de chaque nœud, saisies ou proposées.
  const noeuds = useMemo(
    () =>
      reseau.noeuds.features
        .filter((n) => (autour.get(n.id)?.length ?? 0) >= 2)
        .map((n) => {
          const bouts = boutsAuNoeud(
            n.id,
            (autour.get(n.id) ?? []).map((t) => ({ ...t.properties, points: t.geometry.coordinates })),
          )
          return { id: n.id, ...liaisonsRetenues(bouts, n.properties.liaisons) }
        }),
    [autour, reseau.noeuds.features],
  )

  if (!projection) return null
  const { px, lonLat, metresParPixel } = projection
  const largeur = Math.max(2, LARGEUR_VOIE_M / metresParPixel)
  const chemin = (points: readonly LonLat[]) => points.map((p, i) => `${i ? 'L' : 'M'}${px(p).join(',')}`).join(' ')
  const paire = (b: BoutVoie): [XY, XY] => [px(b.bout), px(b.suivant)]
  const trouver = (liste: BoutVoie[] | undefined, troncon: string, rang: number) => liste?.find((b) => b.troncon === troncon && b.rang === rang)

  const connecter = outil === 'connecter'
  const selectionner = outil === 'selection'
  const voiesCliquables = selectionner || outil === 'couper'
  const pointeurSur = (e: PointerEvent<SVGElement> | MouseEvent<SVGElement>): { xy: XY; lonLat: LonLat } => {
    const cadre = (e.currentTarget.ownerSVGElement ?? (e.currentTarget as SVGElement)).getBoundingClientRect()
    const xy: XY = [e.clientX - cadre.left, e.clientY - cadre.top]
    return { xy, lonLat: lonLat(xy[0], xy[1]) }
  }
  const pres = (a: LonLat, b: LonLat) => {
    const [ax, ay] = px(a)
    const [bx, by] = px(b)
    return Math.hypot(ax - bx, ay - by) <= TOLERANCE_CIBLE_PX
  }

  // ── Glisser une liaison ──
  const cibleSous = (depart: Depart, pointeur: LonLat) => {
    const bout = geometrie.departs.get(depart.noeud)?.find((b) => pres(b.bout, pointeur))
    return bout ? { cible: { troncon: bout.troncon, rang: bout.rang }, position: bout.bout } : null
  }
  const lacher = () => {
    if (glisse?.cible) {
      const { depart, cible } = glisse
      onBasculerLiaison(depart.noeud, { de: depart.troncon, voie_de: depart.rang, vers: cible.troncon, voie_vers: cible.rang })
    }
    setGlisse(null)
  }
  const gestes = (depart: Depart) => ({
    onPointerDown: (e: PointerEvent<SVGCircleElement>) => {
      e.stopPropagation()
      e.currentTarget.setPointerCapture(e.pointerId)
      setGlisse({ depart, pointeur: depart.position, cible: null, position: null })
    },
    onPointerMove: (e: PointerEvent<SVGCircleElement>) => {
      if (!glisse) return
      const pointeur = pointeurSur(e).lonLat
      const trouve = cibleSous(glisse.depart, pointeur)
      setGlisse({ ...glisse, pointeur, cible: trouve?.cible ?? null, position: trouve?.position ?? null })
    },
    onPointerUp: lacher,
    onPointerCancel: () => setGlisse(null),
  })

  // ── Déplacer un nœud (outil Sélection) ; sans bouger, c'est un clic ──
  const gestesNoeud = (id: string) => ({
    onPointerDown: (e: PointerEvent<SVGGElement>) => {
      if (e.button !== 0) return
      e.stopPropagation()
      e.currentTarget.setPointerCapture(e.pointerId)
      const { xy, lonLat: position } = pointeurSur(e)
      setDeplacement({ id, appui: xy, position, bouge: false })
    },
    onPointerMove: (e: PointerEvent<SVGGElement>) => {
      if (deplacement?.id !== id) return
      const { xy, lonLat: position } = pointeurSur(e)
      const bouge = deplacement.bouge || Math.hypot(xy[0] - deplacement.appui[0], xy[1] - deplacement.appui[1]) > TOLERANCE_CLIC_PX
      setDeplacement({ ...deplacement, position, bouge })
    },
    onPointerUp: () => {
      if (deplacement?.id !== id) return
      if (deplacement.bouge) onDeplacerNoeud(id, deplacement.position)
      else onClicNoeud(id, deplacement.position)
      setDeplacement(null)
    },
    onPointerCancel: () => setDeplacement(null),
  })

  /** Direction (px) de la rue au nœud, pour poser les zébras en travers. */
  const directionAuNoeud = (noeud: string, centre: XY): XY => {
    const t = autour.get(noeud)?.[0]
    if (!t) return [1, 0]
    const points = t.properties.noeud_de === noeud ? t.geometry.coordinates : [...t.geometry.coordinates].reverse()
    const [x, y] = px(points[1] ?? points[0]!)
    const l = Math.hypot(x - centre[0], y - centre[1]) || 1
    return [(x - centre[0]) / l, (y - centre[1]) / l]
  }
  const largeurRue = (noeud: string) =>
    Math.max(...(autour.get(noeud) ?? []).map((t) => t.properties.voies_avant + t.properties.voies_arriere), 1) * largeur

  return (
    <svg ref={refSvg} className={`calque-carrefour calque-rues ${outil ?? 'lecture'}`} aria-label="Voies du réseau">
      {/* Voies : réservées (vélo, bus, tram) dans leur couleur, les autres dans celle de leur origine. */}
      {geometrie.voies.map((v) => {
        const t = parTroncon.get(v.troncon)!.properties
        const origine = t.source === 'manuel' ? 'manuel' : t.modifie ? 'modifie' : 'osm'
        const avant = v.cle.includes(':a')
        const type = typesVoies(avant ? t.voies_avant : t.voies_arriere, avant ? t.types_avant : t.types_arriere)[v.rang] ?? 'generale'
        return (
          <path
            key={v.cle}
            className={['calque-rue', voiesCliquables && 'interactive', selection?.type === 'troncon' && selection.id === v.troncon && 'selectionnee']
              .filter(Boolean)
              .join(' ')}
            d={chemin(v.points)}
            stroke={COULEUR_TYPE[type] ?? COULEUR_SOURCE[origine]}
            strokeWidth={largeur}
            onClick={voiesCliquables ? (e) => onClicTroncon(v.troncon, pointeurSur(e).lonLat) : undefined}
          >
            <title>{`${t.nom ?? 'Rue sans nom'} · voie ${v.rang + 1}${type !== 'generale' ? ` (${type})` : ''}`}</title>
          </path>
        )
      })}

      {/* Nœuds : passage piéton, ligne d'arrêt à feux, appartenance à un carrefour. */}
      {reseau.noeuds.features.map((n) => {
        const p = n.properties
        const position = deplacement?.id === n.id ? deplacement.position : n.geometry.coordinates
        const centre = px(position)
        const [dx, dy] = directionAuNoeud(n.id, centre)
        const demi = largeurRue(n.id) / 2 + 3
        const ouvert = p.carrefour_id !== null && p.carrefour_id === carrefourOuvert
        const selectionne = selection?.type === 'noeud' && selection.id === n.id
        const titre = [
          p.feux && 'ligne d’arrêt à feux',
          p.pieton && `passage piéton${p.pieton === 'feux' ? ' à feux' : p.pieton === 'non_marquee' ? ' non marqué' : ''}`,
          p.carrefour_id && (ouvert ? 'nœud du carrefour ouvert' : 'nœud d’un carrefour'),
          `${p.degre} tronçon${p.degre > 1 ? 's' : ''}`,
        ]
          .filter(Boolean)
          .join(' · ')
        return (
          <g
            key={n.id}
            className={['calque-noeud-reseau', selectionner && 'interactive', selectionne && 'selectionne'].filter(Boolean).join(' ')}
            {...(selectionner ? gestesNoeud(n.id) : {})}
          >
            <title>{titre}</title>
            {p.pieton && (
              <line
                className="zebras"
                x1={centre[0] - dy * demi}
                y1={centre[1] + dx * demi}
                x2={centre[0] + dy * demi}
                y2={centre[1] - dx * demi}
                strokeWidth={Math.max(4, 2.5 / metresParPixel)}
              />
            )}
            {p.carrefour_id && (
              <circle
                cx={centre[0]}
                cy={centre[1]}
                r={9}
                className="anneau-carrefour"
                stroke={ouvert ? COULEURS_RESEAU.carrefourOuvert : COULEURS_RESEAU.carrefour}
              />
            )}
            <circle
              cx={centre[0]}
              cy={centre[1]}
              r={p.feux ? 5 : selectionner || selectionne ? 4 : 2.5}
              className="pastille"
              fill={p.feux ? COULEURS_RESEAU.feux : p.degre === 1 ? COULEURS_RESEAU.culDeSac : '#ffffff'}
            />
          </g>
        )
      })}

      {/* Liaisons des nœuds : montrées avec l'outil Liaison. */}
      {connecter &&
        noeuds.map((n) => (
          <g key={n.id} className={['calque-liens', 'modifiables', n.auto && 'auto'].filter(Boolean).join(' ')}>
            {n.liaisons.map((l) => {
              const depuis = trouver(geometrie.arrivees.get(n.id), l.de, l.voie_de)
              const vers = trouver(geometrie.departs.get(n.id), l.vers, l.voie_vers)
              if (!depuis || !vers) return null
              return (
                <path
                  key={`${l.de}:${l.voie_de}>${l.vers}:${l.voie_vers}`}
                  className="lien"
                  d={cheminConnexion(paire(depuis), paire(vers))}
                  stroke="#ffffff"
                  onClick={() => onBasculerLiaison(n.id, l)}
                >
                  <title>Cliquer pour retirer cette liaison</title>
                </path>
              )
            })}
          </g>
        ))}

      {glisse && (
        <Elastique depart={px(glisse.depart.position)} arrivee={px(glisse.position ?? glisse.pointeur)} valide={glisse.cible !== null} />
      )}

      {/* Poignées de l'outil Liaison : bouts des voies qui arrivent (à tirer), débuts de celles qui repartent (cibles). */}
      {connecter &&
        noeuds.flatMap(({ id: noeud }) => [
          ...(geometrie.arrivees.get(noeud) ?? []).map((b) => (
            <Poignee
              key={`a:${noeud}:${b.troncon}:${b.rang}`}
              centre={px(b.bout)}
              rayon={5}
              couleur={BLEU_ARRIVEE}
              vide={false}
              etat={
                glisse?.depart.troncon === b.troncon && glisse.depart.rang === b.rang && glisse.depart.noeud === noeud
                  ? 'active'
                  : glisse
                    ? 'inactive'
                    : 'normale'
              }
              titre="Glisser vers une voie qui repart de ce nœud"
              {...gestes({ noeud, troncon: b.troncon, rang: b.rang, position: b.bout })}
            />
          )),
          ...(geometrie.departs.get(noeud) ?? []).map((b) => (
            <Poignee
              key={`d:${noeud}:${b.troncon}:${b.rang}`}
              centre={px(b.bout)}
              rayon={4}
              couleur="#ffffff"
              vide
              etat={glisse?.cible?.troncon === b.troncon && glisse.cible.rang === b.rang ? 'cible' : 'normale'}
              titre="Voie qui repart"
            />
          )),
        ])}
    </svg>
  )
}
