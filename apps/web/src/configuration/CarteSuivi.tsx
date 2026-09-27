import { Badge, Button, HStack, IconButton, Stack, Text, type StackProps } from '@chakra-ui/react'
import type { AnalyseIa } from '@voirie/schema'
import { Aide, LibelleSection } from '../ds'
import { abandonnerBrouillons, libelleBrouillons, type BrouillonsCarrefour } from './brouillons'
import { FileIa } from './FileIa'

interface Props extends StackProps {
  brouillons: ReadonlyMap<string, BrouillonsCarrefour>
  /** Carrefour en cours de configuration : il est déjà ouvert. */
  ouvert: string | null
  onReprendre: (brouillons: BrouillonsCarrefour) => void
  analyses: AnalyseIa[]
  onOuvrirAnalyse: (analyse: AnalyseIa) => void
}

/**
 * Travail en attente, posé en bas à droite de la carte : carrefours aux modifications non
 * enregistrées, puis file des propositions OSM + IA. Rien à suivre : la carte disparaît.
 */
export function CarteSuivi({ brouillons, ouvert, onReprendre, analyses, onOuvrirAnalyse, ...props }: Props) {
  if (brouillons.size === 0 && analyses.length === 0) return null
  const abandonner = (b: BrouillonsCarrefour) => {
    if (window.confirm(`Abandonner les modifications de « ${b.carrefour.nom} » (${libelleBrouillons(b)}) ?`)) {
      abandonnerBrouillons(b.carrefour.id)
    }
  }

  return (
    <Stack
      gap="3"
      w="300px"
      maxW="calc(100vw - 24px)"
      maxH="40vh"
      overflowY="auto"
      p="12px 14px"
      bg="bg.panel"
      borderRadius="l3"
      boxShadow="carte"
      aria-label="Suivi"
      {...props}
    >
      {brouillons.size > 0 && (
        <Stack gap="1.5">
          <LibelleSection>Non enregistré · {brouillons.size}</LibelleSection>
          {[...brouillons.values()].map((b) => (
            <HStack key={b.carrefour.id} gap="2" justify="space-between">
              <Stack gap="0" minW="0" flex="1">
                <Text textStyle="xs" truncate title={b.carrefour.nom}>
                  {b.carrefour.nom}
                </Text>
                <Aide truncate>{libelleBrouillons(b)}</Aide>
              </Stack>
              {b.carrefour.id === ouvert ? (
                <Badge colorPalette="brand">ouvert</Badge>
              ) : (
                <Button size="xs" variant="outline" onClick={() => onReprendre(b)}>
                  Reprendre
                </Button>
              )}
              <IconButton
                size="xs"
                variant="ghost"
                aria-label="Abandonner les modifications"
                title="Abandonner les modifications"
                onClick={() => abandonner(b)}
              >
                ×
              </IconButton>
            </HStack>
          ))}
        </Stack>
      )}
      {analyses.length > 0 && (
        <Stack gap="1.5" pt={brouillons.size > 0 ? '3' : undefined} borderTopWidth={brouillons.size > 0 ? '1px' : undefined} borderColor="border.muted">
          <FileIa analyses={analyses} onOuvrir={onOuvrirAnalyse} />
        </Stack>
      )}
    </Stack>
  )
}
