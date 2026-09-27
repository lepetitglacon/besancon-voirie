import { Badge, Button, HStack, IconButton, Stack, Text } from '@chakra-ui/react'
import type { CarrefourResume } from '@voirie/schema'
import { libelleBrouillons, type BrouillonsCarrefour } from '../configuration/brouillons'
import { BarreOutils, CarteEnTete, Message, Pastille } from '../ds'

const NATURES: Record<CarrefourResume['nature'], string> = {
  carrefour: 'Carrefour à feux',
  traversee_pietonne: 'Traversée piétonne à feux',
}

const STATUTS: Record<CarrefourResume['statut'], string> = {
  a_confirmer: 'à confirmer',
  non_releve: 'non relevée',
  estime: 'estimée',
  mesure: 'mesurée',
  verifie: 'vérifiée',
}

interface Props {
  carrefour: CarrefourResume
  /** Modifications non enregistrées de ce carrefour, s'il en a. */
  brouillons: BrouillonsCarrefour | undefined
  onConfigurer: () => void
  onModifierFeux: () => void
  onSupprimer: () => void
  onFermer: () => void
}

/** Carrefour sélectionné sur la carte, dans la carte d'en-tête : un clic sur un autre carrefour le remplace. */
export function FicheCarrefour({ carrefour, brouillons, onConfigurer, onModifierFeux, onSupprimer, onFermer }: Props) {
  return (
    <CarteEnTete
      position="fixed"
      top="3"
      left="3"
      zIndex="2"
      w="340px"
      maxW="calc(100vw - 24px)"
      pe="10"
      surtitre={`Besançon Voirie · ${NATURES[carrefour.nature].toLowerCase()}`}
      titre={carrefour.nom}
      badges={
        carrefour.pres_tram && <Badge colorPalette="orange">Tram à proximité (priorité probable)</Badge>
      }
    >
      <IconButton
        position="absolute"
        top="2"
        right="2"
        variant="ghost"
        size="xs"
        aria-label="Désélectionner le carrefour"
        title="Désélectionner (Échap)"
        onClick={onFermer}
      >
        ×
      </IconButton>
      <Stack gap="2.5" mt="2">
        <Text textStyle="sm" display="flex" alignItems="center" gap="2">
          <Pastille couleur={`statut.${carrefour.statut}`} />
          {carrefour.nb_feux} feu(x) · programmation {STATUTS[carrefour.statut]}
        </Text>
        {brouillons && <Message ton="avertissement">Modifications non enregistrées : {libelleBrouillons(brouillons)}</Message>}
        <HStack gap="2" pt="2.5" borderTopWidth="1px" borderColor="border.muted">
          <Button variant="plain" colorPalette="red" size="sm" px="2" onClick={onSupprimer}>
            Supprimer
          </Button>
          <BarreOutils.Espace />
          <Button size="sm" onClick={onModifierFeux}>
            Feux
          </Button>
          <Button variant="solid" size="sm" onClick={onConfigurer} title="Configurer (Entrée)">
            {brouillons ? 'Reprendre' : 'Configurer'}
          </Button>
        </HStack>
      </Stack>
    </CarteEnTete>
  )
}
