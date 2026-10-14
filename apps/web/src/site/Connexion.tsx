import { Button, Field, Input, Stack } from '@chakra-ui/react'
import { Aide } from '../ds'

/**
 * Connexion des contributeurs et modérateurs. L'API n'a pas encore d'authentification :
 * le formulaire est posé mais inactif.
 */
export function Connexion() {
  return (
    <Stack as="form" gap="3" onSubmit={(e) => e.preventDefault()}>
      <Aide>
        La connexion arrivera avec la modération des contributions. En attendant, la carte reste ouverte à tous, sans
        compte.
      </Aide>
      <Field.Root disabled>
        <Field.Label>Adresse e-mail</Field.Label>
        <Input type="email" autoComplete="email" />
      </Field.Root>
      <Field.Root disabled>
        <Field.Label>Mot de passe</Field.Label>
        <Input type="password" autoComplete="current-password" />
      </Field.Root>
      <Button type="submit" disabled>
        Se connecter
      </Button>
    </Stack>
  )
}
