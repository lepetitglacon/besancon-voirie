import { Accordion, Box, Button, chakra, HStack, Stack, Text } from '@chakra-ui/react'
import { CATEGORIES_BUS, type LigneBus } from './lignesBus'

interface Props {
  lignes: LigneBus[]
  masquees: Set<string>
  onChange: (masquees: Set<string>) => void
  /** Bus en circulation par ligne. */
  enCirculation?: Map<string, number>
}

/**
 * Lignes de bus affichées, en accordéon par famille : plus de 150 lignes, repliées par défaut
 * pour ne pas envahir le panneau. Une pastille par ligne, pleine si la ligne est affichée.
 */
export function ChoixLignesBus({ lignes, masquees, onChange, enCirculation }: Props) {
  const basculer = (ligne: string) => {
    const suivantes = new Set(masquees)
    if (!suivantes.delete(ligne)) suivantes.add(ligne)
    onChange(suivantes)
  }
  const regler = (famille: LigneBus[], visibles: boolean) => {
    const suivantes = new Set(masquees)
    for (const { ligne } of famille) {
      if (visibles) suivantes.delete(ligne)
      else suivantes.add(ligne)
    }
    onChange(suivantes)
  }

  return (
    <Accordion.Root multiple collapsible lazyMount size="sm" variant="plain">
      {CATEGORIES_BUS.map((categorie) => {
        const famille = lignes.filter((l) => l.categorie === categorie.cle)
        if (famille.length === 0) return null
        const affichees = famille.filter((l) => !masquees.has(l.ligne)).length
        const bus = famille.reduce((total, l) => total + (masquees.has(l.ligne) ? 0 : (enCirculation?.get(l.ligne) ?? 0)), 0)
        return (
          <Accordion.Item key={categorie.cle} value={categorie.cle}>
            <Accordion.ItemTrigger py="1">
              <Text flex="1" textStyle="xs" fontWeight="semibold">
                {categorie.libelle}{' '}
                <Box as="span" color="fg.muted" fontWeight="normal">
                  {affichees}/{famille.length}
                  {enCirculation && affichees > 0 && ` · ${bus} bus`}
                </Box>
              </Text>
              <Accordion.ItemIndicator />
            </Accordion.ItemTrigger>
            <Accordion.ItemContent>
              <Accordion.ItemBody pt="1" pb="2">
                <Stack gap="1.5">
                  <HStack gap="1">
                    <Button size="2xs" variant="ghost" disabled={affichees === famille.length} onClick={() => regler(famille, true)}>
                      Toutes
                    </Button>
                    <Button size="2xs" variant="ghost" disabled={affichees === 0} onClick={() => regler(famille, false)}>
                      Aucune
                    </Button>
                  </HStack>
                  <HStack gap="1" wrap="wrap">
                    {famille.map(({ ligne, couleur, couleurTexte }) => {
                      const visible = !masquees.has(ligne)
                      const n = enCirculation?.get(ligne) ?? 0
                      return (
                        <chakra.button
                          key={ligne}
                          type="button"
                          aria-pressed={visible}
                          title={`Ligne ${ligne}${enCirculation ? ` · ${n} bus en circulation` : ''}`}
                          onClick={() => basculer(ligne)}
                          minW="7"
                          px="1.5"
                          py="0.5"
                          borderRadius="sm"
                          borderWidth="1.5px"
                          borderColor={couleur}
                          bg={visible ? couleur : 'transparent'}
                          color={visible ? couleurTexte : 'fg.muted'}
                          textStyle="2xs"
                          fontWeight="semibold"
                          cursor="pointer"
                          opacity={visible ? 1 : 0.7}
                        >
                          {ligne}
                        </chakra.button>
                      )
                    })}
                  </HStack>
                </Stack>
              </Accordion.ItemBody>
            </Accordion.ItemContent>
          </Accordion.Item>
        )
      })}
    </Accordion.Root>
  )
}
