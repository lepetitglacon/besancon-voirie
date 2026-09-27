/**
 * Voies du réseau de la vue, dans un calque SVG (docs/RESEAU.md §7) : chaque tronçon est dessiné
 * voie par voie, à sa largeur, et les voies se relient à chaque nœud avec le même geste (outil
 * Liaison, à la « lane connector » de TM:PE) : du bout d'une voie qui arrive au début d'une voie
 * qui repart. Refaire le geste, ou cliquer une liaison, la retire.
 */
import { boutsAuNoeud, liaisonsRetenues, type Liaison, type LonLat, type XY } from '@voirie/engine'
import type { ReseauGeoJson } from '@voirie/schema'
import { useMemo, useRef, useState, type MouseEvent, type PointerEvent } from 'react'
import { cheminConnexion } from '../configuration/calque/chemins'
import { Elastique, Poignee } from '../configuration/calque/elements'
import { useProjection } from '../configuration/calque/projection'
import { useRelaisCarte } from '../configuration/calque/relais'
import { COULEURS_RESEAU } from './couleurs'
import { geometrieRues, type BoutVoie } from './voiesRues'

export type OutilVoies = 'selection' | 'tracer' | 'connecter' | 'autre'

interface Props {
  reseau: ReseauGeoJson
  outil: OutilVoies | null
  /** Tronçon sélectionné, mis en avant. */
  selection: string | null
  onClicTroncon: (id: string, position: LonLat) => void
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

export function CalqueRues({ reseau, outil, selection, onClicTroncon, onBasculerLiaison }: Props) {
  const projection = useProjection()
  const refSvg = useRef<SVGSVGElement>(null)
  useRelaisCarte(refSvg)
  const [glisse, setGlisse] = useState<Glisse | null>(null)

  const troncons = reseau.troncons.features
  const geometrie = useMemo(() => geometrieRues(troncons, reseau.noeuds.features), [troncons, reseau.noeuds.features])
  const parTroncon = useMemo(() => new Map(troncons.map((t) => [t.id, t])), [troncons])

  // Liaisons de chaque nœud, saisies ou proposées.
  const noeuds = useMemo(() => {
    const autour = new Map<string, typeof troncons>()
    for (const t of troncons) {
      for (const n of [t.properties.noeud_de, t.properties.noeud_vers]) autour.set(n, [...(autour.get(n) ?? []), t])
    }
    return reseau.noeuds.features
      .filter((n) => (autour.get(n.id)?.length ?? 0) >= 2)
      .map((n) => {
        const bouts = boutsAuNoeud(
          n.id,
          (autour.get(n.id) ?? []).map((t) => ({ ...t.properties, points: t.geometry.coordinates })),
        )
        return { id: n.id, ...liaisonsRetenues(bouts, n.properties.liaisons) }
      })
  }, [troncons, reseau.noeuds.features])

  if (!projection) return null
  const { px, lonLat, metresParPixel } = projection
  const largeur = Math.max(2, LARGEUR_VOIE_M / metresParPixel)
  const chemin = (points: readonly LonLat[]) => points.map((p, i) => `${i ? 'L' : 'M'}${px(p).join(',')}`).join(' ')
  const paire = (b: BoutVoie): [XY, XY] => [px(b.bout), px(b.suivant)]
  const trouver = (liste: BoutVoie[] | undefined, troncon: string, rang: number) => liste?.find((b) => b.troncon === troncon && b.rang === rang)

  const connecter = outil === 'connecter'
  const selectionner = outil === 'selection'
  const positionClic = (e: MouseEvent<SVGElement> | PointerEvent<SVGElement>): LonLat => {
    const cadre = (e.currentTarget.ownerSVGElement ?? (e.currentTarget as SVGElement)).getBoundingClientRect()
    return lonLat(e.clientX - cadre.left, e.clientY - cadre.top)
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
      const pointeur = positionClic(e)
      const trouve = cibleSous(glisse.depart, pointeur)
      setGlisse({ ...glisse, pointeur, cible: trouve?.cible ?? null, position: trouve?.position ?? null })
    },
    onPointerUp: lacher,
    onPointerCancel: () => setGlisse(null),
  })

  return (
    <svg ref={refSvg} className={`calque-carrefour calque-rues ${outil ?? 'lecture'}`} aria-label="Voies du réseau">
      {/* Voies, dans la couleur de leur origine (OSM, corrigée, tracée à la main). */}
      {geometrie.voies.map((v) => {
        const t = parTroncon.get(v.troncon)!
        const origine = t.properties.source === 'manuel' ? 'manuel' : t.properties.modifie ? 'modifie' : 'osm'
        return (
          <path
            key={v.cle}
            className={['calque-rue', selection === v.troncon && 'selectionnee', selectionner && 'interactive'].filter(Boolean).join(' ')}
            d={chemin(v.points)}
            stroke={COULEUR_SOURCE[origine]}
            strokeWidth={largeur}
            onClick={selectionner ? (e) => onClicTroncon(v.troncon, positionClic(e)) : undefined}
          >
            <title>{`${t.properties.nom ?? 'Rue sans nom'} · voie ${v.rang + 1}`}</title>
          </path>
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
