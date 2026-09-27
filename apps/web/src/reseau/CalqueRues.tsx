/**
 * Voies des rues et des carrefours de la vue, dans un seul calque SVG (docs/RESEAU.md §7) : chaque
 * rue est dessinée voie par voie, à sa largeur, comme les voies d'un carrefour, et se relie aux
 * autres voies avec le même geste partout (outil Liaison, à la « lane connector » de TM:PE) :
 * - à un nœud ordinaire, du bout d'une voie qui arrive au début d'une voie qui repart ;
 * - au bord d'un carrefour, d'une voie de rue vers une voie entrante d'une de ses branches, ou
 *   d'une voie sortante vers une voie de rue (le carrefour doit être ouvert : ses liens vivent
 *   dans ses brouillons, enregistrés avec lui).
 * Refaire le geste, ou cliquer une liaison, la retire.
 *
 * Le carrefour ouvert est dessiné par son propre calque, au-dessus ; les autres sont dessinés ici,
 * et un clic dessus l'ouvre.
 */
import {
  boutsAuNoeud,
  cleVoie,
  liaisonsRetenues,
  type BoutAuNoeud,
  type Liaison,
  type LonLat,
  type XY,
} from '@voirie/engine'
import type { Branche, Raccordement, ReseauGeoJson } from '@voirie/schema'
import { useMemo, useRef, useState, type MouseEvent, type PointerEvent } from 'react'
import { cheminConnexion } from '../configuration/calque/chemins'
import { Courbe, Elastique, Poignee, Voie } from '../configuration/calque/elements'
import { useProjection } from '../configuration/calque/projection'
import { useRelaisCarte } from '../configuration/calque/relais'
import { couleursVoies, voiesDe } from '../configuration/modele'
import { COULEURS_RESEAU } from './couleurs'
import { geometrieRues, type BoutVoie } from './voiesRues'

/** Outil actif : `autre` pour les outils propres au carrefour ouvert (caler, feux, piétons). */
export type OutilVoies = 'selection' | 'tracer' | 'connecter' | 'autre'

/** Carrefour ouvert : ses branches et raccordements du brouillon, qui priment sur l'enregistré. */
export interface FocusCarrefour {
  carrefourId: string
  branches: Branche[]
  raccordements: Raccordement[]
}

interface Props {
  reseau: ReseauGeoJson
  outil: OutilVoies | null
  focus: FocusCarrefour | null
  /** Tronçon sélectionné, mis en avant. */
  selection: string | null
  onClicTroncon: (id: string, position: LonLat) => void
  /** Clic sur un carrefour qui n'est pas ouvert : l'ouvrir. */
  onClicCarrefour: (id: string) => void
  /** Ajoute la liaison au nœud, ou la retire si elle existe (les liaisons proposées deviennent saisies). */
  onBasculerLiaison: (noeud: string, liaison: Liaison) => void
  /**
   * Lien entre une voie de rue et une voie de branche du carrefour ouvert. Une branche différente
   * de celle du tronçon l'y raccorde (liens proposés) ; sinon le lien est ajouté ou retiré.
   */
  onLienCarrefour: (cle: string, sens: 'entree' | 'sortie', paire: [number, number], branche: string) => void
}

/** Largeur réelle d'une voie (m), dessinée aux 8/10 comme dans le calque du carrefour. */
const LARGEUR_VOIE_M = 3.25 * 0.8
/** Distance (px) à laquelle un bout de voie attire l'élastique. */
const TOLERANCE_CIBLE_PX = 14
const GRIS = '#e5e7eb'
/** Bout d'une voie qui arrive : c'est lui qu'on tire (les voies qui repartent sont des cibles, creuses). */
const BLEU_ARRIVEE = '#2f6fd6'

const COULEUR_SOURCE = { osm: GRIS, modifie: COULEURS_RESEAU.modifie, manuel: COULEURS_RESEAU.manuel } as const

type Depart =
  | { type: 'rue'; noeud: string; troncon: string; rang: number; position: LonLat }
  | { type: 'branche'; code: string; rang: number; position: LonLat }

type Cible = { type: 'rue'; troncon: string; rang: number } | { type: 'branche'; code: string; rang: number }

interface Glisse {
  depart: Depart
  pointeur: LonLat
  cible: Cible | null
  position: LonLat | null
}

const cleRaccordement = (r: Pick<Raccordement, 'troncon_id' | 'extremite'>) => `${r.troncon_id}:${r.extremite}`

export function CalqueRues({ reseau, outil, focus, selection, onClicTroncon, onClicCarrefour, onBasculerLiaison, onLienCarrefour }: Props) {
  const projection = useProjection()
  const refSvg = useRef<SVGSVGElement>(null)
  useRelaisCarte(refSvg)
  const [glisse, setGlisse] = useState<Glisse | null>(null)

  const troncons = reseau.troncons.features
  const geometrie = useMemo(() => geometrieRues(troncons, reseau.noeuds.features), [troncons, reseau.noeuds.features])
  const parTroncon = useMemo(() => new Map(troncons.map((t) => [t.id, t])), [troncons])

  // Liaisons de chaque nœud ordinaire, saisies ou proposées.
  const noeuds = useMemo(() => {
    const autour = new Map<string, typeof troncons>()
    for (const t of troncons) {
      for (const n of [t.properties.noeud_de, t.properties.noeud_vers]) autour.set(n, [...(autour.get(n) ?? []), t])
    }
    return reseau.noeuds.features
      .filter((n) => n.properties.carrefour_id === null && (autour.get(n.id)?.length ?? 0) >= 2)
      .map((n) => {
        const bouts: BoutAuNoeud[] = boutsAuNoeud(
          n.id,
          (autour.get(n.id) ?? []).map((t) => ({ ...t.properties, points: t.geometry.coordinates })),
        )
        return { id: n.id, ...liaisonsRetenues(bouts, n.properties.liaisons) }
      })
  }, [troncons, reseau.noeuds.features])

  // Carrefours : l'ouvert avec son brouillon, les autres tels qu'enregistrés.
  const carrefours = useMemo(
    () =>
      reseau.carrefours.map((c) => {
        const ouvert = focus?.carrefourId === c.id
        const branches = ouvert ? focus.branches : c.branches
        return { ...c, ouvert, branches, raccordements: ouvert ? focus.raccordements : c.raccordements, couleurs: couleursVoies(branches) }
      }),
    [reseau.carrefours, focus],
  )
  const carrefourOuvert = carrefours.find((c) => c.ouvert)
  const noeudDuCarrefour = (r: Raccordement) => {
    const t = parTroncon.get(r.troncon_id)
    return t && (r.extremite === 'de' ? t.properties.noeud_de : t.properties.noeud_vers)
  }

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
  const noeudOuvert = carrefourOuvert && (reseau.noeuds.features.find((n) => n.properties.carrefour_id === carrefourOuvert.id)?.id ?? null)
  const cibleSous = (depart: Depart, pointeur: LonLat): { cible: Cible; position: LonLat } | null => {
    if (depart.type === 'rue' && depart.noeud === noeudOuvert && carrefourOuvert) {
      for (const b of carrefourOuvert.branches) {
        const voie = voiesDe(b, 'entrante').find((v) => pres(v.geom[1], pointeur))
        if (voie) return { cible: { type: 'branche', code: b.code, rang: voie.rang }, position: voie.geom[1] }
      }
      return null
    }
    const noeud = depart.type === 'rue' ? depart.noeud : noeudOuvert
    const depart_ = noeud ? geometrie.departs.get(noeud)?.find((b) => pres(b.bout, pointeur)) : undefined
    return depart_ ? { cible: { type: 'rue', troncon: depart_.troncon, rang: depart_.rang }, position: depart_.bout } : null
  }

  const lacher = () => {
    if (!glisse?.cible) return setGlisse(null)
    const { depart, cible } = glisse
    if (depart.type === 'rue' && cible.type === 'rue') {
      onBasculerLiaison(depart.noeud, { de: depart.troncon, voie_de: depart.rang, vers: cible.troncon, voie_vers: cible.rang })
    } else if (depart.type === 'rue' && cible.type === 'branche') {
      const r = carrefourOuvert?.raccordements.find((x) => x.troncon_id === depart.troncon && noeudDuCarrefour(x) === depart.noeud)
      if (r) onLienCarrefour(cleRaccordement(r), 'entree', [depart.rang, cible.rang], cible.code)
    } else if (depart.type === 'branche' && cible.type === 'rue') {
      const r = carrefourOuvert?.raccordements.find((x) => x.troncon_id === cible.troncon && noeudDuCarrefour(x) === noeudOuvert)
      if (r) onLienCarrefour(cleRaccordement(r), 'sortie', [depart.rang, cible.rang], depart.code)
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
  const estCible = (c: Cible) =>
    glisse?.cible?.type === c.type &&
    glisse.cible.rang === c.rang &&
    (c.type === 'rue' ? glisse.cible.type === 'rue' && glisse.cible.troncon === c.troncon : glisse.cible.type === 'branche' && glisse.cible.code === c.code)

  return (
    <svg ref={refSvg} className={`calque-carrefour calque-rues ${outil ?? 'lecture'}`} aria-label="Voies des rues">
      {/* Voies des rues, dans la couleur de leur origine (OSM, corrigée, tracée à la main). */}
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

      {/* Carrefours de la vue qui ne sont pas ouverts : leurs voies et connexions ; un clic l'ouvre. */}
      {carrefours
        .filter((c) => !c.ouvert)
        .map((c) => {
          const voies = new Map(c.branches.flatMap((b) => b.voies.map((v) => [cleVoie(b.code, v.sens, v.rang), v] as const)))
          const ouvrir = outil !== 'tracer' ? () => onClicCarrefour(c.id) : undefined
          return (
            <g key={c.id} className="calque-carrefour-ferme">
              {[...voies].map(([cle, v]) => (
                <Voie
                  key={cle}
                  segment={[px(v.geom[0]), px(v.geom[1])]}
                  largeur={largeur}
                  couleur={c.couleurs.get(cle) ?? GRIS}
                  sortante={v.sens === 'sortante'}
                  etat="normale"
                  interactive={ouvrir !== undefined}
                  titre={`${c.nom} · ${cle} : cliquer pour ouvrir le carrefour`}
                  onSurvol={() => undefined}
                  onClic={ouvrir}
                />
              ))}
              {c.connexions.map((k) => {
                const de = voies.get(k.de)
                const vers = voies.get(k.vers)
                if (!de || !vers) return null
                return (
                  <Courbe
                    key={`${k.de}>${k.vers}`}
                    entree={[px(de.geom[0]), px(de.geom[1])]}
                    sortie={[px(vers.geom[0]), px(vers.geom[1])]}
                    couleur={c.couleurs.get(k.de) ?? '#ffffff'}
                    etat="normale"
                    titre={`${k.de} → ${k.vers}`}
                  />
                )
              })}
            </g>
          )
        })}

      {/* Liens entre les rues et les branches des carrefours. */}
      {carrefours.map((c) =>
        c.raccordements.map((r) => {
          const noeud = noeudDuCarrefour(r)
          const b = r.branche ? c.branches.find((x) => x.code === r.branche) : undefined
          if (!noeud || !b) return null
          const entrantes = voiesDe(b, 'entrante')
          const sortantes = voiesDe(b, 'sortante')
          const retirer = (sens: 'entree' | 'sortie', p: [number, number]) =>
            connecter && c.ouvert ? () => onLienCarrefour(cleRaccordement(r), sens, p, b.code) : undefined
          const auto = 'liens_auto' in r && r.liens_auto
          return (
            <g key={`${c.id}:${cleRaccordement(r)}`} className={['calque-liens', auto && 'auto', c.ouvert && connecter && 'modifiables'].filter(Boolean).join(' ')}>
              {r.liens.entree.map(([i, j]) => {
                const depuis = trouver(geometrie.arrivees.get(noeud), r.troncon_id, i)
                const vers = entrantes[j]
                if (!depuis || !vers) return null
                return (
                  <path
                    key={`e${i}-${j}`}
                    className="lien"
                    d={cheminConnexion(paire(depuis), [px(vers.geom[1]), px(vers.geom[0])])}
                    stroke={c.couleurs.get(cleVoie(b.code, 'entrante', vers.rang)) ?? GRIS}
                    onClick={retirer('entree', [i, j])}
                  >
                    <title>{`${r.nom ?? 'Rue'}, voie ${i + 1} → ${b.code}:e${vers.rang}`}</title>
                  </path>
                )
              })}
              {r.liens.sortie.map(([j, i]) => {
                const depuis = sortantes[j]
                const vers = trouver(geometrie.departs.get(noeud), r.troncon_id, i)
                if (!depuis || !vers) return null
                return (
                  <path
                    key={`s${j}-${i}`}
                    className="lien"
                    d={cheminConnexion([px(depuis.geom[1]), px(depuis.geom[0])], paire(vers))}
                    stroke={GRIS}
                    onClick={retirer('sortie', [j, i])}
                  >
                    <title>{`${b.code}:s${depuis.rang} → ${r.nom ?? 'rue'}, voie ${i + 1}`}</title>
                  </path>
                )
              })}
            </g>
          )
        }),
      )}

      {/* Liaisons des nœuds ordinaires : montrées avec l'outil Liaison. */}
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
        [...noeuds.map((n) => n.id), ...(noeudOuvert ? [noeudOuvert] : [])].flatMap((noeud) => [
          ...(geometrie.arrivees.get(noeud) ?? []).map((b) => (
            <Poignee
              key={`a:${noeud}:${b.troncon}:${b.rang}`}
              centre={px(b.bout)}
              rayon={5}
              couleur={BLEU_ARRIVEE}
              vide={false}
              etat={
                glisse?.depart.type === 'rue' && glisse.depart.troncon === b.troncon && glisse.depart.rang === b.rang && glisse.depart.noeud === noeud
                  ? 'active'
                  : glisse
                    ? 'inactive'
                    : 'normale'
              }
              titre={noeud === noeudOuvert ? 'Glisser vers une voie entrante du carrefour' : 'Glisser vers une voie qui repart de ce nœud'}
              {...gestes({ type: 'rue', noeud, troncon: b.troncon, rang: b.rang, position: b.bout })}
            />
          )),
          ...(geometrie.departs.get(noeud) ?? []).map((b) => (
            <Poignee
              key={`d:${noeud}:${b.troncon}:${b.rang}`}
              centre={px(b.bout)}
              rayon={4}
              couleur="#ffffff"
              vide
              etat={estCible({ type: 'rue', troncon: b.troncon, rang: b.rang }) ? 'cible' : 'normale'}
              titre="Voie qui repart"
            />
          )),
        ])}

      {/* Carrefour ouvert : bouts éloignés de ses voies, pour les relier aux rues. */}
      {connecter &&
        carrefourOuvert?.branches.flatMap((b) => [
          ...(glisse?.depart.type === 'rue' && glisse.depart.noeud === noeudOuvert
            ? voiesDe(b, 'entrante').map((v) => (
                <Poignee
                  key={`be:${b.code}:${v.rang}`}
                  centre={px(v.geom[1])}
                  rayon={5}
                  couleur="#ffffff"
                  vide
                  etat={estCible({ type: 'branche', code: b.code, rang: v.rang }) ? 'cible' : 'cible-possible'}
                  titre={`${b.code}:e${v.rang} : lâcher ici`}
                />
              ))
            : []),
          ...voiesDe(b, 'sortante').map((v) => (
            <Poignee
              key={`bs:${b.code}:${v.rang}`}
              centre={px(v.geom[1])}
              rayon={5}
              couleur="#9ca3af"
              vide={false}
              etat={glisse?.depart.type === 'branche' && glisse.depart.code === b.code && glisse.depart.rang === v.rang ? 'active' : glisse ? 'inactive' : 'normale'}
              titre={`${b.code}:s${v.rang} : glisser vers une voie de rue qui repart du carrefour`}
              {...gestes({ type: 'branche', code: b.code, rang: v.rang, position: v.geom[1] })}
            />
          )),
        ])}
    </svg>
  )
}
