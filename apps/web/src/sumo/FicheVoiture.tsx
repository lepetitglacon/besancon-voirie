import { Badge, Box, Button, HStack, Text } from '@chakra-ui/react'
import { Aide, Chiffre, Section } from '../ds'
import { etatSumo, useEtatSumo } from './etat'
import { heure } from './indicateurs'
import { COULEUR_FLUX, COULEURS_MOTIF, LIBELLES_MOTIF, type Vehicules } from './vehicules'

const duree = (secondes: number) =>
  secondes < 3600 ? `${Math.round(secondes / 60)} min` : `${Math.floor(secondes / 3600)} h ${String(Math.round((secondes % 3600) / 60)).padStart(2, '0')}`

interface Props {
  vehicules: Vehicules
  v: number
}

/** Une voiture : motif, horaires, temps perdu, rue en cours ; son itinéraire est dessiné sur la carte. */
export function FicheVoiture({ vehicules, v }: Props) {
  // Redessinée à chaque seconde simulée : la rue en cours change.
  const seconde = useEtatSumo((e) => Math.floor(e.temps))
  const suivre = useEtatSumo((e) => e.suivre)
  const fiche = vehicules.fiche(v, seconde)
  const couleur = COULEURS_MOTIF[fiche.motif] ?? COULEUR_FLUX
  const flux = fiche.motif.startsWith('flux')
  const libelle = LIBELLES_MOTIF[fiche.motif] ?? (flux ? `Flux ${fiche.motif.slice(4)}` : fiche.motif)
  const etat = seconde < fiche.depart ? 'pas encore partie' : fiche.etape === null ? 'arrivée' : (fiche.rue || 'rue sans nom')

  return (
    <Section libelle="Voiture" pt="2.5" borderTopWidth="1px" borderColor="border.muted">
      <HStack justify="space-between" align="start">
        <Box>
          <HStack gap="1.5">
            <Text textStyle="sm" fontWeight="semibold">
              Voiture n° {v + 1}
            </Text>
            <Badge size="xs" style={{ background: couleur, color: '#fff' }}>
              {libelle}
            </Badge>
          </HStack>
          <Aide>{etat}</Aide>
        </Box>
        <HStack gap="1">
          <Button
            size="2xs"
            variant={suivre ? 'solid' : 'outline'}
            disabled={fiche.etape === null}
            onClick={() => etatSumo.modifier({ suivre: !suivre })}
          >
            Suivre
          </Button>
          <Button size="2xs" variant="ghost" onClick={() => etatSumo.modifier({ vehicule: null, suivre: false })}>
            Fermer
          </Button>
        </HStack>
      </HStack>
      <HStack gap="1">
        <Chiffre valeur={heure(fiche.depart)} libelle="départ" />
        <Chiffre valeur={heure(fiche.arrivee)} libelle={fiche.perte === null ? 'fin simulée' : 'arrivée'} />
        <Chiffre valeur={duree(fiche.arrivee - fiche.depart)} libelle="trajet" />
      </HStack>
      <HStack gap="1">
        <Chiffre valeur={fiche.perte === null ? '–' : duree(fiche.perte)} libelle="temps perdu" />
        <Chiffre valeur={`${(fiche.distance / 1000).toFixed(1)} km`} libelle="distance" />
        <Chiffre
          valeur={fiche.etape === null ? `${fiche.aretes.length}` : `${fiche.etape + 1}/${fiche.aretes.length}`}
          libelle="tronçons"
        />
      </HStack>
      <Aide>
        Itinéraire sur la carte : gris, déjà parcouru ; bleu, à venir.
        {fiche.perte === null && ' Pas arrivée à la fin de la simulation.'}
      </Aide>
    </Section>
  )
}
