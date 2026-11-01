import { Badge, CheckboxCard, Field, HStack, Stack, Textarea } from '@chakra-ui/react'
import { ROLES, ROLES_DEMANDABLES, type Role } from '@voirie/schema'
import type { Choix } from './choix'

interface Props {
  choix: Choix
  onChange: (choix: Choix) => void
  /** Rôles déjà accordés ou demandés : pas proposés. */
  exclus?: Role[]
}

/**
 * Cartes des rôles métier à cocher. Un rôle soumis à validation demande une motivation, lue par
 * l'admin qui l'accorde ; les autres sont accordés tout de suite.
 */
export function ChoixRoles({ choix, onChange, exclus = [] }: Props) {
  const roles = ROLES_DEMANDABLES.filter((role) => !exclus.includes(role))

  const basculer = (role: Role, coche: boolean) => {
    const suivant = { ...choix }
    if (coche) suivant[role] = ''
    else delete suivant[role]
    onChange(suivant)
  }

  return (
    <Stack gap="2">
      {roles.map((role) => {
        const definition = ROLES[role]
        const coche = role in choix
        return (
          <Stack key={role} gap="2">
            {/* Le thème grise les cartes (flèches de voies) : ici, texte lisible et fond léger une fois coché. */}
            <CheckboxCard.Root
              size="sm"
              variant="surface"
              color="fg"
              checked={coche}
              onCheckedChange={(e) => basculer(role, e.checked === true)}
            >
              <CheckboxCard.HiddenInput />
              <CheckboxCard.Control>
                <CheckboxCard.Content>
                  <HStack gap="2" wrap="wrap">
                    <CheckboxCard.Label>{definition.libelle}</CheckboxCard.Label>
                    <Badge size="sm" colorPalette={definition.validation ? 'orange' : 'green'}>
                      {definition.validation ? 'Soumis à validation' : 'Immédiat'}
                    </Badge>
                  </HStack>
                  <CheckboxCard.Description color="fg.muted">{definition.description}</CheckboxCard.Description>
                </CheckboxCard.Content>
                <CheckboxCard.Indicator />
              </CheckboxCard.Control>
            </CheckboxCard.Root>
            {coche && definition.validation && (
              <Field.Root required pl="4">
                <Field.Label>Motivation pour « {definition.libelle} »</Field.Label>
                <Textarea
                  autoresize
                  minH="16"
                  maxLength={2000}
                  placeholder="Ce que vous comptez saisir, votre connaissance du terrain…"
                  value={choix[role] ?? ''}
                  onChange={(e) => onChange({ ...choix, [role]: e.target.value })}
                />
              </Field.Root>
            )}
          </Stack>
        )
      })}
    </Stack>
  )
}
