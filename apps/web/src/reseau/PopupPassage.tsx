/**
 * Popup d'un passage piéton tracé librement (docs/pipeline-donnees.md, étape 11) : son type, les
 * tronçons qu'il traverse et les feux piétons qui le commandent, à cocher parmi ceux d'à côté.
 * Dans un carrefour, il fait la traversée de la branche dont il coupe un tronçon ; une ligne de
 * feux piétonne qui traverse cette branche reçoit ses feux.
 */
import { Button, HStack, Stack, Text } from '@chakra-ui/react'
import { repereLocal, type LonLat, type XY } from '@voirie/engine'
import type { FeuxGeoJson, ModificationPassage, TraverseePieton } from '@voirie/schema'
import type { Passage, Troncon } from '../api'
import { Aide, BarreOutils, Case, Message, PopupCarte, Section, Segments } from '../ds'
import { PASSAGES } from './reglages'

/** Rayons (m) où chercher les tronçons et les feux à relier, autour du milieu du passage. */
const RAYON_TRONCONS_M = 25
const RAYON_FEUX_M = 40

type Feu = FeuxGeoJson['features'][number]

interface Props {
  passage: Passage
  /** Tronçons de la vue (les plus proches sont proposés). */
  troncons: readonly Troncon[]
  /** Feux de la vue (les plus proches sont proposés). */
  feux: readonly Feu[]
  enregistrement: { enCours: boolean; erreur: string | null }
  onModifier: (modification: ModificationPassage) => void
  onSupprimer: () => void
  onFermer: () => void
}

/** Distance (m) d'un point à une polyligne, dans un repère local. */
function distance(p: XY, ligne: readonly XY[]): number {
  let min = Infinity
  for (let i = 0; i < ligne.length - 1; i++) {
    const [a, b] = [ligne[i]!, ligne[i + 1]!]
    const [dx, dy] = [b[0] - a[0], b[1] - a[1]]
    const l2 = dx * dx + dy * dy
    const t = l2 > 0 ? Math.min(Math.max(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2, 0), 1) : 0
    min = Math.min(min, Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy))
  }
  return min
}

export function PopupPassage({ passage, troncons, feux, enregistrement, onModifier, onSupprimer, onFermer }: Props) {
  const p = passage.properties
  const [a, b] = passage.geometry.coordinates as [LonLat, LonLat]
  const milieu: LonLat = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
  const repere = repereLocal(milieu)
  const passageXY = [a, b].map(repere.versXY)
  const longueur = Math.hypot(passageXY[1]![0] - passageXY[0]![0], passageXY[1]![1] - passageXY[0]![1])

  // Proposés : ceux déjà reliés, puis les plus proches.
  const tronconsProches = troncons
    .map((t) => ({ t, d: Math.min(...passageXY.map((q) => distance(q, t.geometry.coordinates.map(repere.versXY))), distance([0, 0], t.geometry.coordinates.map(repere.versXY))) }))
    .filter(({ t, d }) => p.troncons.includes(t.id) || d <= RAYON_TRONCONS_M)
    .sort((x, y) => x.d - y.d)
    .slice(0, 8)
  const feuxProches = feux
    .map((f) => ({ f, d: Math.hypot(...repere.versXY(f.geometry.coordinates as LonLat)) }))
    .filter(({ f, d }) => p.feux.includes(f.properties.id) || d <= RAYON_FEUX_M)
    .sort((x, y) => Number(y.f.properties.type === 'pieton') - Number(x.f.properties.type === 'pieton') || x.d - y.d)
    .slice(0, 10)
  const basculer = (liste: readonly string[], id: string, coche: boolean) => (coche ? [...liste, id] : liste.filter((x) => x !== id))

  return (
    <PopupCarte
      titre="Passage piéton"
      soustitre={`Tracé librement · ${Math.round(longueur)} m`}
      onFermer={onFermer}
      pied={
        <>
          <Button variant="plain" colorPalette="red" px="2" title="Suppr" onClick={onSupprimer}>
            Supprimer
          </Button>
          <BarreOutils.Espace />
        </>
      }
    >
      <Section libelle="Type">
        <Segments
          fitted
          size="xs"
          aria-label="Type de passage piéton"
          valeur={p.type}
          onChange={(type: TraverseePieton) => type !== p.type && onModifier({ type })}
          options={PASSAGES}
        />
      </Section>
      <Section libelle="Tronçons traversés">
        {tronconsProches.length === 0 ? (
          <Aide>Aucune rue à moins de {RAYON_TRONCONS_M} m.</Aide>
        ) : (
          <Stack gap="1">
            {tronconsProches.map(({ t, d }) => (
              <Case key={t.id} coche={p.troncons.includes(t.id)} onChange={(coche) => onModifier({ troncons: basculer(p.troncons, t.id, coche) })}>
                <HStack as="span" gap="1.5">
                  <Text as="span">{t.properties.nom ?? 'Rue sans nom'}</Text>
                  <Text as="span" color="fg.muted" textStyle="xs">
                    {Math.round(d)} m
                  </Text>
                </HStack>
              </Case>
            ))}
          </Stack>
        )}
        <Aide>Dans un carrefour, le passage fait la traversée de la branche dont il coupe un tronçon.</Aide>
      </Section>
      <Section libelle="Feux reliés">
        {feuxProches.length === 0 ? (
          <Aide>Aucun feu à moins de {RAYON_FEUX_M} m.</Aide>
        ) : (
          <Stack gap="1">
            {feuxProches.map(({ f, d }) => (
              <Case key={f.properties.id} coche={p.feux.includes(f.properties.id)} onChange={(coche) => onModifier({ feux: basculer(p.feux, f.properties.id, coche) })}>
                <HStack as="span" gap="1.5">
                  <Text as="span">Feu {f.properties.type === 'pieton' ? 'piéton' : 'véhicule'}</Text>
                  <Text as="span" color="fg.muted" textStyle="xs">
                    {Math.round(d)} m{f.properties.osm_id ? ` · OSM ${f.properties.osm_id}` : ''}
                  </Text>
                </HStack>
              </Case>
            ))}
          </Stack>
        )}
        <Aide>Une ligne de feux piétonne qui traverse cette branche reçoit ces feux.</Aide>
      </Section>
      {enregistrement.erreur && <Message ton="erreur">{enregistrement.erreur}</Message>}
    </PopupCarte>
  )
}
