import { Box, Button, HStack, Input, Stack, Text } from '@chakra-ui/react'
import {
  estChangementCouleur,
  estEvenement,
  estFin,
  finDuReleve,
  type CouleurReleve,
  type EvenementReleve,
  type SaisieReleve,
} from '@voirie/engine'
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type WheelEvent } from 'react'
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
/** Pas de calage (s) : l'API cale aussi chaque saisie à la seconde. */
const PAS_S = 1
/** Écart minimal entre deux changements d'une même ligne (s). */
const ECART_MIN_S = 1
/** Fenêtre minimale affichée (s), au zoom le plus fort. */
const FENETRE_MIN_S = 10
/** Au-delà de ce déplacement (px), un appui sur le fond est un défilement, pas un clic. */
const SEUIL_GLISSER_PX = 4
/** Pas des graduations possibles (s), et écart minimal entre deux étiquettes (px). */
const PAS_GRADUATION = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600]
const ECART_GRADUATION_PX = 56

const COULEURS: CouleurReleve[] = ['vert', 'jaune', 'rouge']
const COULEUR: Record<CouleurReleve, string> = {
  vert: 'var(--chakra-colors-feu-vert)',
  jaune: 'var(--chakra-colors-feu-orange)',
  rouge: 'var(--chakra-colors-feu-rouge)',
}
const EVENEMENTS: Array<{ type: EvenementReleve; glyphe: string; libelle: string }> = [
  { type: 'bus', glyphe: '🚌', libelle: 'Bus' },
  { type: 'tram', glyphe: '🚋', libelle: 'Tram' },
  { type: 'boucle', glyphe: '🚗', libelle: 'Boucle' },
  { type: 'pieton', glyphe: '🚶', libelle: 'Bouton' },
]
const glyphe = (type: EvenementReleve) => EVENEMENTS.find((e) => e.type === type)!.glyphe

type Glisse = { saisie: SaisieReleve; ecart: number; s: number }

const arrondir = (s: number, pas: number) => Math.round(s / pas) * pas
const sec = (s: number) => `${(Math.round(s * 10) / 10).toLocaleString('fr-FR')} s`

/**
 * Timeline d'un relevé, pour le recaler au bureau : une rangée par ligne de feux sur le temps du
 * relevé, et une rangée pour les événements sans ligne.
 * - Glisser une poignée la recale à la seconde ; elle ne se pose qu'au relâcher.
 * - Cliquer sur une rangée pose un curseur : on y ajoute un changement de couleur, un événement, la fin.
 * - Une saisie choisie se recale à l'heure exacte, change de couleur, de ligne (événement), ou s'efface.
 * - Molette ou boutons : zoom ; glisser le fond : défiler.
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

  /**
   * Saisie en cours de glisser : sa nouvelle position (s), montrée avant d'être posée au relâcher. Les
   * gestionnaires lisent la ref (le premier mouvement arrive avant le rendu qui suit l'appui) ; l'état
   * ne sert qu'à dessiner.
   */
  const [glisse, setGlisseAffiche] = useState<Glisse | null>(null)
  const glisseEnCours = useRef<Glisse | null>(null)
  const setGlisse = (g: Glisse | null) => {
    glisseEnCours.current = g
    setGlisseAffiche(g)
  }
  const [choisie, setChoisie] = useState<SaisieReleve | null>(null)
  const [curseur, setCurseur] = useState<{ s: number; rang: number } | null>(null)
  const defile = useRef<{ x: number; fenetre: [number, number]; bouge: boolean } | null>(null)

  // Temps relatif à la première saisie (s).
  const t0 = saisies[0]?.t ?? 0
  const position = (saisie: SaisieReleve) => (glisse?.saisie === saisie ? glisse.s : (saisie.t - t0) / 1000)
  const fin = finDuReleve(saisies)
  const derniere = Math.max(...saisies.map((s) => (s.t - t0) / 1000), 0)
  const duree = Math.max(FENETRE_MIN_S, derniere + 10)
  const [fenetre, setFenetre] = useState<[number, number]>(() => [0, Math.min(duree, 180)])
  const [debut, finFenetre] = fenetre
  const utile = Math.max(1, largeur - MARGE_GAUCHE)
  const x = (s: number) => MARGE_GAUCHE + ((s - debut) / (finFenetre - debut)) * utile
  const secondeA = (px: number) => debut + ((px - MARGE_GAUCHE) / utile) * (finFenetre - debut)
  /** Bout des segments de couleur : la fin du relevé, ou la dernière saisie. */
  const saisieFin = saisies.find((s) => estFin(s) && s.t === fin)
  const bout = saisieFin ? position(saisieFin) : derniere

  const rangees = [...lignes.map((l) => l.code), '']
  const hauteur = rangees.length * HAUT_LIGNE + HAUT_AXE
  const rangDe = (saisie: SaisieReleve) => {
    const r = !estFin(saisie) && saisie.ligne ? rangees.indexOf(saisie.ligne) : -1
    return r >= 0 ? r : rangees.length - 1
  }
  const pointSur = (e: { clientX: number; clientY: number }, svg: Element) => {
    const c = svg.getBoundingClientRect()
    return { s: secondeA(e.clientX - c.left), rang: Math.floor((e.clientY - c.top) / HAUT_LIGNE) }
  }

  // ── Modifications : toutes repartent triées, la saisie touchée reste choisie. ──
  const appliquer = (avant: SaisieReleve | null, apres: SaisieReleve | null) => {
    const suivantes = [...saisies.filter((s) => s !== avant), ...(apres ? [apres] : [])].sort((a, b) => a.t - b.t)
    onChanger(suivantes)
    setChoisie(apres)
  }
  /** Position d'une saisie, sans franchir les changements voisins de sa ligne. */
  const borner = (saisie: SaisieReleve, s: number) => {
    if (!estChangementCouleur(saisie)) return Math.max(0, s)
    const memes = saisies.filter((c) => estChangementCouleur(c) && c.ligne === saisie.ligne)
    const rang = memes.indexOf(saisie)
    const avant = rang > 0 ? (memes[rang - 1]!.t - t0) / 1000 : -Infinity
    const apres = rang + 1 < memes.length ? (memes[rang + 1]!.t - t0) / 1000 : Infinity
    return Math.min(apres - ECART_MIN_S, Math.max(avant + ECART_MIN_S, s))
  }
  const poserA = (saisie: SaisieReleve, s: number) => {
    const t = Math.round(t0 + borner(saisie, s) * 1000)
    if (t !== saisie.t) appliquer(saisie, { ...saisie, t })
  }
  const ajouter = (saisie: SaisieReleve) => {
    appliquer(null, saisie)
    setCurseur(null)
  }

  const zoomerAutour = (centre: number, facteur: number) => {
    const etendue = Math.min(duree, Math.max(FENETRE_MIN_S, (finFenetre - debut) * facteur))
    const nouveauDebut = Math.min(Math.max(0, centre - (centre - debut) * (etendue / (finFenetre - debut))), Math.max(0, duree - etendue))
    setFenetre([nouveauDebut, nouveauDebut + etendue])
  }
  const zoomer = (e: WheelEvent<SVGSVGElement>) => {
    e.preventDefault()
    zoomerAutour(pointSur(e, e.currentTarget).s, e.deltaY > 0 ? 1.25 : 0.8)
  }

  const clavier = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key === 'Escape') {
      setChoisie(null)
      setCurseur(null)
      return
    }
    if (!choisie) return
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      appliquer(choisie, null)
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault()
      const pas = PAS_S * (e.key === 'ArrowLeft' ? -1 : 1)
      poserA(choisie, (choisie.t - t0) / 1000 + pas)
    }
  }

  const graduation = PAS_GRADUATION.find((pas) => (pas / (finFenetre - debut)) * utile >= ECART_GRADUATION_PX) ?? PAS_GRADUATION.at(-1)!
  const graduations: number[] = []
  for (let g = Math.ceil(debut / graduation) * graduation; g <= finFenetre; g += graduation) graduations.push(g)

  const ligneCurseur = curseur ? lignes[curseur.rang] : undefined

  return (
    <Stack gap="2">
      <HStack gap="1.5">
        <Button size="2xs" variant="outline" aria-label="Zoomer" onClick={() => zoomerAutour((debut + finFenetre) / 2, 0.6)}>
          +
        </Button>
        <Button size="2xs" variant="outline" aria-label="Dézoomer" onClick={() => zoomerAutour((debut + finFenetre) / 2, 1.6)}>
          −
        </Button>
        <Button size="2xs" variant="ghost" onClick={() => setFenetre([0, duree])}>
          Tout le relevé
        </Button>
        <Text ms="auto" textStyle="xs" color="fg.muted">
          {Math.round(debut)}–{Math.round(finFenetre)} s sur {Math.round(duree)} s
        </Text>
      </HStack>

      <Box ref={cadre} borderWidth="1px" borderColor="border.subtle" borderRadius="l2" overflow="hidden" bg="bg.subtle">
        <svg
          width={largeur}
          height={hauteur}
          tabIndex={0}
          role="application"
          aria-label="Timeline du relevé"
          style={{ display: 'block', touchAction: 'none', userSelect: 'none', outline: 'none', cursor: 'crosshair' }}
          onWheel={zoomer}
          onKeyDown={clavier}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId)
            defile.current = { x: e.clientX, fenetre, bouge: false }
          }}
          onPointerMove={(e) => {
            const d = defile.current
            if (!d) return
            if (!d.bouge && Math.abs(e.clientX - d.x) < SEUIL_GLISSER_PX) return
            d.bouge = true
            const etendue = d.fenetre[1] - d.fenetre[0]
            const decalage = ((d.x - e.clientX) / utile) * etendue
            const nouveauDebut = Math.min(Math.max(0, d.fenetre[0] + decalage), Math.max(0, duree - etendue))
            setFenetre([nouveauDebut, nouveauDebut + etendue])
          }}
          onPointerUp={(e) => {
            const d = defile.current
            defile.current = null
            // Un appui sans défilement : le curseur, là où l'on a cliqué.
            if (d && !d.bouge) {
              const p = pointSur(e, e.currentTarget)
              if (p.rang >= 0 && p.rang < rangees.length) {
                setCurseur({ s: arrondir(Math.max(0, p.s), PAS_S), rang: p.rang })
                setChoisie(null)
              }
            }
          }}
        >
          {/* Rangées : code de la ligne, segments de couleur entre ses changements. */}
          {rangees.map((code, rang) => {
            const y = rang * HAUT_LIGNE
            const changements = saisies
              .filter((s): s is Extract<SaisieReleve, { couleur: CouleurReleve }> => estChangementCouleur(s) && s.ligne === code)
              .sort((a, b) => position(a) - position(b))
            return (
              <g key={code || 'evenements'}>
                <rect
                  x={0}
                  y={y}
                  width={largeur}
                  height={HAUT_LIGNE}
                  fill={curseur?.rang === rang ? 'var(--chakra-colors-brand-subtle)' : rang % 2 ? 'transparent' : 'var(--chakra-colors-bg-muted)'}
                />
                <text x={8} y={y + HAUT_LIGNE / 2} dominantBaseline="central" fontSize={11} fontWeight={700} fill="var(--chakra-colors-fg)">
                  {code || 'Év.'}
                </text>
                {changements.map((c, i) => {
                  const a = position(c)
                  const b = i + 1 < changements.length ? position(changements[i + 1]!) : bout
                  if (b <= a || b < debut || a > finFenetre) return null
                  const gauche = Math.max(MARGE_GAUCHE, x(a))
                  return (
                    <rect
                      key={i}
                      x={gauche}
                      y={y + 6}
                      width={Math.max(0, Math.min(x(b), largeur) - gauche)}
                      height={HAUT_LIGNE - 12}
                      fill={COULEUR[c.couleur]}
                      opacity={0.85}
                      pointerEvents="none"
                    />
                  )
                })}
              </g>
            )
          })}

          {/* Curseur posé d'un clic. */}
          {curseur && curseur.s >= debut && curseur.s <= finFenetre && (
            <line
              x1={x(curseur.s)}
              x2={x(curseur.s)}
              y1={0}
              y2={rangees.length * HAUT_LIGNE}
              stroke="var(--chakra-colors-brand-solid)"
              strokeDasharray="3 3"
              pointerEvents="none"
            />
          )}

          {/* Poignées : changements, événements, fin. Le glisser ne se pose qu'au relâcher. */}
          {saisies.map((saisie, index) => {
            const s = position(saisie)
            if (s < debut || s > finFenetre) return null
            const px = x(s)
            const actif = saisie === choisie
            const y = rangDe(saisie) * HAUT_LIGNE
            const prise = {
              style: { cursor: 'ew-resize' },
              onPointerDown: (e: PointerEvent<SVGGElement>) => {
                e.stopPropagation()
                e.currentTarget.setPointerCapture(e.pointerId)
                setGlisse({ saisie, ecart: pointSur(e, e.currentTarget.ownerSVGElement!).s - s, s })
                setChoisie(saisie)
                setCurseur(null)
              },
              onPointerMove: (e: PointerEvent<SVGGElement>) => {
                const g = glisseEnCours.current
                if (!g || g.saisie !== saisie) return
                const voulu = arrondir(pointSur(e, e.currentTarget.ownerSVGElement!).s - g.ecart, PAS_S)
                setGlisse({ ...g, s: borner(saisie, voulu) })
              },
              onPointerUp: (e: PointerEvent<SVGGElement>) => {
                e.stopPropagation()
                const g = glisseEnCours.current
                if (g && g.saisie === saisie) poserA(saisie, g.s)
                setGlisse(null)
              },
            }
            if (estFin(saisie)) {
              return (
                <g key={index} {...prise}>
                  <rect x={px - 5} y={0} width={10} height={rangees.length * HAUT_LIGNE} fill="transparent" />
                  <line
                    x1={px}
                    x2={px}
                    y1={0}
                    y2={rangees.length * HAUT_LIGNE}
                    stroke={actif ? 'var(--chakra-colors-brand-solid)' : 'var(--chakra-colors-fg)'}
                    strokeWidth={2}
                    strokeDasharray="5 3"
                  />
                  <text x={px + 4} y={10} fontSize={10} fontWeight={700} fill="var(--chakra-colors-fg)">
                    fin
                  </text>
                </g>
              )
            }
            if (estChangementCouleur(saisie)) {
              return (
                <g key={index} {...prise}>
                  <rect x={px - 5} y={y} width={10} height={HAUT_LIGNE} fill="transparent" />
                  <rect
                    x={px - 2.5}
                    y={y + 2}
                    width={5}
                    height={HAUT_LIGNE - 4}
                    rx={2}
                    fill={actif ? 'var(--chakra-colors-brand-solid)' : 'var(--chakra-colors-fg)'}
                    stroke="var(--chakra-colors-bg)"
                  >
                    <title>
                      {saisie.ligne} au {saisie.couleur} à {sec(s)}
                    </title>
                  </rect>
                </g>
              )
            }
            return (
              <g key={index} {...prise}>
                <circle
                  cx={px}
                  cy={y + HAUT_LIGNE / 2}
                  r={10}
                  fill={actif ? 'var(--chakra-colors-brand-subtle)' : 'transparent'}
                  stroke={actif ? 'var(--chakra-colors-brand-solid)' : 'none'}
                />
                <text x={px} y={y + HAUT_LIGNE / 2} textAnchor="middle" dominantBaseline="central" fontSize={14}>
                  {glyphe(saisie.evenement)}
                  <title>
                    {saisie.evenement}
                    {saisie.ligne ? ` (${saisie.ligne})` : ''} à {sec(s)}
                  </title>
                </text>
              </g>
            )
          })}

          {/* Axe du temps, en secondes depuis la première saisie. */}
          <g transform={`translate(0, ${rangees.length * HAUT_LIGNE})`} pointerEvents="none">
            {graduations.map((g) => (
              <g key={g}>
                <line x1={x(g)} x2={x(g)} y1={0} y2={4} stroke="var(--chakra-colors-fg-muted)" />
                <text x={x(g)} y={14} textAnchor="middle" fontSize={10} fill="var(--chakra-colors-fg-muted)">
                  {g} s
                </text>
              </g>
            ))}
          </g>
        </svg>
      </Box>

      {/* Ce qu'on peut faire de la saisie choisie, ou au curseur. */}
      <HStack gap="2" wrap="wrap" minH="8">
        {choisie ? (
          <>
            <Valeur textStyle="xs">
              {estChangementCouleur(choisie)
                ? `${choisie.ligne} au ${choisie.couleur}`
                : estEvenement(choisie)
                  ? `${EVENEMENTS.find((e) => e.type === choisie.evenement)!.libelle}${choisie.ligne ? ` (${choisie.ligne})` : ''}`
                  : 'Fin du relevé'}
            </Valeur>
            <HStack gap="1">
              <Aide>à</Aide>
              <Input
                // La clé recrée le champ quand la saisie bouge, pour qu'il en reprenne l'heure.
                key={choisie.t}
                size="2xs"
                w="20"
                type="number"
                step={PAS_S}
                aria-label="Heure de la saisie, en secondes depuis le début du relevé"
                defaultValue={Math.round((choisie.t - t0) / 1000)}
                onBlur={(e) => e.target.value !== '' && poserA(choisie, Math.round(Number(e.target.value)))}
                onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              />
              <Aide>s</Aide>
            </HStack>
            {estChangementCouleur(choisie) &&
              COULEURS.filter((c) => c !== 'jaune' || !lignes.find((l) => l.code === choisie.ligne)?.pieton).map((c) => (
                <Button key={c} size="2xs" variant={choisie.couleur === c ? 'solid' : 'outline'} onClick={() => appliquer(choisie, { ...choisie, couleur: c })}>
                  {c}
                </Button>
              ))}
            {estEvenement(choisie) && (
              <>
                <Aide>ligne</Aide>
                {[...lignes.map((l) => l.code), null].map((code) => (
                  <Button
                    key={code ?? 'aucune'}
                    size="2xs"
                    variant={(choisie.ligne ?? null) === code ? 'solid' : 'outline'}
                    onClick={() => {
                      const { ligne: _ancienne, ...sansLigne } = choisie
                      appliquer(choisie, code ? { ...sansLigne, ligne: code } : sansLigne)
                    }}
                  >
                    {code ?? 'aucune'}
                  </Button>
                ))}
              </>
            )}
            <Button size="2xs" variant="ghost" colorPalette="red" onClick={() => appliquer(choisie, null)}>
              Supprimer
            </Button>
          </>
        ) : curseur ? (
          <>
            <Valeur textStyle="xs">
              À {sec(curseur.s)}
              {ligneCurseur ? ` sur ${ligneCurseur.code}` : ''} :
            </Valeur>
            {ligneCurseur &&
              COULEURS.filter((c) => c !== 'jaune' || !ligneCurseur.pieton).map((c) => (
                <Button
                  key={c}
                  size="2xs"
                  variant="outline"
                  borderColor={COULEUR[c]}
                  onClick={() => ajouter({ t: Math.round(t0 + curseur.s * 1000), ligne: ligneCurseur.code, couleur: c })}
                >
                  + {c}
                </Button>
              ))}
            {EVENEMENTS.map((e) => (
              <Button
                key={e.type}
                size="2xs"
                variant="outline"
                title={`Ajouter : ${e.libelle}${ligneCurseur ? ` pour ${ligneCurseur.code}` : ''}`}
                onClick={() =>
                  ajouter({ t: Math.round(t0 + curseur.s * 1000), evenement: e.type, ...(ligneCurseur ? { ligne: ligneCurseur.code } : {}) })
                }
              >
                + {e.glyphe}
              </Button>
            ))}
            <Button
              size="2xs"
              variant="outline"
              onClick={() => {
                // Une seule fin : la nouvelle remplace l'ancienne.
                const t = Math.round(t0 + curseur.s * 1000)
                onChanger([...saisies.filter((s) => !estFin(s)), { t, fin: true as const }].sort((a, b) => a.t - b.t))
                setCurseur(null)
              }}
            >
              {fin === null ? '+ fin ici' : 'fin ici'}
            </Button>
            <Button size="2xs" variant="ghost" onClick={() => setCurseur(null)}>
              Fermer
            </Button>
          </>
        ) : (
          <Aide>
            Cliquer sur une rangée : ajouter un vert, un jaune, un rouge, un événement ou la fin à cet instant · glisser une poignée : la recaler à la
            seconde · cliquer une poignée : son heure exacte, sa couleur ou sa ligne · molette ou + / − : zoom · glisser le fond : défiler.
          </Aide>
        )}
      </HStack>
    </Stack>
  )
}
