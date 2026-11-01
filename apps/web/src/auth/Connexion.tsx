import { Button, Field, HStack, Input, Stack } from '@chakra-ui/react'
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { api } from '../api'
import { Aide, Message, notifications } from '../ds'
import { avecVue, PAGES } from '../site/pages'
import { BoutonGoogle, LienPage, Relance, SeparateurOu } from './elements'
import { useMajSession } from './session'

/** Modale de connexion, ouverte depuis le menu de l'avatar : Google, ou e-mail et mot de passe. */
export function Connexion() {
  const naviguer = useNavigate()
  const majSession = useMajSession()
  // Retour de Google en échec : /connexion?erreur=…
  const [parametres] = useSearchParams()
  const erreurGoogle = parametres.get('erreur')
  const [email, setEmail] = useState('')
  const [motDePasse, setMotDePasse] = useState('')

  const connexion = useMutation({
    mutationFn: api.connexion,
    onSuccess: (session) => {
      majSession(session)
      notifications.create({ type: 'success', title: `Bonjour, ${session.utilisateur?.nom ?? ''}` })
      naviguer(avecVue('/'))
    },
  })

  return (
    <Stack gap="4">
      <Aide>
        Un compte sert à saisir les données des carrefours, selon les rôles qu’on vous accorde. La carte reste
        consultable sans compte.
      </Aide>
      {erreurGoogle && <Message ton="erreur">{erreurGoogle}</Message>}
      <BoutonGoogle>Continuer avec Google</BoutonGoogle>
      <SeparateurOu>ou avec une adresse e-mail</SeparateurOu>
      <Stack
        as="form"
        gap="3"
        onSubmit={(e) => {
          e.preventDefault()
          connexion.mutate({ email, motDePasse })
        }}
      >
        <Field.Root required>
          <Field.Label>Adresse e-mail</Field.Label>
          <Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field.Root>
        <Field.Root required>
          <HStack justify="space-between" w="full">
            <Field.Label>Mot de passe</Field.Label>
            <LienPage vers={PAGES.motDePasseOublie.chemin} textStyle="xs">
              Mot de passe oublié ?
            </LienPage>
          </HStack>
          <Input
            type="password"
            autoComplete="current-password"
            value={motDePasse}
            onChange={(e) => setMotDePasse(e.target.value)}
          />
        </Field.Root>
        {connexion.error && <Message ton="erreur">{connexion.error.message}</Message>}
        <Button type="submit" size="lg" variant="solid" loading={connexion.isPending}>
          Se connecter
        </Button>
      </Stack>
      <Relance>
        Pas encore de compte ? <LienPage vers={PAGES.inscription.chemin}>Créer un compte</LienPage>
      </Relance>
    </Stack>
  )
}
