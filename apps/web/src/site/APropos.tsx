import { Link, List, Stack, Text } from '@chakra-ui/react'
import { DEPOT } from './pages'

/** Présentation du projet, reprise du README. */
export function APropos() {
  return (
    <Stack gap="3" textStyle="sm">
      <Text>
        Besançon Voirie est un projet citoyen, open source, mené en solo. Il recense l'état actuel des feux tricolores
        de Besançon pour publier une carte que n'importe qui peut consulter et compléter.
      </Text>
      <List.Root ps="5" gap="1.5">
        <List.Item>
          <strong>Inventaire</strong> : quel carrefour, quels feux, quelle programmation.
        </List.Item>
        <List.Item>
          <strong>Ondes vertes</strong> : relier les carrefours et tester des décalages (diagramme espace-temps, bande
          passante).
        </List.Item>
        <List.Item>
          <strong>Simulation</strong> : rejouer l'existant et ses variantes dans SUMO pour mesurer l'effet réel.
        </List.Item>
      </List.Root>
      <Text>
        Outil citoyen indépendant, sans lien avec la Ville ni la Métropole. Les données sont relevées à l'œil depuis
        l'espace public : elles sont indicatives.
      </Text>
      <Text>
        Code et feuille de route :{' '}
        <Link href={DEPOT} target="_blank" rel="noreferrer" color="fg.info">
          github.com/lepetitglacon/besancon-voirie
        </Link>
        .
      </Text>
    </Stack>
  )
}
