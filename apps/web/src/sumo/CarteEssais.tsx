import type { EssaiSumoResume } from '@voirie/schema'
import { Badge, Box, Button, HStack, Stack, Text, type BoxProps } from '@chakra-ui/react'
import type { ReactNode } from 'react'
import { Aide, CarteEnTete, Message } from '../ds'
import { heure } from './indicateurs'

interface Props extends BoxProps {
  essais: EssaiSumoResume[] | undefined
  erreur: Error | null
  choisi: string | null
  onChoisir: (id: string) => void
  /** Nouvel essai ; depuis un essai lancé de l'app, avec ses réglages. */
  onNouvel: (depuis: string | null) => void
  /** Lancement en cours ou dernier lancement, au-dessus de la liste. */
  suivi?: ReactNode
  /** Remplace la liste (formulaire de lancement). */
  formulaire?: ReactNode
}

const nombre = (n: number) => n.toLocaleString('fr-FR')
const minutes = (secondes: number) => `${Math.round(secondes / 60)} min`

/** Carte de gauche du mode SUMO : les essais archivés, du plus récent au plus ancien. */
export function CarteEssais({ essais, erreur, choisi, onChoisir, onNouvel, suivi, formulaire, ...props }: Props) {
  return (
    <CarteEnTete
      redimensionnable="sumo"
      surtitre="Simulation SUMO"
      titre={formulaire ? 'Nouvel essai' : 'Essais'}
      badges={
        !formulaire && (
          <>
            {essais && <Badge colorPalette="gray">{essais.length} essai(s)</Badge>}
            <Button size="2xs" ms="auto" onClick={() => onNouvel(null)}>
              Nouvel essai
            </Button>
          </>
        )
      }
      {...props}
    >
      {formulaire ? (
        <Box mt="3" minH="0" display="flex" flexDirection="column">
          {formulaire}
        </Box>
      ) : (
      <Stack gap="1.5" mt="3" minH="0">
      {suivi}
      <Stack as="ul" gap="1.5" listStyleType="none" overflowY="auto" minH="0">
        {erreur && <Message ton="erreur">{erreur.message}</Message>}
        {essais?.length === 0 && (
          <Aide>
            Aucun essai : lancer <code>./simuler.sh</code> dans <code>data/sumo/ville</code>, qui archive la journée
            simulée.
          </Aide>
        )}
        {essais?.map((essai) => {
          const actif = essai.id === choisi
          const { bilan } = essai
          return (
            <Box as="li" key={essai.id}>
              <Box
                as="button"
                w="full"
                textAlign="start"
                p="2.5"
                borderRadius="l2"
                borderWidth="1px"
                borderColor={actif ? 'brand.solid' : 'border.muted'}
                bg={actif ? 'color-mix(in srgb, var(--chakra-colors-brand-solid) 8%, transparent)' : 'transparent'}
                _hover={{ bg: actif ? undefined : 'bg.muted' }}
                aria-pressed={actif}
                onClick={() => onChoisir(essai.id)}
              >
                <Text textStyle="sm" fontWeight="semibold">
                  {essai.nom}
                </Text>
                <Aide>
                  {new Date(essai.cree).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })} ·{' '}
                  {heure(essai.debut)} – {heure(bilan.raisonFin ? bilan.finSimulee : essai.fin)} · calcul{' '}
                  {minutes(bilan.dureeCalcul)}
                </Aide>
                <HStack gap="1" mt="1.5" wrap="wrap">
                  <Badge size="xs" colorPalette="gray">
                    {nombre(bilan.inseres)} voitures
                  </Badge>
                  <Badge size="xs" colorPalette="gray">
                    {minutes(bilan.perteMoyenne)} perdues / trajet
                  </Badge>
                  <Badge size="xs" colorPalette={bilan.teleportations > 1000 ? 'orange' : 'gray'}>
                    {nombre(bilan.teleportations)} téléportations
                  </Badge>
                  {bilan.raisonFin && (
                    <Badge size="xs" colorPalette="red" title={bilan.raisonFin}>
                      arrêtée à {heure(bilan.finSimulee)}
                    </Badge>
                  )}
                </HStack>
                {actif && essai.description && (
                  <Aide mt="1.5">{essai.description}</Aide>
                )}
              </Box>
              {actif && (
                <Button size="2xs" variant="ghost" mt="0.5" onClick={() => onNouvel(essai.id)}>
                  Relancer avec d'autres réglages
                </Button>
              )}
            </Box>
          )
        })}
      </Stack>
      </Stack>
      )}
    </CarteEnTete>
  )
}
