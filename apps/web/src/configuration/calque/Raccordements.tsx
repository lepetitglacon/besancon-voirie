/**
 * Tronçons du réseau raccordés au carrefour, dans le calque (docs/RESEAU.md §4) : leurs voies au
 * bout du tronçon, et les liens voie à voie avec les voies des branches, à la « lane connector ».
 * Outil Liaison : glisser d'une voie du tronçon qui arrive vers le bout d'une voie entrante de sa
 * branche, ou du bout d'une voie sortante vers une voie du tronçon qui repart. Refaire le geste,
 * ou cliquer un lien, le retire.
 */
import { distanceMetres, extraire, preparerPolyligne, voiesBoutTroncon, type LonLat, type Segment, type XY } from '@voirie/engine'
import type { Branche, LiensRaccordement } from '@voirie/schema'
import { useState, type MouseEvent, type PointerEvent } from 'react'
import { voiesDe } from '../modele'
import type { RaccordementAffiche } from '../raccordements'
import { cheminConnexion } from './chemins'
import { Elastique, Poignee } from './elements'
import type { Projection } from './projection'

/** Couleur des tronçons et de leurs liens, distincte des voies du carrefour. */
const COULEUR_TRONCON = '#f472b6'
/** Distance (px) à laquelle un bout de voie attire l'élastique. */
const TOLERANCE_CIBLE_PX = 14
/** Longueur (m) des voies de tronçon dessinées. */
const LONGUEUR_M = 18

interface Props {
  raccordements: RaccordementAffiche[]
  branches: Branche[]
  /** Poignées de liaison en mode « connecter » ; clic ouvrant la popup en mode « selection ». */
  mode: 'selection' | 'connecter' | 'autre' | null
  projection: Projection
  largeurVoie: number
  selection: string | null
  onBasculerLien: (r: RaccordementAffiche, sens: keyof LiensRaccordement, paire: [number, number]) => void
  onClic: (r: RaccordementAffiche, position: LonLat) => void
}

/** Voies d'un bout de tronçon, orientées [côté carrefour, vers l'extérieur]. */
function voiesDuBout(r: RaccordementAffiche) {
  const ligne = preparerPolyligne(r.points)
  const plusLoin = extraire(ligne, 0, Math.min(ligne.longueur, 15)).at(-1)!
  const direction = distanceMetres(r.points[0]!, plusLoin) > 0.5 ? plusLoin : r.points.at(-1)!
  return voiesBoutTroncon(r.points[0]!, direction, r.voies_vers_carrefour, r.voies_depuis_carrefour, LONGUEUR_M)
}

type Depart =
  | { type: 'troncon'; cle: string; rang: number; position: LonLat }
  | { type: 'branche'; code: string; rang: number; position: LonLat }

interface Glisse {
  depart: Depart
  pointeur: LonLat
  cible: { cle: string; rang: number } | { code: string; rang: number } | null
}

export function Raccordements({ raccordements, branches, mode, projection, largeurVoie, selection, onBasculerLien, onClic }: Props) {
  const { px, lonLat } = projection
  const [glisse, setGlisse] = useState<Glisse | null>(null)
  const segmentPx = ([a, b]: Segment): [XY, XY] => [px(a), px(b)]
  const inverse = ([a, b]: Segment): Segment => [b, a]

  const bouts = raccordements.map((r) => ({ r, voies: voiesDuBout(r), branche: branches.find((b) => b.code === r.branche) }))
  const voiesBranche = (code: string, sens: 'entrante' | 'sortante') => {
    const b = branches.find((x) => x.code === code)
    return b ? voiesDe(b, sens) : []
  }

  const positionPointeur = (e: PointerEvent<SVGElement>): LonLat => {
    const cadre = e.currentTarget.ownerSVGElement!.getBoundingClientRect()
    return lonLat(e.clientX - cadre.left, e.clientY - cadre.top)
  }
  const pres = (a: LonLat, b: LonLat) => {
    const [ax, ay] = px(a)
    const [bx, by] = px(b)
    return Math.hypot(ax - bx, ay - by) <= TOLERANCE_CIBLE_PX
  }

  /** Cible sous le pointeur : bout d'une voie entrante de la branche, ou voie d'un tronçon qui repart. */
  const cibleSous = (depart: Depart, pointeur: LonLat): Glisse['cible'] => {
    if (depart.type === 'troncon') {
      const r = raccordements.find((x) => x.cle === depart.cle)
      const voie = r?.branche ? voiesBranche(r.branche, 'entrante').find((v) => pres(v.geom[1], pointeur)) : undefined
      return voie && r?.branche ? { code: r.branche, rang: voie.rang } : null
    }
    for (const { r, voies } of bouts) {
      if (r.branche !== depart.code) continue
      const rang = voies.sortantes.findIndex((v) => pres(v[0], pointeur))
      if (rang >= 0) return { cle: r.cle, rang }
    }
    return null
  }

  const gestes = (depart: Depart) => ({
    onPointerDown: (e: PointerEvent<SVGCircleElement>) => {
      e.stopPropagation()
      e.currentTarget.setPointerCapture(e.pointerId)
      setGlisse({ depart, pointeur: depart.position, cible: null })
    },
    onPointerMove: (e: PointerEvent<SVGCircleElement>) => {
      if (!glisse) return
      const pointeur = positionPointeur(e)
      setGlisse({ ...glisse, pointeur, cible: cibleSous(glisse.depart, pointeur) })
    },
    onPointerUp: () => {
      if (glisse?.cible) {
        const { depart, cible } = glisse
        if (depart.type === 'troncon' && 'code' in cible) {
          const r = raccordements.find((x) => x.cle === depart.cle)!
          onBasculerLien(r, 'entree', [depart.rang, cible.rang])
        } else if (depart.type === 'branche' && 'cle' in cible) {
          const r = raccordements.find((x) => x.cle === cible.cle)!
          onBasculerLien(r, 'sortie', [depart.rang, cible.rang])
        }
      }
      setGlisse(null)
    },
    onPointerCancel: () => setGlisse(null),
  })

  const connecter = mode === 'connecter'
  const clicBout = (r: RaccordementAffiche) =>
    mode === 'selection'
      ? (e: MouseEvent<SVGElement>) => {
          const cadre = (e.currentTarget.ownerSVGElement ?? e.currentTarget).getBoundingClientRect()
          onClic(r, lonLat(e.clientX - cadre.left, e.clientY - cadre.top))
        }
      : undefined

  // Branches qui ont un tronçon raccordé : leurs sortantes peuvent se tirer vers ce tronçon.
  const branchesRaccordees = new Set(raccordements.flatMap((r) => (r.branche ? [r.branche] : [])))

  return (
    <g className={`calque-raccordements ${mode ?? 'lecture'}`}>
      {bouts.map(({ r, voies, branche }) => {
        const selectionne = selection === r.cle
        const sansBranche = r.branche === null
        const titre = `${r.nom ?? 'Tronçon sans nom'} · ${sansBranche ? 'aucune branche' : `branche ${r.branche}`}${r.liens_auto ? ' · liens proposés' : ''}`
        const entrantesBranche = branche ? voiesDe(branche, 'entrante') : []
        const sortantesBranche = branche ? voiesDe(branche, 'sortante') : []
        return (
          <g key={r.cle} className={['calque-bout-troncon', selectionne && 'selectionne', sansBranche && 'sans-branche'].filter(Boolean).join(' ')}>
            {[...voies.entrantes, ...voies.sortantes].map((v, i) => (
              <path
                key={`voie-${i}`}
                className="voie"
                d={`M${px(v[0]).join(',')} L${px(v[1]).join(',')}`}
                strokeWidth={Math.max(2, largeurVoie * 0.6)}
                onClick={clicBout(r)}
              >
                <title>{titre}</title>
              </path>
            ))}
            {r.liens.entree.map(([i, j]) => {
              const depuis = voies.entrantes[i]
              const vers = entrantesBranche[j]
              if (!depuis || !vers) return null
              return (
                <path
                  key={`e${i}-${j}`}
                  className={['lien', r.liens_auto && 'auto'].filter(Boolean).join(' ')}
                  d={cheminConnexion(segmentPx(depuis), segmentPx(inverse(vers.geom)))}
                  stroke={COULEUR_TRONCON}
                  onClick={connecter ? () => onBasculerLien(r, 'entree', [i, j]) : undefined}
                >
                  <title>{connecter ? 'Cliquer pour retirer ce lien' : titre}</title>
                </path>
              )
            })}
            {r.liens.sortie.map(([j, i]) => {
              const depuis = sortantesBranche[j]
              const vers = voies.sortantes[i]
              if (!depuis || !vers) return null
              return (
                <path
                  key={`s${j}-${i}`}
                  className={['lien', r.liens_auto && 'auto'].filter(Boolean).join(' ')}
                  d={cheminConnexion(segmentPx(inverse(depuis.geom)), segmentPx(vers))}
                  stroke={COULEUR_TRONCON}
                  onClick={connecter ? () => onBasculerLien(r, 'sortie', [j, i]) : undefined}
                >
                  <title>{connecter ? 'Cliquer pour retirer ce lien' : titre}</title>
                </path>
              )
            })}
          </g>
        )
      })}

      {glisse && (
        <Elastique
          depart={px(glisse.depart.position)}
          arrivee={
            glisse.cible
              ? 'code' in glisse.cible
                ? px(voiesBranche(glisse.cible.code, 'entrante').find((v) => v.rang === (glisse.cible as { rang: number }).rang)!.geom[1])
                : px(voiesDuBout(raccordements.find((x) => x.cle === (glisse.cible as { cle: string }).cle)!).sortantes[glisse.cible.rang]![0])
              : px(glisse.pointeur)
          }
          valide={glisse.cible !== null}
        />
      )}

      {connecter &&
        bouts.flatMap(({ r, voies }) => [
          // Voies du tronçon qui arrivent : on les tire vers une entrante de la branche.
          ...voies.entrantes.map((v, rang) => (
            <Poignee
              key={`${r.cle}:e${rang}`}
              centre={px(v[0])}
              rayon={6}
              couleur={COULEUR_TRONCON}
              vide={false}
              etat={glisse?.depart.type === 'troncon' && glisse.depart.cle === r.cle && glisse.depart.rang === rang ? 'active' : glisse ? 'inactive' : 'normale'}
              titre={`${r.nom ?? 'Tronçon'}, voie ${rang + 1} : glisser vers une voie entrante de la branche ${r.branche ?? '?'}`}
              {...gestes({ type: 'troncon', cle: r.cle, rang, position: v[0] })}
            />
          )),
          // Voies du tronçon qui repartent : cibles quand on tire une sortante de la branche.
          ...voies.sortantes.map((v, rang) => {
            const cible = glisse?.cible && 'cle' in glisse.cible && glisse.cible.cle === r.cle && glisse.cible.rang === rang
            const possible = glisse?.depart.type === 'branche' && glisse.depart.code === r.branche
            return (
              <Poignee
                key={`${r.cle}:s${rang}`}
                centre={px(v[0])}
                rayon={5}
                couleur={COULEUR_TRONCON}
                vide
                etat={cible ? 'cible' : possible ? 'cible-possible' : 'normale'}
                titre={`${r.nom ?? 'Tronçon'}, voie ${rang + 1} en repartant`}
              />
            )
          }),
        ])}

      {connecter &&
        branches.flatMap((b) => [
          // Bout éloigné des entrantes : cibles quand on tire une voie de tronçon.
          ...(glisse?.depart.type === 'troncon'
            ? voiesDe(b, 'entrante').map((v) => {
                const r = raccordements.find((x) => glisse.depart.type === 'troncon' && x.cle === glisse.depart.cle)
                if (r?.branche !== b.code) return null
                const cible = glisse.cible && 'code' in glisse.cible && glisse.cible.code === b.code && glisse.cible.rang === v.rang
                return (
                  <Poignee
                    key={`bout-${b.code}:e${v.rang}`}
                    centre={px(v.geom[1])}
                    rayon={5}
                    couleur="#ffffff"
                    vide
                    etat={cible ? 'cible' : 'cible-possible'}
                    titre={`${b.code}:e${v.rang} : lâcher ici`}
                  />
                )
              })
            : []),
          // Bout éloigné des sortantes : on les tire vers une voie du tronçon qui repart.
          ...(branchesRaccordees.has(b.code)
            ? voiesDe(b, 'sortante').map((v) => (
                <Poignee
                  key={`bout-${b.code}:s${v.rang}`}
                  centre={px(v.geom[1])}
                  rayon={5}
                  couleur="#9ca3af"
                  vide={false}
                  etat={glisse?.depart.type === 'branche' && glisse.depart.code === b.code && glisse.depart.rang === v.rang ? 'active' : glisse ? 'inactive' : 'normale'}
                  titre={`${b.code}:s${v.rang} : glisser vers une voie du tronçon qui repart`}
                  {...gestes({ type: 'branche', code: b.code, rang: v.rang, position: v.geom[1] })}
                />
              ))
            : []),
        ])}
    </g>
  )
}
