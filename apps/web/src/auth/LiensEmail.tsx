import { Button, Field, Input, Spinner, Stack, Text } from '@chakra-ui/react'
import { useMutation } from '@tanstack/react-query'
import { MOT_DE_PASSE_MIN } from '@voirie/schema'
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { api } from '../api'
import { Aide, Message, notifications } from '../ds'
import { avecVue, PAGES } from '../site/pages'
import { LienPage, Relance } from './elements'
import { useMajSession } from './session'

/** Demande du lien de réinitialisation. La réponse ne dit pas si l'adresse a un compte. */
export function MotDePasseOublie() {
  const [email, setEmail] = useState('')
  const demande = useMutation({ mutationFn: api.motDePasseOublie })

  if (demande.isSuccess) {
    return (
      <Text>
        Si un compte existe pour <strong>{email}</strong>, un lien pour choisir un nouveau mot de passe vient de lui être
        envoyé. Il est valable une heure.
      </Text>
    )
  }
  return (
    <Stack
      as="form"
      gap="3"
      onSubmit={(e) => {
        e.preventDefault()
        demande.mutate(email)
      }}
    >
      <Aide>
        Indiquez l’adresse de votre compte : vous recevrez un lien pour choisir un nouveau mot de passe. Il sert aussi à
        en définir un pour un compte créé avec Google.
      </Aide>
      <Field.Root required>
        <Field.Label>Adresse e-mail</Field.Label>
        <Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field.Root>
      {demande.error && <Message ton="erreur">{demande.error.message}</Message>}
      <Button type="submit" variant="solid" loading={demande.isPending}>
        Envoyer le lien
      </Button>
      <Relance>
        <LienPage vers={PAGES.connexion.chemin}>Retour à la connexion</LienPage>
      </Relance>
    </Stack>
  )
}

/** Lien reçu par e-mail (`?jeton=`) : nouveau mot de passe, puis connexion. */
export function Reinitialisation() {
  const [parametres] = useSearchParams()
  const jeton = parametres.get('jeton') ?? ''
  const naviguer = useNavigate()
  const majSession = useMajSession()
  const [motDePasse, setMotDePasse] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const reinitialisation = useMutation({
    mutationFn: () => api.reinitialiserMotDePasse(jeton, motDePasse),
    onSuccess: (session) => {
      majSession(session)
      notifications.create({ type: 'success', title: 'Mot de passe enregistré', description: 'Vous êtes connecté.' })
      naviguer(avecVue('/'))
    },
  })
  const differents = confirmation !== '' && confirmation !== motDePasse

  return (
    <Stack
      as="form"
      gap="3"
      onSubmit={(e) => {
        e.preventDefault()
        if (!differents) reinitialisation.mutate()
      }}
    >
      <Field.Root required>
        <Field.Label>Nouveau mot de passe</Field.Label>
        <Input
          type="password"
          autoComplete="new-password"
          minLength={MOT_DE_PASSE_MIN}
          value={motDePasse}
          onChange={(e) => setMotDePasse(e.target.value)}
        />
        <Field.HelperText>{MOT_DE_PASSE_MIN} caractères au moins.</Field.HelperText>
      </Field.Root>
      <Field.Root required invalid={differents}>
        <Field.Label>Confirmation</Field.Label>
        <Input type="password" autoComplete="new-password" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} />
        <Field.ErrorText>Les deux mots de passe diffèrent.</Field.ErrorText>
      </Field.Root>
      {reinitialisation.error && <Message ton="erreur">{reinitialisation.error.message}</Message>}
      <Aide>Vos autres sessions seront fermées.</Aide>
      <Button type="submit" variant="solid" loading={reinitialisation.isPending} disabled={!jeton}>
        Enregistrer et me connecter
      </Button>
    </Stack>
  )
}

/** Lien de confirmation de l'inscription (`?jeton=`) : active le compte et connecte. */
export function VerificationEmail() {
  const [parametres] = useSearchParams()
  const jeton = parametres.get('jeton') ?? ''
  const naviguer = useNavigate()
  const majSession = useMajSession()
  const verification = useMutation({
    mutationFn: api.verifierEmail,
    onSuccess: (session) => {
      majSession(session)
      notifications.create({ type: 'success', title: 'Adresse confirmée', description: `Bienvenue, ${session.utilisateur?.nom ?? ''}.` })
      naviguer(avecVue('/'))
    },
  })
  // Une seule tentative : le jeton est à usage unique (StrictMode monte deux fois en dev).
  const lance = useRef(false)
  useEffect(() => {
    if (lance.current || !jeton) return
    lance.current = true
    verification.mutate(jeton)
  }, [jeton, verification])

  if (verification.error || !jeton) {
    return (
      <Stack gap="3">
        <Message ton="erreur">{verification.error?.message ?? 'Lien incomplet'}</Message>
        <Aide>Connectez-vous avec votre adresse : un nouveau lien vous sera envoyé.</Aide>
        <Relance>
          <LienPage vers={PAGES.connexion.chemin}>Se connecter</LienPage>
        </Relance>
      </Stack>
    )
  }
  return (
    <Stack direction="row" gap="3" align="center">
      <Spinner size="sm" />
      <Text>Confirmation en cours…</Text>
    </Stack>
  )
}
