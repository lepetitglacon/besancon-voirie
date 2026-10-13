/**
 * Calque SVG de configuration d'un carrefour, superposé à la carte : voies, passages piétons,
 * connexions et poignées sont des composants React (états en classes CSS, événements pointeur
 * natifs). Le SVG est rendu dans le conteneur de la carte mais hors de son canvas : MapLibre ne
 * voit pas les gestes faits sur les éléments interactifs, et le fond du calque laisse passer
 * les clics vers la carte (pointer-events: none). La molette et l'appui de la souris, eux, sont
 * relayés au canvas : la carte zoome et se déplace aussi depuis une voie ou une liaison.
 */
import { azimutsVoiesGiratoire, cleVoie, flechesParVoie, repereLocal, type LonLat, type XY } from '@voirie/engine'
import type { Anneau, Branche, Connexion, EmpriseIa, TypeFeu } from '@voirie/schema'
import { useEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent } from 'react'
import { useMap } from 'react-map-gl/maplibre'
import { FLECHES } from '../libelles'
import { couleursVoies, deplacerPoignee, voiesDe, type Poignee as PoigneeModele } from '../modele'
import {
  CadrePhoto,
  Courbe,
  EcartOsm,
  Elastique,
  Etiquette,
  NoeudAnneau,
  PassagePieton,
  Poignee,
  TronconAnneau,
  Voie,
  type EtatCourbe,
  type EtatFeu,
  type EtatPoignee,
  type FormePoignee,
  type EtatVoie,
} from './elements'
import { useProjection } from './projection'

/**
 * Outil actif sur le calque : « selection » ouvre la popup de l'élément cliqué, « pieton » ajoute
 * ou retire le passage piéton de la branche cliquée, « noeud » pose et déplace les nœuds d'un
 * giratoire ; les autres déplacent des poignées.
 */
export type ModeEdition = 'selection' | 'ajuster' | 'connecter' | 'feux' | 'pieton' | 'noeud'

/** Élément du calque cliqué, avec la position du clic (pour y ancrer une popup). */
export type ClicCalque =
  | { type: 'voie'; cle: string; position: LonLat }
  | { type: 'connexion'; de: string; vers: string; position: LonLat }
  | { type: 'branche'; code: string; position: LonLat }
  | { type: 'noeud'; code: string; position: LonLat }

/** Feu du carrefour, déplaçable en mode « feux » pour le poser sur son mât. */
export interface FeuPlacable {
  id: string
  type: TypeFeu
  position: LonLat
  /** Position OSM d'origine, null pour un feu ajouté à la main. */
  osm: LonLat | null
  placeALaMain: boolean
}

/** Feu en cours de déplacement : la carte le dessine à cette position. */
export interface ApercuFeu {
  id: string
  position: LonLat
}

interface Props {
  branches: Branche[]
  connexions: Connexion[]
  /** Nœuds de l'anneau d'un giratoire ; null pour un carrefour ordinaire. */
  anneau: Anneau | null
  /** null : dessin seul, sans poignées ni clics. */
  mode: ModeEdition | null
  /** Connexions à mettre en avant (« de>vers »), par exemple celles de la ligne de feux active. */
  surlignees?: ReadonlySet<string>
  /** Lecture d'un programme : couleur du feu de chaque connexion (« de>vers ») et passage piéton. */
  feux?: { connexions: ReadonlyMap<string, EtatFeu>; traversees: ReadonlyMap<string, EtatFeu> } | null
  onDeplacer: (poignee: PoigneeModele, position: LonLat) => void
  /** Ajoute la connexion, ou la retire si elle existe. */
  onConnecter: (de: string, vers: string) => void
  /** Feux physiques du carrefour, à poser sur leur mât en mode « feux ». */
  feuxPlacables: FeuPlacable[]
  /** Pose le feu (ou le remet à sa position OSM : null) ; l'aperçu reste jusqu'à la fin de la promesse. */
  onPlacerFeu: (id: string, position: LonLat | null) => Promise<void>
  onApercuFeu: (apercu: ApercuFeu | null) => void
  /** Clic sur une voie, une connexion ou le code d'une branche (outils « selection » et « pieton »). */
  onClic?: (clic: ClicCalque) => void
  /** Élément sélectionné, mis en avant (clé de voie, « de>vers » ou code de branche). */
  selection?: string | null
  /** Cadre de la photo envoyée à l'IA, montré avant de lancer l'analyse. */
  cadrePhoto?: { emprise: EmpriseIa; libelle: string } | null
}

/** Part de la largeur réelle (3,25 m) occupée par le dessin d'une voie. */
const LARGEUR_VOIE_M = 3.25 * 0.8
const LARGEUR_PASSAGE_M = 2.5
/** Distance (px) à laquelle une voie sortante attire l'élastique de connexion. */
const TOLERANCE_CIBLE_PX = 14
/** Au-delà (px) entre l'appui et le relâché, c'est un déplacement de la carte, pas un clic. */
const TOLERANCE_CLIC_PX = 3
const GRIS_SORTANTE = '#e5e7eb'
const COULEUR_NOEUD = '#38bdf8'
/** En dessous (m), relâcher un nœud après l'avoir saisi est un clic : sa popup s'ouvre. */
const DEPLACEMENT_NOEUD_MIN_M = 0.3
const VIOLET_PASSAGE = '#7d3cb4'

type Survol = { type: 'voie'; cle: string } | { type: 'connexion'; cle: string } | null

type Glisse =
  | { type: 'poignee'; poignee: PoigneeModele; depart: LonLat; position: LonLat }
  /** Voies choisies glissées par leur corps ; `retirer` : Maj+clic sans bouger retire `cle` du choix. */
  | { type: 'voies'; cle: string; poignee: PoigneeModele & { role: 'voies' }; position: LonLat; retirer: boolean }
  | { type: 'connexion'; de: string; position: LonLat; cible: string | null }
  /** `enregistrement` : lâché, en attente de l'API (le feu reste affiché à sa nouvelle place). */
  | { type: 'feu'; id: string; depart: LonLat; position: LonLat; enregistrement: boolean }

/** En dessous (m), un glisser de feu est un simple clic : rien n'est enregistré. */
const DEPLACEMENT_FEU_MIN_M = 0.2
const COULEUR_FEU: Record<TypeFeu, string> = { vehicule: '#e0561e', pieton: '#1f8a4c' }

const cleConnexion = (c: Connexion) => `${c.de}>${c.vers}`
const symboles = new Map(FLECHES.map((f) => [f.direction, f.symbole]))

export function CalqueCarrefour(props: Props) {
  const {
    branches,
    connexions,
    anneau,
    mode,
    surlignees,
    feux,
    onDeplacer,
    onConnecter,
    feuxPlacables,
    onPlacerFeu,
    onApercuFeu,
    onClic,
    selection,
    cadrePhoto,
  } = props
  const projection = useProjection()
  const { current: carte } = useMap()
  const refSvg = useRef<SVGSVGElement>(null)
  const [survol, setSurvol] = useState<Survol>(null)
  const [glisse, setGlisse] = useState<Glisse | null>(null)
  /** Mode « Voie » : voies choisies (clic, Maj+clic pour en ajouter), qui se glissent ensemble. */
  const [voiesChoisies, setVoiesChoisies] = useState<ReadonlySet<string>>(new Set())

  // La sélection de voies ne survit pas au changement d'outil ; un clic sur la carte la vide.
  useEffect(() => setVoiesChoisies(new Set()), [mode])
  useEffect(() => {
    if (!carte || mode !== 'ajuster') return
    const vider = () => setVoiesChoisies(new Set())
    carte.on('click', vider)
    return () => {
      carte.off('click', vider)
    }
  }, [carte, mode])

  const apercuFeu = useMemo<ApercuFeu | null>(
    () => (glisse?.type === 'feu' ? { id: glisse.id, position: glisse.position } : null),
    [glisse],
  )
  useEffect(() => onApercuFeu(apercuFeu), [apercuFeu, onApercuFeu])

  // MapLibre n'écoute la molette et l'appui de la souris que sur son conteneur de canvas : on lui
  // renvoie ceux reçus par les éléments du calque, pour zoomer et déplacer la carte depuis une
  // voie ou une liaison. Les poignées gardent l'appui (glisser-déposer). La suite du geste
  // (mousemove, mouseup) est écoutée par MapLibre sur tout le document.
  useEffect(() => {
    const svg = refSvg.current
    const canvas = carte?.getCanvas()
    if (!svg || !canvas) return
    // Écouteur non passif, pour bloquer aussi le zoom du navigateur (pincement = molette + ctrl).
    const relayerMolette = (e: WheelEvent) => {
      e.preventDefault()
      canvas.dispatchEvent(new WheelEvent('wheel', e))
    }
    let appui: XY | null = null
    const relayerAppui = (e: globalThis.MouseEvent) => {
      if (e.button !== 0 || (e.target as Element).closest('.calque-poignee, .calque-voie.deplacable')) return
      appui = [e.clientX, e.clientY]
      canvas.dispatchEvent(new globalThis.MouseEvent('mousedown', e))
    }
    // Un déplacement de la carte ne vaut pas clic sur l'élément où la souris a été relâchée.
    const filtrerClic = (e: globalThis.MouseEvent) => {
      if (appui && Math.hypot(e.clientX - appui[0], e.clientY - appui[1]) > TOLERANCE_CLIC_PX) e.stopPropagation()
      appui = null
    }
    svg.addEventListener('wheel', relayerMolette, { passive: false })
    svg.addEventListener('mousedown', relayerAppui)
    svg.addEventListener('click', filtrerClic, { capture: true })
    return () => {
      svg.removeEventListener('wheel', relayerMolette)
      svg.removeEventListener('mousedown', relayerAppui)
      svg.removeEventListener('click', filtrerClic, { capture: true })
    }
  }, [carte])

  // Pendant un ajustement, on dessine le brouillon avec la poignée déjà déplacée : les voies
  // et leurs connexions suivent le pointeur en direct.
  const apercu = useMemo(
    () =>
      glisse?.type === 'poignee' || glisse?.type === 'voies'
        ? deplacerPoignee({ branches, connexions, anneau }, glisse.poignee, glisse.position)
        : { branches, connexions, anneau },
    [branches, connexions, anneau, glisse],
  )
  const couleurs = useMemo(() => couleursVoies(apercu.branches), [apercu.branches])
  const fleches = useMemo(
    () => flechesParVoie(apercu.branches, apercu.connexions, azimutsVoiesGiratoire(apercu.branches, apercu.anneau)),
    [apercu],
  )

  if (!projection) return null
  const { px, lonLat, metresParPixel } = projection
  const largeurVoie = Math.max(2, LARGEUR_VOIE_M / metresParPixel)
  const largeurPassage = Math.max(2, LARGEUR_PASSAGE_M / metresParPixel)

  const voies = new Map(
    apercu.branches.flatMap((b) => b.voies.map((v) => [cleVoie(b.code, v.sens, v.rang), { ...v, branche: b.code, troncon: b.troncon }] as const)),
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
    if (voiesChoisies.has(cle)) return 'choisie'
    if (selection === cle) return 'survolee'
    if (survol?.type === 'voie' && survol.cle === cle) return 'survolee'
    if (voiesLiees.has(cle)) return 'liee'
    if (survol && !voiesLiees.has(cle)) return 'estompee'
    return 'normale'
  }

  const etatCourbe = (cle: string): EtatCourbe => {
    if (survol?.type === 'connexion' && survol.cle === cle) return mode === 'connecter' ? 'a-retirer' : 'survolee'
    if (courbesLiees.has(cle)) return 'survolee'
    if (survol) return 'estompee'
    // Une connexion sélectionnée : les autres s'estompent (maquette, « clic sur une liaison »).
    if (selection?.includes('>')) return selection === cle ? 'surlignee' : 'estompee'
    if (surlignees?.size) return surlignees.has(cle) ? 'surlignee' : 'estompee'
    return 'normale'
  }

  // ── Glisser-déposer (capture du pointeur sur la poignée) ──
  const positionPointeur = (e: PointerEvent<SVGElement>): LonLat => {
    const cadre = e.currentTarget.ownerSVGElement!.getBoundingClientRect()
    return lonLat(e.clientX - cadre.left, e.clientY - cadre.top)
  }

  const cliquable = mode === 'selection' || mode === 'pieton'
  const positionClic = (e: MouseEvent<SVGElement>): LonLat => {
    const cadre = (e.currentTarget.ownerSVGElement ?? e.currentTarget).getBoundingClientRect()
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

  const commencer = (poignee: PoigneeModele, depart: LonLat) => (e: PointerEvent<SVGElement>) => {
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    if (mode === 'connecter' && poignee.role === 'voie') {
      setGlisse({ type: 'connexion', de: poignee.cle, position: depart, cible: null })
    } else {
      setGlisse({ type: 'poignee', poignee, depart, position: depart })
    }
  }

  const suivre = (e: PointerEvent<SVGElement>) => {
    if (!glisse || (glisse.type === 'feu' && glisse.enregistrement)) return
    const position = positionPointeur(e)
    setGlisse(glisse.type === 'connexion' ? { ...glisse, position, cible: sortanteLaPlusProche(position) } : { ...glisse, position })
  }

  const terminer = () => {
    if (glisse?.type === 'feu') {
      if (glisse.enregistrement) return
      const [est, nord] = repereLocal(glisse.depart).versXY(glisse.position)
      if (Math.hypot(est, nord) < DEPLACEMENT_FEU_MIN_M) return setGlisse(null)
      setGlisse({ ...glisse, enregistrement: true })
      // Succès ou échec (signalé par l'appelant), l'aperçu disparaît une fois la carte à jour.
      void onPlacerFeu(glisse.id, glisse.position).finally(() => setGlisse(null))
      return
    }
    if (glisse?.type === 'poignee') {
      const { poignee, depart, position } = glisse
      const immobile = Math.hypot(...repereLocal(depart).versXY(position)) < DEPLACEMENT_NOEUD_MIN_M
      if (poignee.role === 'noeud' && immobile) onClic?.({ type: 'noeud', code: poignee.code, position })
      else onDeplacer(poignee, position)
    }
    if (glisse?.type === 'voies') {
      const { cle, poignee, position, retirer } = glisse
      const immobile = Math.hypot(...repereLocal(poignee.depart).versXY(position)) < DEPLACEMENT_NOEUD_MIN_M
      if (!immobile) onDeplacer(poignee, position)
      else if (retirer) setVoiesChoisies((choisies) => new Set([...choisies].filter((c) => c !== cle)))
    }
    if (glisse?.type === 'connexion' && glisse.cible) onConnecter(glisse.de, glisse.cible)
    setGlisse(null)
  }

  // Mode « Voie » : appui sur le corps d'une voie. Sans Maj, la voie rejoint le geste seule, sauf
  // si elle est déjà choisie (tout le choix suit) ; avec Maj, elle s'ajoute au choix, ou s'en
  // retire si on relâche sans bouger.
  const saisirVoie = (cle: string) => (e: PointerEvent<SVGElement>) => {
    if (e.button !== 0 || glisse) return
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    const dejaChoisie = voiesChoisies.has(cle)
    const choisies = e.shiftKey ? new Set(voiesChoisies).add(cle) : dejaChoisie ? voiesChoisies : new Set([cle])
    setVoiesChoisies(choisies)
    const depart = positionPointeur(e)
    setGlisse({
      type: 'voies',
      cle,
      poignee: { role: 'voies', cles: [...choisies], depart },
      position: depart,
      retirer: e.shiftKey && dejaChoisie,
    })
  }

  const gestes = (poignee: PoigneeModele, depart: LonLat) => ({
    onPointerDown: commencer(poignee, depart),
    onPointerMove: suivre,
    onPointerUp: terminer,
    onPointerCancel: () => setGlisse(null),
  })

  // ── Poignées selon le mode ──
  const poignees: Array<{ cle: string; centre: XY; rayon: number; forme?: FormePoignee; couleur: string; vide: boolean; etat: EtatPoignee; titre: string; gestes?: ReturnType<typeof gestes> }> = []
  if (mode === 'ajuster' || mode === 'connecter') {
    for (const [cle, voie] of voies) {
      const sortante = voie.sens === 'sortante'
      // Les voies d'un tronçon d'anneau suivent ses nœuds : elles se relient, sans se caler.
      if (mode === 'ajuster' && voie.troncon) continue
      for (const extremite of [0, 1] as const) {
        const poignee: PoigneeModele = { role: 'voie', cle, sens: voie.sens, extremite }
        // Comme une prise : rond (mâle) au bout par où la circulation quitte la voie, carré
        // (femelle) au bout par où elle y entre. Une liaison va toujours d'un rond à un carré.
        const sortie = sortante ? extremite === 1 : extremite === 0
        // En mode connexion, seul le bout côté carrefour se relie ; l'autre bout montre le sens.
        const bornee = mode === 'connecter' && extremite === 1
        const etat: EtatPoignee =
          glisse?.type === 'connexion'
            ? bornee
              ? 'inactive'
              : sortante
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
          forme: sortie ? 'rond' : 'carre',
          couleur: couleurs.get(cle) ?? GRIS_SORTANTE,
          vide: sortante,
          etat,
          titre: bornee
            ? `${cle} : ${sortante ? 'sortie de la voie' : 'entrée dans la voie'}`
            : mode === 'connecter'
              ? sortante
                ? `${cle} : lâcher ici pour connecter`
                : `${cle} : glisser vers une voie sortante`
              : `${cle} : glisser pour caler ${extremite === 0 ? 'la ligne d’arrêt' : 'l’autre bout'}`,
          // En mode connexion, seules les voies entrantes se tirent, par le bout côté carrefour ;
          // les sortantes sont des cibles.
          gestes: mode === 'connecter' && (sortante || bornee) ? undefined : gestes(poignee, voie.geom[extremite]),
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

  if (mode === 'noeud' && apercu.anneau) {
    for (const noeud of apercu.anneau.noeuds) {
      const enCours = glisse?.type === 'poignee' && glisse.poignee.role === 'noeud' && glisse.poignee.code === noeud.code
      poignees.push({
        cle: `noeud-${noeud.code}`,
        centre: px(enCours ? glisse.position : noeud.position),
        rayon: 9,
        couleur: COULEUR_NOEUD,
        vide: false,
        etat: enCours ? 'active' : 'normale',
        titre: `Nœud ${noeud.code} : glisser pour le caler sur la photo, cliquer pour ses réglages`,
        gestes: gestes({ role: 'noeud', code: noeud.code }, noeud.position),
      })
    }
  }

  // Mode « feux » : chaque feu se tire jusqu'à son mât ; un feu déjà placé montre sa position OSM.
  const feuxAffiches =
    mode === 'feux'
      ? feuxPlacables.map((feu) => {
          const enCours = glisse?.type === 'feu' && glisse.id === feu.id ? glisse : null
          const position = enCours?.position ?? feu.position
          return { ...feu, position, enCours: enCours !== null, deplace: feu.placeALaMain || enCours !== null }
        })
      : []
  const gestesFeu = (id: string, position: LonLat) => ({
    onPointerDown: (e: PointerEvent<SVGElement>) => {
      if (glisse) return
      e.stopPropagation()
      e.currentTarget.setPointerCapture(e.pointerId)
      setGlisse({ type: 'feu', id, depart: position, position, enregistrement: false })
    },
    onPointerMove: suivre,
    onPointerUp: terminer,
    onPointerCancel: () => {
      if (glisse?.type === 'feu' && !glisse.enregistrement) setGlisse(null)
    },
  })

  // Cadre de la photo, nord en haut : haut gauche, haut droite, bas droite, bas gauche.
  const coinsCadre = (() => {
    if (!cadrePhoto) return null
    const [ouest, sud, est, nord] = cadrePhoto.emprise
    return [px([ouest, nord]), px([est, nord]), px([est, sud]), px([ouest, sud])] as [XY, XY, XY, XY]
  })()

  const depart = glisse?.type === 'connexion' ? voies.get(glisse.de) : undefined
  const cible = cibleEnCours ? voies.get(cibleEnCours) : undefined

  return (
    <svg ref={refSvg} className={`calque-carrefour ${mode ?? 'lecture'}`} aria-label="Configuration du carrefour">
      {coinsCadre && cadrePhoto && <CadrePhoto coins={coinsCadre} libelle={cadrePhoto.libelle} />}

      {apercu.branches.map(
        (b) =>
          b.troncon &&
          b.geom && (
            <TronconAnneau
              key={`troncon-${b.code}`}
              trace={b.geom.map(px)}
              largeur={(Math.max(voiesDe(b, 'sortante').length, 1) * 3.25) / metresParPixel}
            />
          ),
      )}

      {apercu.branches.map(
        (b) => b.traversee && (
            <PassagePieton
              key={`passage-${b.code}`}
              segment={segmentPx(b.traversee)}
              largeur={largeurPassage}
              feu={feux ? (feux.traversees.get(b.code) ?? 'libre') : undefined}
            />
          ),
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
          deplacable={mode === 'ajuster' && !voie.troncon}
          titre={
            mode === 'ajuster' && !voie.troncon
              ? `${cle} : glisser pour déplacer la voie (Maj+clic : en choisir plusieurs)`
              : `${cle} · voie ${voie.sens} ${voie.rang + 1} (${voie.type})`
          }
          onSurvol={(actif) => setSurvol(actif ? { type: 'voie', cle } : null)}
          onClic={cliquable && onClic ? (e) => onClic({ type: 'voie', cle, position: positionClic(e) }) : undefined}
          {...(mode === 'ajuster' && !voie.troncon
            ? { onPointerDown: saisirVoie(cle), onPointerMove: suivre, onPointerUp: terminer, onPointerCancel: () => setGlisse(null) }
            : {})}
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
            feu={feux ? (feux.connexions.get(cle) ?? 'libre') : undefined}
            titre={mode === 'connecter' ? `${c.de} → ${c.vers} : cliquer pour retirer` : `${c.de} → ${c.vers}`}
            onSurvol={mode ? (actif) => setSurvol(actif ? { type: 'connexion', cle } : null) : undefined}
            onClic={
              mode === 'connecter'
                ? () => onConnecter(c.de, c.vers)
                : mode === 'selection' && onClic
                  ? (e) => onClic({ type: 'connexion', de: c.de, vers: c.vers, position: positionClic(e) })
                  : undefined
            }
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

      {apercu.anneau &&
        mode !== 'noeud' &&
        apercu.anneau.noeuds.map((noeud) => (
          <NoeudAnneau
            key={`noeud-${noeud.code}`}
            centre={px(noeud.position)}
            code={noeud.code}
            onClic={cliquable && onClic ? (e) => onClic({ type: 'noeud', code: noeud.code, position: positionClic(e) }) : undefined}
          />
        ))}

      {apercu.branches.map((b) => {
        // Tronçon d'anneau : son code à mi-chemin entre ses deux nœuds.
        const bout = b.troncon
          ? b.geom?.[Math.floor(b.geom.length / 2)]
          : (b.geom?.at(-1) ?? voiesDe(b, 'entrante')[0]?.geom[1] ?? voiesDe(b, 'sortante')[0]?.geom[1])
        return (
          bout && (
            <Etiquette
              key={`code-${b.code}`}
              classe={b.troncon ? 'calque-code troncon' : 'calque-code'}
              position={px(bout)}
              titre={b.troncon ? `Tronçon d’anneau ${b.code}` : cliquable ? `${b.code} · ${b.nom ?? 'branche'}` : undefined}
              onClic={
                cliquable && onClic && !b.troncon ? (e) => onClic({ type: 'branche', code: b.code, position: positionClic(e) }) : undefined
              }
            >
              {b.code}
            </Etiquette>
          )
        )
      })}

      {poignees.map(({ cle, gestes: g, ...poignee }) => (
        <Poignee key={cle} {...poignee} {...g} />
      ))}

      {feuxAffiches.map(
        (feu) =>
          feu.deplace &&
          feu.osm && (
            <EcartOsm
              key={`osm-${feu.id}`}
              osm={px(feu.osm)}
              position={px(feu.position)}
              onRemettre={feu.enCours ? undefined : () => void onPlacerFeu(feu.id, null)}
            />
          ),
      )}
      {feuxAffiches.map((feu) => (
        <Poignee
          key={`feu-${feu.id}`}
          centre={px(feu.position)}
          rayon={feu.type === 'pieton' ? 6 : 8}
          couleur={COULEUR_FEU[feu.type]}
          vide={false}
          etat={feu.enCours ? 'active' : 'normale'}
          titre={`Feu ${feu.type === 'pieton' ? 'piéton' : 'véhicule'} : glisser jusqu’à son mât sur la photo`}
          {...gestesFeu(feu.id, feu.position)}
        />
      ))}
    </svg>
  )
}
