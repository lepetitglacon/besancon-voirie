import { Heading, Link, Stack, Text } from '@chakra-ui/react'
import type { ReactNode } from 'react'

function Bloc({ titre, children }: { titre: string; children: ReactNode }) {
  return (
    <Stack gap="1.5">
      <Heading as="h3" textStyle="sm" fontWeight="semibold">
        {titre}
      </Heading>
      {children}
    </Stack>
  )
}

/** Mentions légales d'un site édité par un particulier, non professionnel. */
export function MentionsLegales() {
  return (
    <Stack gap="4" textStyle="sm">
      <Bloc titre="Éditeur">
        <Text>Site édité à titre personnel et non professionnel, sans but lucratif.</Text>
      </Bloc>
      <Bloc titre="Hébergement">
        {/* À compléter avec le nom, l'adresse et le téléphone de l'hébergeur du VPS. */}
        <Text color="fg.muted">Hébergeur : à préciser lors de la mise en ligne.</Text>
      </Bloc>
      <Bloc titre="Données et licences">
        <Text>
          Les données publiées (carrefours, feux, plans de feux, relevés) sont dérivées d'OpenStreetMap et diffusées
          sous{' '}
          <Link href="https://opendatacommons.org/licenses/odbl/1-0/" target="_blank" rel="noreferrer" color="fg.info">
            Open Database License (ODbL) 1.0
          </Link>{' '}
          : « © contributeurs OpenStreetMap, © contributeurs Besançon Voirie ». Le code source est sous licence
          AGPL-3.0.
        </Text>
        <Text>
          Autres sources : IGN Géoplateforme (Licence Ouverte), GTFS Ginko via transport.data.gouv.fr.
        </Text>
      </Bloc>
      <Bloc titre="Avertissement">
        <Text>
          Outil citoyen indépendant, sans lien avec la Ville de Besançon ni Grand Besançon Métropole. Les données sont
          relevées à l'œil et n'ont qu'une valeur indicative.
        </Text>
      </Bloc>
      <Bloc titre="Cookies et données personnelles">
        <Text>Le site ne dépose aucun cookie et n'utilise aucun outil de mesure d'audience.</Text>
      </Bloc>
    </Stack>
  )
}
