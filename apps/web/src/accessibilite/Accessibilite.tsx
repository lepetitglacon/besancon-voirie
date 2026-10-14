import { Button, HStack, SimpleGrid, Stack, Text } from '@chakra-ui/react'
import { Aide, Bascule, LibelleSection, Segments } from '../ds'
import { POLICES, REGLAGES_DEFAUT, useAccessibilite, type Police } from './reglages'

const ECHELLES = [1, 1.15, 1.3, 1.5].map((e) => ({ valeur: String(e), libelle: `${Math.round(e * 100)} %` }))

/** Réglages d'affichage : taille de l'interface, du texte, police, espacement. */
export function Accessibilite() {
  const [reglages, setReglages] = useAccessibilite()
  const changer = (modif: Partial<typeof reglages>) => setReglages({ ...reglages, ...modif })

  return (
    <Stack gap="5">
      {/* Les deux tailles côte à côte ; l'une sous l'autre sur un écran étroit. */}
      <SimpleGrid columns={{ base: 1, sm: 2 }} gap="4">
        <Stack gap="2">
          <LibelleSection>Taille de l'interface</LibelleSection>
          <Segments
            aria-label="Taille de l'interface"
            valeur={String(reglages.interface)}
            onChange={(v) => changer({ interface: Number(v) })}
            options={ECHELLES}
          />
          <Aide>Agrandit tout : panneaux, boutons et texte. La carte garde son échelle.</Aide>
        </Stack>
        <Stack gap="2">
          <LibelleSection>Taille du texte</LibelleSection>
          <Segments
            aria-label="Taille du texte"
            valeur={String(reglages.texte)}
            onChange={(v) => changer({ texte: Number(v) })}
            options={ECHELLES}
          />
          <Aide>Agrandit le texte seul ; les panneaux gardent leur largeur.</Aide>
        </Stack>
      </SimpleGrid>
      <Stack gap="2">
        <LibelleSection>Police</LibelleSection>
        <Segments
          aria-label="Police"
          valeur={reglages.police}
          onChange={(police) => changer({ police })}
          options={(Object.keys(POLICES) as Police[]).map((police) => ({
            valeur: police,
            libelle: (
              <Text as="span" fontFamily={POLICES[police].apercu}>
                {POLICES[police].libelle}
              </Text>
            ),
          }))}
        />
        <Aide>Atkinson Hyperlegible distingue mieux les lettres proches ; OpenDyslexic est pensée pour la dyslexie.</Aide>
      </Stack>
      <Bascule coche={reglages.espacement} onChange={(espacement) => changer({ espacement })}>
        Espacer les lettres et les mots
      </Bascule>
      <HStack justify="space-between">
        <Aide>Réglages mémorisés dans ce navigateur.</Aide>
        <Button size="sm" variant="outline" onClick={() => setReglages(REGLAGES_DEFAUT)}>
          Réinitialiser
        </Button>
      </HStack>
    </Stack>
  )
}
