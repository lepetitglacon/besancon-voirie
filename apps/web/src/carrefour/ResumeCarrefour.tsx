import { Button, HStack, Text, type StackProps } from '@chakra-ui/react'
import type { CarrefourResume } from '@voirie/schema'
import { BarreOutils, Pastille } from '../ds'
import { STATUTS } from './libelles'

interface Props extends StackProps {
  carrefour: CarrefourResume
  /** Revient au choix des feux du carrefour (ajout, retrait). */
  onModifierFeux: () => void
  onSupprimer: () => void
}

/** Mini fiche du carrefour ouvert : statut, nombre de feux, et les actions sur le carrefour lui-même. */
export function ResumeCarrefour({ carrefour, onModifierFeux, onSupprimer, ...props }: Props) {
  return (
    <HStack gap="1.5" {...props}>
      <Pastille couleur={`statut.${carrefour.statut}`} />
      <Text textStyle="xs" color="fg.secondary" truncate title={`Programmation ${STATUTS[carrefour.statut]}`}>
        {carrefour.nb_feux} feu{carrefour.nb_feux > 1 ? 'x' : ''} · {STATUTS[carrefour.statut]}
      </Text>
      <BarreOutils.Espace />
      <Button size="2xs" variant="ghost" onClick={onModifierFeux} title="Ajouter ou retirer des feux du carrefour">
        Feux
      </Button>
      <Button size="2xs" variant="ghost" colorPalette="red" onClick={onSupprimer}>
        Supprimer
      </Button>
    </HStack>
  )
}
