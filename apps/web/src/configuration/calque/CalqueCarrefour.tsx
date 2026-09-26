/**
 * Calque SVG de configuration d'un carrefour, superposé à la carte : voies, passages piétons,
 * connexions et poignées sont des composants React (états en classes CSS, événements pointeur
 * natifs). Le SVG est rendu dans le conteneur de la carte mais hors de son canvas : MapLibre ne
 * voit pas les gestes faits sur les éléments interactifs, et le fond du calque laisse passer
 * les clics vers la carte (pointer-events: none).
 */
import { cleVoie, flechesParVoie, type LonLat, type XY } from '@voirie/engine'
import type { Branche, Connexion } from '@voirie/schema'
import { useMemo, useState, type PointerEvent } from 'react'
import { FLECHES } from '../libelles'
import { couleursVoies, deplacerPoignee, voiesDe, type Poignee as PoigneeModele } from '../modele'
import {
  Courbe,
  Elastique,
  Etiquette,
  PassagePieton,
  Poignee,
  Voie,
  type EtatCourbe,
  type EtatPoignee,
  type EtatVoie,
} from './elements'
import { useProjection } from './projection'

export type ModeEdition = 'ajuster' | 'connecter'

interface Props {
  branches: Branche[]
  connexions: Connexion[]
  /** null : dessin seul (onglet des lignes), sans poignées. */
  mode: ModeEdition | null
  /** Connexions à mettre en avant (« de>vers »), par exemple celles de la ligne de feux active. */
  surlignees?: ReadonlySet<string>
  onDeplacer: (poignee: PoigneeModele, position: LonLat) => void
  /** Ajoute la connexion, ou la retire si elle existe. */
  onConnecter: (de: string, vers: string) => void
}

/** Part de la largeur réelle (3,25 m) occupée par le dessin d'une voie. */
const LARGEUR_VOIE_M = 3.25 * 0.8
const LARGEUR_PASSAGE_M = 2.5
/** Distance (px) à laquelle une voie sortante attire l'élastique de connexion. */
const TOLERANCE_CIBLE_PX = 14
const GRIS_SORTANTE = '#e5e7eb'
const VIOLET_PASSAGE = '#7d3cb4'

type Survol = { type: 'voie'; cle: string } | { type: 'connexion'; cle: string } | null

type Glisse =
  | { type: 'poignee'; poignee: PoigneeModele; position: LonLat }
  | { type: 'connexion'; de: string; position: LonLat; cible: string | null }

const cleConnexion = (c: Connexion) => `${c.de}>${c.vers}`
const symboles = new Map(FLECHES.map((f) => [f.direction, f.symbole]))

export function CalqueCarrefour({ branches, connexions, mode, surlignees, onDeplacer, onConnecter }: Props) {
  const projection = useProjection()
  const [survol, setSurvol] = useState<Survol>(null)
  const [glisse, setGlisse] = useState<Glisse | null>(null)

  // Pendant un ajustement, on dessine le brouillon avec la poignée déjà déplacée : les voies
  // et leurs connexions suivent le pointeur en direct.
  const apercu = useMemo(
    () =>
      glisse?.type === 'poignee'
        ? deplacerPoignee({ branches, connexions }, glisse.poignee, glisse.position)
        : { branches, connexions },
    [branches, connexions, glisse],
  )
  const couleurs = useMemo(() => couleursVoies(apercu.branches), [apercu.branches])
  const fleches = useMemo(() => flechesParVoie(apercu.branches, apercu.connexions), [apercu])

  if (!projection) return null
  const { px, lonLat, metresParPixel } = projection
  const largeurVoie = Math.max(2, LARGEUR_VOIE_M / metresParPixel)
  const largeurPassage = Math.max(2, LARGEUR_PASSAGE_M / metresParPixel)

  const voies = new Map(
    apercu.branches.flatMap((b) => b.voies.map((v) => [cleVoie(b.code, v.sens, v.rang), { ...v, branche: b.code }] as const)),
  )
  const segmentPx = (geom: [LonLat, LonLat]): [XY, XY] => [px(geom[0]), px(geom[1])]

  // ── Relations entre éléments, pour les états visuels ──
  const connexionsDeVoie = (cle: string) => apercu.connexions.filter((c) => c.de === cle || c.vers === cle)
  const voiesLiees = new Set<string>()
  const courbesLiees = new Set<string>()
  if (survol?.type === 'voie') {
    for (const c of connexionsDeVoie(survol.cle)) {
      voiesLiees.add(c.de).add(c.vers)
      courbesLiees.add(cleConnexion(c))
    }
  } else if (survol?.type === 'connexion') {
    const [de, vers] = survol.cle.split('>') as [string, string]
    voiesLiees.add(de).add(vers)
    courbesLiees.add(survol.cle)
  }
  const cibleEnCours = glisse?.type === 'connexion' ? glisse.cible : null

  const etatVoie = (cle: string, sortante: boolean): EtatVoie => {
    if (glisse?.type === 'connexion' && sortante) return cle === cibleEnCours ? 'cible' : 'cible-possible'
    if (survol?.type === 'voie' && survol.cle === cle) return 'survolee'
    if (voiesLiees.has(cle)) return 'liee'
    if (survol && !voiesLiees.has(cle)) return 'estompee'
    return 'normale'
  }

  const etatCourbe = (cle: string): EtatCourbe => {
    if (survol?.type === 'connexion' && survol.cle === cle) return mode === 'connecter' ? 'a-retirer' : 'survolee'
    if (courbesLiees.has(cle)) return 'survolee'
    if (survol) return 'estompee'
    if (surlignees?.size) return surlignees.has(cle) ? 'surlignee' : 'estompee'
    return 'normale'
  }

  // ── Glisser-déposer (capture du pointeur sur la poignée) ──
  const positionPointeur = (e: PointerEvent<SVGCircleElement>): LonLat => {
    const cadre = e.currentTarget.ownerSVGElement!.getBoundingClientRect()
    return lonLat(e.clientX - cadre.left, e.clientY - cadre.top)
  }

  const sortanteLaPlusProche = (position: LonLat): string | null => {
    const [x, y] = px(position)
    let meilleure: { cle: string; distance: number } | null = null
    for (const [cle, voie] of voies) {
      if (voie.sens !== 'sortante') continue
      const [vx, vy] = px(voie.geom[0])
      const distance = Math.hypot(vx - x, vy - y)
      if (distance <= TOLERANCE_CIBLE_PX && (!meilleure || distance < meilleure.distance)) meilleure = { cle, distance }
    }
    return meilleure?.cle ?? null
  }

  const commencer = (poignee: PoigneeModele, depart: LonLat) => (e: PointerEvent<SVGCircleElement>) => {
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    if (mode === 'connecter' && poignee.role === 'voie') {
      setGlisse({ type: 'connexion', de: poignee.cle, position: depart, cible: null })
    } else {
      setGlisse({ type: 'poignee', poignee, position: depart })
    }
  }

  const suivre = (e: PointerEvent<SVGCircleElement>) => {
    if (!glisse) return
    const position = positionPointeur(e)
    setGlisse(glisse.type === 'connexion' ? { ...glisse, position, cible: sortanteLaPlusProche(position) } : { ...glisse, position })
  }

  const terminer = () => {
    if (glisse?.type === 'poignee') onDeplacer(glisse.poignee, glisse.position)
    if (glisse?.type === 'connexion' && glisse.cible) onConnecter(glisse.de, glisse.cible)
    setGlisse(null)
  }

  const gestes = (poignee: PoigneeModele, depart: LonLat) => ({
    onPointerDown: commencer(poignee, depart),
    onPointerMove: suivre,
    onPointerUp: terminer,
    onPointerCancel: () => setGlisse(null),
  })

  // ── Poignées selon le mode ──
  const poignees: Array<{ cle: string; centre: XY; rayon: number; couleur: string; vide: boolean; etat: EtatPoignee; titre: string; gestes?: ReturnType<typeof gestes> }> = []
  if (mode) {
    for (const [cle, voie] of voies) {
      const sortante = voie.sens === 'sortante'
      for (const extremite of [0, 1] as const) {
        if (mode === 'connecter' && extremite === 1) continue
        const poignee: PoigneeModele = { role: 'voie', cle, sens: voie.sens, extremite }
        const etat: EtatPoignee =
          glisse?.type === 'connexion'
            ? sortante
              ? cle === cibleEnCours
                ? 'cible'
                : 'cible-possible'
              : cle === glisse.de
                ? 'active'
                : 'inactive'
            : glisse?.type === 'poignee' && glisse.poignee.role === 'voie' && glisse.poignee.cle === cle && glisse.poignee.extremite === extremite
              ? 'active'
              : 'normale'
        poignees.push({
          cle: `${cle}:${extremite}`,
          centre: px(voie.geom[extremite]),
          rayon: extremite === 0 ? 7 : 5,
          couleur: couleurs.get(cle) ?? GRIS_SORTANTE,
          vide: sortante,
          etat,
          titre:
            mode === 'connecter'
              ? sortante
                ? `${cle} : lâcher ici pour connecter`
                : `${cle} : glisser vers une voie sortante`
              : `${cle} : glisser pour caler ${extremite === 0 ? 'la ligne d’arrêt' : 'l’autre bout'}`,
          // En mode connexion, seules les voies entrantes se tirent ; les sortantes sont des cibles.
          gestes: mode === 'connecter' && sortante ? undefined : gestes(poignee, voie.geom[extremite]),
        })
      }
    }
    if (mode === 'ajuster') {
      for (const b of apercu.branches) {
        if (!b.traversee) continue
        for (const extremite of [0, 1] as const) {
          const poignee: PoigneeModele = { role: 'traversee', branche: b.code, extremite }
          poignees.push({
            cle: `passage-${b.code}:${extremite}`,
            centre: px(b.traversee[extremite]),
            rayon: 6,
            couleur: VIOLET_PASSAGE,
            vide: false,
            etat: 'normale',
            titre: `Passage piéton ${b.code} : glisser pour le caler sur le marquage`,
            gestes: gestes(poignee, b.traversee[extremite]),
          })
        }
      }
    }
  }

  const depart = glisse?.type === 'connexion' ? voies.get(glisse.de) : undefined
  const cible = cibleEnCours ? voies.get(cibleEnCours) : undefined

  return (
    <svg className={`calque-carrefour ${mode ?? 'lecture'}`} aria-label="Configuration du carrefour">
      {apercu.branches.map(
        (b) => b.traversee && <PassagePieton key={`passage-${b.code}`} segment={segmentPx(b.traversee)} largeur={largeurPassage} />,
      )}

      {[...voies].map(([cle, voie]) => (
        <Voie
          key={cle}
          segment={segmentPx(voie.geom)}
          largeur={largeurVoie}
          couleur={couleurs.get(cle) ?? GRIS_SORTANTE}
          sortante={voie.sens === 'sortante'}
          etat={etatVoie(cle, voie.sens === 'sortante')}
          interactive={mode !== null}
          titre={`${cle} · voie ${voie.sens} ${voie.rang + 1} (${voie.type})`}
          onSurvol={(actif) => setSurvol(actif ? { type: 'voie', cle } : null)}
        />
      ))}

      {apercu.connexions.map((c) => {
        const entree = voies.get(c.de)
        const sortie = voies.get(c.vers)
        if (!entree || !sortie) return null
        const cle = cleConnexion(c)
        return (
          <Courbe
            key={cle}
            entree={segmentPx(entree.geom)}
            sortie={segmentPx(sortie.geom)}
            couleur={couleurs.get(c.de) ?? '#ffffff'}
            etat={etatCourbe(cle)}
            titre={mode === 'connecter' ? `${c.de} → ${c.vers} : cliquer pour retirer` : `${c.de} → ${c.vers}`}
            onSurvol={mode ? (actif) => setSurvol(actif ? { type: 'connexion', cle } : null) : undefined}
            onClic={mode === 'connecter' ? () => onConnecter(c.de, c.vers) : undefined}
          />
        )
      })}

      {glisse?.type === 'connexion' && depart && (
        <Elastique depart={px(depart.geom[0])} arrivee={cible ? px(cible.geom[0]) : px(glisse.position)} valide={cible !== undefined} />
      )}

      {[...voies]
        .filter(([, v]) => v.sens === 'entrante')
        .map(([cle, voie]) => {
          const [[x0, y0], [x1, y1]] = voie.geom
          const texte = (fleches[cle] ?? []).map((direction) => symboles.get(direction)).join('') || '∅'
          return (
            <Etiquette key={`fleches-${cle}`} classe="calque-fleches" position={px([x0 + (x1 - x0) * 0.35, y0 + (y1 - y0) * 0.35])}>
              {texte}
            </Etiquette>
          )
        })}

      {apercu.branches.map((b) => {
        const bout = b.geom?.at(-1) ?? voiesDe(b, 'entrante')[0]?.geom[1] ?? voiesDe(b, 'sortante')[0]?.geom[1]
        return (
          bout && (
            <Etiquette key={`code-${b.code}`} classe="calque-code" position={px(bout)}>
              {b.code}
            </Etiquette>
          )
        )
      })}

      {poignees.map(({ cle, gestes: g, ...poignee }) => (
        <Poignee key={cle} {...poignee} {...g} />
      ))}
    </svg>
  )
}
