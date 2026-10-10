import { Box, Button, HStack, Stack, Text, type BoxProps } from '@chakra-ui/react'
import type { LonLat } from '@voirie/engine'
import { Aide, CarteEnTete } from '../ds'
import { distancesMesure, formaterDistance } from './mesure'
import type { MesureEnregistree, Mesures } from './useMesures'

interface Props extends BoxProps {
  mesures: Mesures
  /** Cadre la carte sur ces points, à côté du panneau qui sera ouvert. */
  onCentrer: (points: LonLat[], panneau: 'liste' | 'edition') => void
}

/**
 * Panneau latéral des mesures enregistrées : toutes sont tracées sur la carte en lecture seule ;
 * « Éditer » n'ouvre que celle-là, centrée, dans la frise du bas.
 */
export function ListeMesures({ mesures, onCentrer, ...props }: Props) {
  if (!mesures.liste) return null
  const triees = [...mesures.enregistrees].sort((a, b) => b.modifieeLe.localeCompare(a.modifieeLe))
  const editer = (mesure: MesureEnregistree) => {
    mesures.editer(mesure)
    onCentrer(mesure.points, 'edition')
  }
  return (
    <Box {...props}>
      <CarteEnTete
        w="320px"
        maxW="calc(100vw - 24px)"
        maxH="calc(100vh - 24px)"
        surtitre="Mesures de distance"
        titre={
          <HStack gap="1.5">
            <Text>
              {triees.length} mesure{triees.length > 1 ? 's' : ''} enregistrée{triees.length > 1 ? 's' : ''}
            </Text>
            <Button size="2xs" variant="ghost" ms="auto" onClick={mesures.fermerListe}>
              Fermer
            </Button>
          </HStack>
        }
      >
        <HStack gap="1.5" mt="2">
          <Button size="xs" variant="solid" onClick={() => mesures.commencer()}>
            + Nouvelle mesure
          </Button>
          {triees.length > 1 && (
            <Button size="xs" variant="ghost" onClick={() => onCentrer(triees.flatMap((m) => m.points), 'liste')}>
              Tout voir
            </Button>
          )}
        </HStack>
        {triees.length === 0 ? (
          <Aide mt="3">
            Aucune mesure enregistrée. Créez-en une, ou faites un clic droit sur la carte : « Mesurer une distance ». Les
            mesures sont gardées dans ce navigateur.
          </Aide>
        ) : (
          <Stack gap="0" mt="2" minH="0" overflowY="auto" mx="-14px" px="14px">
            {triees.map((mesure) => (
              <HStack
                key={mesure.id}
                gap="2"
                py="2"
                borderTopWidth="1px"
                borderColor="border.muted"
                cursor="pointer"
                bg={mesures.survolee === mesure.id ? 'bg.muted' : undefined}
                mx="-14px"
                px="14px"
                title="Centrer la carte sur cette mesure"
                onMouseEnter={() => mesures.setSurvolee(mesure.id)}
                onMouseLeave={() => mesures.setSurvolee(null)}
                onClick={() => onCentrer(mesure.points, 'liste')}
              >
                <Stack gap="0" flex="1" minW="0">
                  <Text textStyle="sm" fontWeight="medium" truncate>
                    {mesure.nom}
                  </Text>
                  <Text textStyle="xs" color="fg.muted" fontVariantNumeric="tabular-nums">
                    {formaterDistance(distancesMesure(mesure.points).total)} · {mesure.points.length} points ·{' '}
                    {new Date(mesure.modifieeLe).toLocaleDateString('fr-FR')}
                  </Text>
                </Stack>
                <Button size="2xs" variant="outline" onClick={(e) => (e.stopPropagation(), editer(mesure))}>
                  Éditer
                </Button>
                <Button
                  size="2xs"
                  variant="ghost"
                  color="fg.error"
                  aria-label={`Supprimer ${mesure.nom}`}
                  title="Supprimer"
                  onClick={(e) => (e.stopPropagation(), mesures.supprimer(mesure))}
                >
                  ✕
                </Button>
              </HStack>
            ))}
          </Stack>
        )}
      </CarteEnTete>
    </Box>
  )
}
