import { Button, Field, Input, Stack, Text } from '@chakra-ui/react'
import { useMutation } from '@tanstack/react-query'
import { Inscription as SchemaInscription, MOT_DE_PASSE_MIN } from '@voirie/schema'
import { useState } from 'react'
import { api } from '../api'
import { Aide, LibelleSection, Message } from '../ds'
import { PAGES } from '../site/pages'
import { demandesDepuisChoix, type Choix } from './choix'
import { ChoixRoles } from './ChoixRoles'
import { BoutonGoogle, LienPage, Relance, SeparateurOu } from './elements'

/** Création d'un compte : identité, mot de passe et rôles métier demandés. */
export function Inscription() {
  const [nom, setNom] = useState('')
  const [email, setEmail] = useState('')
  const [motDePasse, setMotDePasse] = useState('')
  const [choix, setChoix] = useState<Choix>({})
  const [erreurs, setErreurs] = useState<string[]>([])

  const inscription = useMutation({ mutationFn: api.inscription })

  if (inscription.isSuccess) {
    return (
      <Stack gap="3">
        <Text>
          Un lien de confirmation vient d’être envoyé à <strong>{email}</strong>. Ouvrez-le pour activer votre compte.
        </Text>
        <Aide>
          Les rôles soumis à validation seront examinés par un administrateur ; vous recevrez un e-mail à chaque
          décision.
        </Aide>
      </Stack>
    )
  }

  const envoyer = () => {
    const saisie = SchemaInscription.safeParse({ nom, email, motDePasse, roles: demandesDepuisChoix(choix) })
    if (!saisie.success) return setErreurs([...new Set(saisie.error.issues.map((i) => i.message))])
    setErreurs([])
    inscription.mutate(saisie.data)
  }

  return (
    <Stack gap="4">
      <BoutonGoogle>S’inscrire avec Google</BoutonGoogle>
      <Aide textAlign="center" mt="-2">
        Avec Google, vous choisirez vos rôles juste après.
      </Aide>
      <SeparateurOu>ou avec une adresse e-mail</SeparateurOu>
      <Stack
        as="form"
        gap="3"
        onSubmit={(e) => {
          e.preventDefault()
          envoyer()
        }}
      >
        <Field.Root required>
          <Field.Label>Nom affiché</Field.Label>
          <Input autoComplete="nickname" maxLength={80} value={nom} onChange={(e) => setNom(e.target.value)} />
          <Field.HelperText>Visible sur vos contributions.</Field.HelperText>
        </Field.Root>
        <Field.Root required>
          <Field.Label>Adresse e-mail</Field.Label>
          <Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field.Root>
        <Field.Root required>
          <Field.Label>Mot de passe</Field.Label>
          <Input
            type="password"
            autoComplete="new-password"
            minLength={MOT_DE_PASSE_MIN}
            value={motDePasse}
            onChange={(e) => setMotDePasse(e.target.value)}
          />
          <Field.HelperText>{MOT_DE_PASSE_MIN} caractères au moins.</Field.HelperText>
        </Field.Root>

        <Stack gap="2" mt="2">
          <LibelleSection>Vos rôles</LibelleSection>
          <Aide>
            Cochez ce que vous voulez saisir. Sans rôle, vous pouvez consulter la carte et en demander plus tard depuis
            vos paramètres.
          </Aide>
          <ChoixRoles choix={choix} onChange={setChoix} />
        </Stack>

        {erreurs.map((erreur) => (
          <Message key={erreur} ton="erreur">
            {erreur}
          </Message>
        ))}
        {inscription.error && <Message ton="erreur">{inscription.error.message}</Message>}
        <Button type="submit" size="lg" variant="solid" loading={inscription.isPending}>
          Créer mon compte
        </Button>
      </Stack>
      <Relance>
        Déjà un compte ? <LienPage vers={PAGES.connexion.chemin}>Se connecter</LienPage>
      </Relance>
    </Stack>
  )
}
