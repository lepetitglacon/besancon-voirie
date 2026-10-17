import { Box, Button, HStack, Stack, Text } from '@chakra-ui/react'
import { couleurSuivante, estChangementCouleur, type CouleurReleve, type SaisieReleve } from '@voirie/engine'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type WheelEvent } from 'react'
import { Aide, Valeur } from '../ds'

/** Une ligne de feux, telle que la timeline la dessine. */
interface LigneTimeline {
  code: string
  pieton: boolean
}

interface Props {
  saisies: readonly SaisieReleve[]
  lignes: readonly LigneTimeline[]
  onChanger: (saisies: SaisieReleve[]) => void
}

const HAUT_LIGNE = 26
const HAUT_AXE = 20
const MARGE_GAUCHE = 44
/** Pas de calage (s) ; Maj : au dixième. */
const PAS_S = 1
const PAS_FIN_S = 0.1
/** Fenêtre minimale affichée (s), au zoom le plus fort. */
const FENETRE_MIN_S = 10
const COULEUR: Record<CouleurReleve, string> = {
  vert: 'var(--chakra-colors-feu-vert)',
  jaune: 'var(--chakra-colors-feu-orange)',
  rouge: 'var(--chakra-colors-feu-rouge)',
}
const GLYPHE = { bus: '🚌', tram: '🚋', boucle: '🚗', pieton: '🚶' } as const

/** Pas des graduations possibles (s), et écart minimal entre deux étiquettes (px). */
const PAS_GRADUATION = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600]
const ECART_GRADUATION_PX = 56

const arrondir = (s: number, pas: number) => Math.round(s / pas) * pas

/**
 * Timeline d'un relevé, pour le recaler au bureau : une rangée par ligne de feux sur le temps réel du
 * relevé, chaque changement de couleur en poignée qu'on glisse (à la seconde, au dixième avec Maj).
 * Double-clic sur une rangée : un changement de plus (la couleur qui suit). Un changement choisi
 * change de couleur ou s'efface (Suppr), se décale aux flèches. Molette : zoom ; glisser le fond : défiler.
 * Les événements sont des repères sur la ligne à laquelle ils sont rattachés, ou sur leur rangée.
 */
export function TimelineReleve({ saisies, lignes, onChanger }: Props) {
  const cadre = useRef<HTMLDivElement>(null)
  const [largeur, setLargeur] = useState(800)
  useEffect(() => {
    const element = cadre.current
    if (!element) return
    const observateur = new ResizeObserver(() => setLargeur(element.clientWidth))
    observateur.observe(element)
    return () => observateur.disconnect()
  }, [])

  // Temps relatif au premier appui (s) ; la durée totale borne le défilement.
  const t0 = saisies[0]?.t ?? 0
  const duree = Math.max(FENETRE_MIN_S, ((saisies.at(-1)?.t ?? t0) - t0) / 1000 + 5)
  const [fenetre, setFenetre] = useState<[number, number]>([0, Math.min(duree, 180)])
  const [debut, fin] = fenetre
  const utile = Math.max(1, largeur - MARGE_GAUCHE)
  const x = (s: number) => MARGE_GAUCHE + ((s - debut) / (fin - debut)) * utile
  const secondeA = (px: number) => debut + ((px - MARGE_GAUCHE) / utile) * (fin - debut)

  const rangees = useMemo(() => [...lignes.map((l) => l.code), '·'], [lignes])
  const hauteur = rangees.length * HAUT_LIGNE + HAUT_AXE
  const rangDe = (s: SaisieReleve) => {
    const r = s.ligne ? rangees.indexOf(s.ligne) : -1
    return r >= 0 ? r : rangees.length - 1
  }

  /** Saisie choisie (par son index dans `saisies`). */
  const [choisie, setChoisie] = useState<number | null>(null)
  const glisse = useRef<{ index: number; dx: number } | null>(null)
  const defile = useRef<{ x: number; fenetre: [number, number] } | null>(null)

  const remplacer = (index: number, saisie: SaisieReleve | null) => {
    const suivantes = saisies.flatMap((s, i) => (i === index ? (saisie ? [saisie] : []) : [s]))
    const triees = [...suivantes].sort((a, b) => a.t - b.t)
    onChanger(triees)
    setChoisie(saisie ? triees.indexOf(saisie) : null)
  }
  /** Déplace une saisie à `s` secondes, sans franchir les changements voisins de sa ligne. */
  const deplacer = (index: number, s: number) => {
    const saisie = saisies[index]!
    let t = t0 + s * 1000
    if (estChangementCouleur(saisie)) {
      const memes = saisies.filter((x) => estChangementCouleur(x) && x.ligne === saisie.ligne)
      const rang = memes.indexOf(saisie)
      const avant = memes[rang - 1]?.t ?? -Infinity
      const apres = memes[rang + 1]?.t ?? Infinity
      t = Math.min(apres - 100, Math.max(avant + 100, t))
    }
    if (t !== saisie.t) remplacer(index, { ...saisie, t: Math.round(t) })
  }

  const zoomer = (e: WheelEvent<SVGSVGElement>) => {
    e.preventDefault()
    const cadreSvg = e.currentTarget.getBoundingClientRect()
    const centre = secondeA(e.clientX - cadreSvg.left)
    const facteur = e.deltaY > 0 ? 1.25 : 0.8
    const etendue = Math.min(duree, Math.max(FENETRE_MIN_S, (fin - debut) * facteur))
    const nouveauDebut = Math.min(Math.max(0, centre - (centre - debut) * (etendue / (fin - debut))), duree - etendue)
    setFenetre([nouveauDebut, nouveauDebut + etendue])
  }

  const versSeconde = (e: PointerEvent<SVGElement>) => {
    const cadreSvg = (e.currentTarget.ownerSVGElement ?? e.currentTarget).getBoundingClientRect()
    return secondeA(e.clientX - cadreSvg.left)
  }

  const clavier = (e: KeyboardEvent<SVGSVGElement>) => {
    if (choisie === null) return
    const saisie = saisies[choisie]
    if (!saisie) return
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      remplacer(choisie, null)
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault()
      const pas = (e.shiftKey ? PAS_FIN_S : PAS_S) * (e.key === 'ArrowLeft' ? -1 : 1)
      deplacer(choisie, (saisie.t - t0) / 1000 + pas)
    } else if (e.key === 'Escape') setChoisie(null)
  }

  // Le plus petit pas qui laisse de la place aux étiquettes.
  const graduation = PAS_GRADUATION.find((pas) => (pas / (fin - debut)) * utile >= ECART_GRADUATION_PX) ?? PAS_GRADUATION.at(-1)!
  const graduations = Array.from({ length: Math.floor((fin - debut) / graduation) + 2 }, (_, i) => Math.ceil(debut / graduation) * graduation + i * graduation).filter(
    (s) => s <= fin,
  )
  const choisieSaisie = choisie !== null ? saisies[choisie] : undefined
  const ligneChoisie = choisieSaisie && estChangementCouleur(choisieSaisie) ? lignes.find((l) => l.code === choisieSaisie.ligne) : undefined

  return (
    <Stack gap="2">
      <Box ref={cadre} borderWidth="1px" borderColor="border.subtle" borderRadius="l2" overflow="hidden" bg="bg.subtle">
        <svg
          width={largeur}
          height={hauteur}
          tabIndex={0}
          role="application"
          aria-label="Timeline du relevé : glisser les changements de couleur pour les recaler"
          style={{ display: 'block', touchAction: 'none', userSelect: 'none', outline: 'none', cursor: 'grab' }}
          onWheel={zoomer}
          onKeyDown={clavier}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId)
            defile.current = { x: e.clientX, fenetre }
            setChoisie(null)
          }}
          onPointerMove={(e) => {
            const d = defile.current
            if (!d) return
            const decalage = ((d.x - e.clientX) / utile) * (d.fenetre[1] - d.fenetre[0])
            const etendue = d.fenetre[1] - d.fenetre[0]
            const nouveauDebut = Math.min(Math.max(0, d.fenetre[0] + decalage), Math.max(0, duree - etendue))
            setFenetre([nouveauDebut, nouveauDebut + etendue])
          }}
          onPointerUp={() => (defile.current = null)}
          onDoubleClick={(e) => {
            // Double-clic sur une rangée : un changement de plus, à la couleur qui suit celle de ce moment.
            const cadreSvg = e.currentTarget.getBoundingClientRect()
            const ligne = lignes[Math.floor((e.clientY - cadreSvg.top) / HAUT_LIGNE)]
            const px = e.clientX - cadreSvg.left
            if (!ligne || px < MARGE_GAUCHE) return
            const t = t0 + arrondir(secondeA(px), PAS_S) * 1000
            const avant = saisies.filter((c) => estChangementCouleur(c) && c.ligne === ligne.code && c.t <= t).at(-1)
            const nouvelle: SaisieReleve = {
              t,
              ligne: ligne.code,
              couleur: couleurSuivante(avant && estChangementCouleur(avant) ? avant.couleur : null, !ligne.pieton),
            }
            const triees = [...saisies, nouvelle].sort((p, q) => p.t - q.t)
            onChanger(triees)
            setChoisie(triees.indexOf(nouvelle))
          }}
        >
          {/* Rangées : code de la ligne, segments de couleur entre ses changements. */}
          {rangees.map((code, rang) => {
            const y = rang * HAUT_LIGNE
            const changements = saisies.filter((s) => estChangementCouleur(s) && s.ligne === code) as Array<Extract<SaisieReleve, { couleur: CouleurReleve }>>
            return (
              <g key={code}>
                <rect x={0} y={y} width={largeur} height={HAUT_LIGNE} fill={rang % 2 ? 'transparent' : 'var(--chakra-colors-bg-muted)'} />
                <text x={8} y={y + HAUT_LIGNE / 2} dominantBaseline="central" fontSize={11} fontWeight={700} fill="var(--chakra-colors-fg)">
                  {code === '·' ? 'Év.' : code}
                </text>
                {changements.map((c, i) => {
                  const a = (c.t - t0) / 1000
                  const b = i + 1 < changements.length ? (changements[i + 1]!.t - t0) / 1000 : duree
                  if (b < debut || a > fin) return null
                  return (
                    <rect
                      key={c.t}
                      x={Math.max(MARGE_GAUCHE, x(a))}
                      y={y + 6}
                      width={Math.max(0, Math.min(x(b), largeur) - Math.max(MARGE_GAUCHE, x(a)))}
                      height={HAUT_LIGNE - 12}
                      fill={COULEUR[c.couleur]}
                      opacity={0.85}
                    />
                  )
                })}
              </g>
            )
          })}

          {/* Poignées : changements de couleur et événements, à glisser. */}
          {saisies.map((s, index) => {
            const sec = (s.t - t0) / 1000
            if (sec < debut || sec > fin) return null
            const y = rangDe(s) * HAUT_LIGNE
            const px = x(sec)
            const actif = index === choisie
            return (
              <g
                key={`${s.t}-${index}`}
                style={{ cursor: 'ew-resize' }}
                onPointerDown={(e) => {
                  e.stopPropagation()
                  e.currentTarget.setPointerCapture(e.pointerId)
                  glisse.current = { index, dx: versSeconde(e) - sec }
                  setChoisie(index)
                }}
                onPointerMove={(e) => {
                  const g = glisse.current
                  if (!g || g.index !== index || !e.currentTarget.hasPointerCapture(e.pointerId)) return
                  deplacer(index, arrondir(versSeconde(e) - g.dx, e.shiftKey ? PAS_FIN_S : PAS_S))
                }}
                onPointerUp={() => (glisse.current = null)}
              >
                {estChangementCouleur(s) ? (
                  <rect
                    x={px - 3}
                    y={y + 2}
                    width={6}
                    height={HAUT_LIGNE - 4}
                    rx={2}
                    fill={actif ? 'var(--chakra-colors-brand-solid)' : 'var(--chakra-colors-fg)'}
                    stroke="var(--chakra-colors-bg)"
                  >
                    <title>
                      {s.ligne} au {s.couleur} à {sec.toFixed(1)} s
                    </title>
                  </rect>
                ) : (
                  <text x={px} y={y + HAUT_LIGNE / 2} textAnchor="middle" dominantBaseline="central" fontSize={14} opacity={actif ? 1 : 0.85}>
                    {GLYPHE[s.evenement]}
                    <title>
                      {s.evenement}
                      {s.ligne ? ` (${s.ligne})` : ''} à {sec.toFixed(1)} s
                    </title>
                  </text>
                )}
              </g>
            )
          })}

          {/* Axe du temps, en secondes depuis le premier appui. */}
          <g transform={`translate(0, ${rangees.length * HAUT_LIGNE})`}>
            {graduations.map((s) => (
              <g key={s}>
                <line x1={x(s)} x2={x(s)} y1={0} y2={4} stroke="var(--chakra-colors-fg-muted)" />
                <text x={x(s)} y={14} textAnchor="middle" fontSize={10} fill="var(--chakra-colors-fg-muted)">
                  {s} s
                </text>
              </g>
            ))}
          </g>
        </svg>
      </Box>

      <HStack gap="2" wrap="wrap" minH="8">
        {choisieSaisie ? (
          <>
            <Valeur textStyle="xs">
              {estChangementCouleur(choisieSaisie)
                ? `${choisieSaisie.ligne} au ${choisieSaisie.couleur}`
                : `${choisieSaisie.evenement}${choisieSaisie.ligne ? ` (${choisieSaisie.ligne})` : ''}`}{' '}
              à {((choisieSaisie.t - t0) / 1000).toFixed(1)} s
            </Valeur>
            {estChangementCouleur(choisieSaisie) &&
              (['vert', 'jaune', 'rouge'] as const)
                .filter((c) => c !== 'jaune' || !ligneChoisie?.pieton)
                .map((c) => (
                  <Button
                    key={c}
                    size="2xs"
                    variant={choisieSaisie.couleur === c ? 'solid' : 'outline'}
                    onClick={() => remplacer(choisie!, { ...choisieSaisie, couleur: c })}
                  >
                    {c}
                  </Button>
                ))}
            <Button size="2xs" variant="ghost" colorPalette="red" onClick={() => remplacer(choisie!, null)}>
              Supprimer
            </Button>
          </>
        ) : (
          <Aide>
            Glisser une poignée pour la recaler (à la seconde, au dixième avec Maj) · double-clic sur une rangée : un changement de plus · molette : zoom ·
            glisser le fond : défiler.
          </Aide>
        )}
        <Text ms="auto" textStyle="xs" color="fg.muted">
          {Math.round(debut)}–{Math.round(fin)} s sur {Math.round(duree)} s
        </Text>
      </HStack>
    </Stack>
  )
}
