/**
 * Réglages de l'outil Placer (docs/voies-position-visuelle.md) : place des bouts de voies
 * choisis, en mètres le long de la voie et de côté, et rotation de leur bloc. Une valeur saisie
 * s'applique à tous les bouts choisis. Seul le dessin la suit, pas le graphe ni SUMO.
 */
import { Button, HStack, Stack, Text } from '@chakra-ui/react'
import { lireClePlacement, LONGUEUR_BLOC_PLACE_M, type PlacementVoie } from '@voirie/engine'
import { Aide, Compteur, Section } from '../ds'
import type { ChangementPlacement } from './modeReseau'

interface Props {
  /** Bouts choisis et leur place enregistrée (null : automatique). */
  voies: readonly ChangementPlacement[]
  onPlacer: (changements: ChangementPlacement[]) => void
}

const PAS_M = 0.25
const PAS_DEGRES = 0.5
const arrondi = (v: number, pas = 100) => Math.round(v * pas) / pas || 0
const VIDE: PlacementVoie = { recul: 0, decalage: 0 }

/** Rotation du bloc (°, positive : son bout éloigné va à droite de la circulation). */
const rotation = (p: PlacementVoie) => arrondi((Math.atan2((p.decalage_loin ?? p.decalage) - p.decalage, LONGUEUR_BLOC_PLACE_M) * 180) / Math.PI, 10)

/** Placement sans pivot quand le bloc ne tourne pas, null quand il est à sa place automatique. */
function normaliser(p: PlacementVoie): PlacementVoie | null {
  const { recul, decalage } = p
  const loin = p.decalage_loin === undefined ? decalage : arrondi(p.decalage_loin)
  if (recul === 0 && decalage === 0 && loin === 0) return null
  return loin === decalage ? { recul, decalage } : { recul, decalage, decalage_loin: loin }
}

export function ReglagesPlacement({ voies, onPlacer }: Props) {
  if (voies.length === 0) {
    return (
      <Aide>
        Un clic sur le bout d’une voie le choisit (<kbd>Maj</kbd> + clic : plusieurs), pour régler sa place au centimètre près et
        faire pivoter son bloc ; un double-clic le remet à sa place automatique.
      </Aide>
    )
  }
  const premiere = voies[0]!
  const actuel = premiere.placement ?? VIDE
  const appliquer = (changer: (p: PlacementVoie) => PlacementVoie) =>
    onPlacer(voies.map((v) => ({ noeud: v.noeud, cle: v.cle, placement: normaliser(changer(v.placement ?? VIDE)) })))
  const cle = lireClePlacement(premiere.cle)
  const libelle =
    voies.length > 1
      ? `Réglages · ${voies.length} bouts de voies`
      : `Réglages · bout de la voie ${cle ? `${cle.rang + 1}, ${cle.sens === 'avant' ? 'sens du tracé' : 'sens inverse'}` : ''}`
  return (
    <Section libelle={libelle}>
      <Stack gap="1.5">
        <HStack justify="space-between">
          <Text textStyle="sm" title="Le long de la voie : positif, elle s’arrête plus tôt ; négatif, elle s’allonge">
            Recul
          </Text>
          <Compteur
            taille="xs"
            aria-label="Recul du bout de la voie"
            valeur={actuel.recul}
            min={-30}
            max={60}
            pas={PAS_M}
            unite="m"
            onChange={(v) => appliquer((p) => ({ ...p, recul: arrondi(v ?? 0) }))}
          />
        </HStack>
        <HStack justify="space-between">
          <Text textStyle="sm" title="De côté : positif à droite du sens de circulation ; le bloc garde sa rotation">
            Décalage
          </Text>
          <Compteur
            taille="xs"
            aria-label="Décalage du bout de la voie"
            valeur={actuel.decalage}
            min={-15}
            max={15}
            pas={PAS_M}
            unite="m"
            onChange={(v) =>
              appliquer((p) => {
                const decalage = arrondi(v ?? 0)
                const pivot = (p.decalage_loin ?? p.decalage) - p.decalage
                return { ...p, decalage, decalage_loin: decalage + pivot }
              })
            }
          />
        </HStack>
        <HStack justify="space-between">
          <Text textStyle="sm" title="Rotation du bloc de 40 m autour de son bout : positive, son autre bout va à droite de la circulation">
            Rotation
          </Text>
          <Compteur
            taille="xs"
            aria-label="Rotation du bloc de la voie"
            valeur={rotation(actuel)}
            min={-30}
            max={30}
            pas={PAS_DEGRES}
            unite="°"
            onChange={(v) =>
              appliquer((p) => ({ ...p, decalage_loin: p.decalage + LONGUEUR_BLOC_PLACE_M * Math.tan(((v ?? 0) * Math.PI) / 180) }))
            }
          />
        </HStack>
      </Stack>
      <HStack justify="space-between">
        <Text textStyle="xs" color="fg.muted">
          {voies.some((v) => v.placement) ? 'Placé à la main' : 'Place automatique'}
        </Text>
        <Button size="xs" variant="outline" disabled={!voies.some((v) => v.placement)} onClick={() => appliquer(() => VIDE)}>
          Auto
        </Button>
      </HStack>
    </Section>
  )
}
