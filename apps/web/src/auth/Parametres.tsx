import { Badge, Box, Button, Field, HStack, Input, Stack, Tabs, Text } from '@chakra-ui/react'
import { useMutation } from '@tanstack/react-query'
import { MOT_DE_PASSE_MIN, ROLES, type RoleUtilisateur, type UtilisateurSession } from '@voirie/schema'
import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { api } from '../api'
import { Aide, LibelleSection, Message, notifications } from '../ds'
import { avecVue, PAGES } from '../site/pages'
import { demandesDepuisChoix, type Choix } from './choix'
import { ChoixRoles } from './ChoixRoles'
import { BoutonGoogle, LienPage } from './elements'
import { useMajSession, useSession } from './session'

const ONGLETS = ['profil', 'securite', 'comptes', 'roles'] as const
type Onglet = (typeof ONGLETS)[number]

/** Paramètres du compte connecté, ouverts depuis le menu de l'avatar (`?onglet=roles`…). */
export function Parametres() {
  const { utilisateur, chargement } = useSession()
  const [parametres, setParametres] = useSearchParams()
  const demande = parametres.get('onglet') as Onglet | null
  const onglet: Onglet = demande && ONGLETS.includes(demande) ? demande : 'profil'

  if (chargement) return null
  if (!utilisateur) {
    return (
      <Aide>
        Connectez-vous pour accéder à vos paramètres. <LienPage vers={PAGES.connexion.chemin}>Se connecter</LienPage>
      </Aide>
    )
  }
  return (
    <Tabs.Root value={onglet} onValueChange={(e) => setParametres({ onglet: e.value }, { replace: true })} variant="line">
      <Tabs.List>
        <Tabs.Trigger value="profil">Profil</Tabs.Trigger>
        <Tabs.Trigger value="securite">Sécurité</Tabs.Trigger>
        <Tabs.Trigger value="comptes">Comptes liés</Tabs.Trigger>
        <Tabs.Trigger value="roles">Mes rôles</Tabs.Trigger>
      </Tabs.List>
      <Tabs.Content value="profil">
        <Profil utilisateur={utilisateur} />
      </Tabs.Content>
      <Tabs.Content value="securite">
        <Securite utilisateur={utilisateur} />
      </Tabs.Content>
      <Tabs.Content value="comptes">
        <ComptesLies utilisateur={utilisateur} />
      </Tabs.Content>
      <Tabs.Content value="roles">
        {parametres.get('bienvenue') && (
          <Box mb="4" p="3" borderRadius="md" bg="brand.subtle">
            <Text textStyle="sm">Bienvenue ! Choisissez les rôles dont vous avez besoin pour contribuer.</Text>
          </Box>
        )}
        <MesRoles utilisateur={utilisateur} />
      </Tabs.Content>
    </Tabs.Root>
  )
}

interface PropsOnglet {
  utilisateur: UtilisateurSession
}

function Profil({ utilisateur }: PropsOnglet) {
  const majSession = useMajSession()
  const naviguer = useNavigate()
  const [nom, setNom] = useState(utilisateur.nom)
  const [confirmerSuppression, setConfirmerSuppression] = useState(false)
  const modification = useMutation({
    mutationFn: () => api.modifierCompte({ nom }),
    onSuccess: (session) => {
      majSession(session)
      notifications.create({ type: 'success', title: 'Profil enregistré' })
    },
  })
  const suppression = useMutation({
    mutationFn: api.supprimerCompte,
    onSuccess: () => {
      majSession(null)
      notifications.create({ type: 'info', title: 'Compte supprimé' })
      naviguer(avecVue('/'))
    },
  })

  return (
    <Stack gap="5">
      <Stack
        as="form"
        gap="3"
        onSubmit={(e) => {
          e.preventDefault()
          modification.mutate()
        }}
      >
        <Field.Root required>
          <Field.Label>Nom affiché</Field.Label>
          <Input maxLength={80} value={nom} onChange={(e) => setNom(e.target.value)} />
        </Field.Root>
        <Field.Root readOnly>
          <Field.Label>Adresse e-mail</Field.Label>
          <Input value={utilisateur.email} readOnly />
          <Field.HelperText>L’adresse ne se change pas pour l’instant.</Field.HelperText>
        </Field.Root>
        {modification.error && <Message ton="erreur">{modification.error.message}</Message>}
        <Button type="submit" variant="solid" alignSelf="flex-start" loading={modification.isPending} disabled={nom.trim() === utilisateur.nom}>
          Enregistrer
        </Button>
      </Stack>

      <Stack gap="2" pt="4" borderTopWidth="1px">
        <LibelleSection>Supprimer le compte</LibelleSection>
        <Aide>
          Votre compte, vos rôles et vos demandes sont effacés. Les données déjà saisies sur les carrefours restent.
        </Aide>
        {suppression.error && <Message ton="erreur">{suppression.error.message}</Message>}
        {confirmerSuppression ? (
          <HStack>
            <Button variant="solid" colorPalette="red" loading={suppression.isPending} onClick={() => suppression.mutate()}>
              Supprimer définitivement
            </Button>
            <Button variant="ghost" onClick={() => setConfirmerSuppression(false)}>
              Annuler
            </Button>
          </HStack>
        ) : (
          <Button variant="outline" colorPalette="red" alignSelf="flex-start" onClick={() => setConfirmerSuppression(true)}>
            Supprimer mon compte
          </Button>
        )}
      </Stack>
    </Stack>
  )
}

function Securite({ utilisateur }: PropsOnglet) {
  const majSession = useMajSession()
  const naviguer = useNavigate()
  const [actuel, setActuel] = useState('')
  const [nouveau, setNouveau] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const differents = confirmation !== '' && confirmation !== nouveau
  const changement = useMutation({
    mutationFn: () => api.changerMotDePasse({ actuel: utilisateur.motDePasse ? actuel : undefined, nouveau }),
    onSuccess: (session) => {
      majSession(session)
      setActuel('')
      setNouveau('')
      setConfirmation('')
      notifications.create({ type: 'success', title: 'Mot de passe enregistré', description: 'Vos autres sessions sont fermées.' })
    },
  })
  const partout = useMutation({
    mutationFn: api.deconnexionPartout,
    onSuccess: () => {
      majSession(null)
      notifications.create({ type: 'info', title: 'Toutes vos sessions sont fermées' })
      naviguer(avecVue('/'))
    },
  })

  return (
    <Stack gap="5">
      <Stack
        as="form"
        gap="3"
        onSubmit={(e) => {
          e.preventDefault()
          if (!differents) changement.mutate()
        }}
      >
        <LibelleSection>{utilisateur.motDePasse ? 'Changer le mot de passe' : 'Définir un mot de passe'}</LibelleSection>
        {!utilisateur.motDePasse && (
          <Aide>Votre compte se connecte par Google. Un mot de passe permet aussi de se connecter sans Google.</Aide>
        )}
        {utilisateur.motDePasse && (
          <Field.Root required>
            <Field.Label>Mot de passe actuel</Field.Label>
            <Input type="password" autoComplete="current-password" value={actuel} onChange={(e) => setActuel(e.target.value)} />
          </Field.Root>
        )}
        <Field.Root required>
          <Field.Label>Nouveau mot de passe</Field.Label>
          <Input
            type="password"
            autoComplete="new-password"
            minLength={MOT_DE_PASSE_MIN}
            value={nouveau}
            onChange={(e) => setNouveau(e.target.value)}
          />
          <Field.HelperText>{MOT_DE_PASSE_MIN} caractères au moins.</Field.HelperText>
        </Field.Root>
        <Field.Root required invalid={differents}>
          <Field.Label>Confirmation</Field.Label>
          <Input type="password" autoComplete="new-password" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} />
          <Field.ErrorText>Les deux mots de passe diffèrent.</Field.ErrorText>
        </Field.Root>
        {changement.error && <Message ton="erreur">{changement.error.message}</Message>}
        <Button type="submit" variant="solid" alignSelf="flex-start" loading={changement.isPending}>
          Enregistrer
        </Button>
      </Stack>

      <Stack gap="2" pt="4" borderTopWidth="1px">
        <LibelleSection>Sessions</LibelleSection>
        <Aide>Ferme votre session sur tous les appareils, celui-ci compris.</Aide>
        <Button variant="outline" alignSelf="flex-start" loading={partout.isPending} onClick={() => partout.mutate()}>
          Déconnecter toutes les sessions
        </Button>
      </Stack>
    </Stack>
  )
}

function ComptesLies({ utilisateur }: PropsOnglet) {
  const majSession = useMajSession()
  const [, setParametres] = useSearchParams()
  const deliaison = useMutation({
    mutationFn: api.delierGoogle,
    onSuccess: (session) => {
      majSession(session)
      notifications.create({ type: 'info', title: 'Compte Google délié' })
    },
  })

  return (
    <Stack gap="4">
      <Aide>Les deux façons de vous connecter mènent au même compte, avec les mêmes rôles.</Aide>
      <HStack justify="space-between" p="3" borderWidth="1px" borderRadius="md" gap="3" wrap="wrap">
        <Stack gap="0.5">
          <Text fontWeight="medium">Google</Text>
          <Aide>{utilisateur.google ? 'Lié à ce compte' : 'Non lié'}</Aide>
        </Stack>
        {utilisateur.google ? (
          <Button
            variant="outline"
            size="sm"
            loading={deliaison.isPending}
            disabled={!utilisateur.motDePasse}
            title={utilisateur.motDePasse ? undefined : 'Définissez d’abord un mot de passe'}
            onClick={() => deliaison.mutate()}
          >
            Délier
          </Button>
        ) : (
          <BoutonGoogle mode="liaison">Lier mon compte Google</BoutonGoogle>
        )}
      </HStack>
      <HStack justify="space-between" p="3" borderWidth="1px" borderRadius="md" gap="3" wrap="wrap">
        <Stack gap="0.5">
          <Text fontWeight="medium">Mot de passe</Text>
          <Aide>{utilisateur.motDePasse ? 'Défini' : 'Aucun'}</Aide>
        </Stack>
        <Button variant="outline" size="sm" onClick={() => setParametres({ onglet: 'securite' }, { replace: true })}>
          {utilisateur.motDePasse ? 'Changer' : 'Définir'}
        </Button>
      </HStack>
      {deliaison.error && <Message ton="erreur">{deliaison.error.message}</Message>}
    </Stack>
  )
}

const STATUTS: Record<RoleUtilisateur['statut'], { libelle: string; couleur: string }> = {
  accorde: { libelle: 'Accordé', couleur: 'green' },
  en_attente: { libelle: 'En attente', couleur: 'orange' },
  refuse: { libelle: 'Refusé', couleur: 'red' },
}

function MesRoles({ utilisateur }: PropsOnglet) {
  const majSession = useMajSession()
  const [choix, setChoix] = useState<Choix>({})
  const renoncement = useMutation({ mutationFn: api.renoncerRole, onSuccess: majSession })
  const demande = useMutation({
    mutationFn: async () => {
      let session = null
      for (const d of demandesDepuisChoix(choix)) session = await api.demanderRole(d)
      return session
    },
    onSuccess: (session) => {
      majSession(session)
      setChoix({})
      notifications.create({ type: 'success', title: 'Demande enregistrée' })
    },
  })
  // Un rôle refusé peut être redemandé : il reste proposé.
  const exclus = utilisateur.roles.filter((r) => r.statut !== 'refuse').map((r) => r.role)

  return (
    <Stack gap="5">
      {utilisateur.roles.length === 0 ? (
        <Aide>Aucun rôle pour l’instant : vous pouvez consulter la carte, sans rien saisir.</Aide>
      ) : (
        <Stack gap="2">
          {utilisateur.roles.map((r) => (
            <HStack key={r.role} p="3" borderWidth="1px" borderRadius="md" align="flex-start" gap="3">
              <Stack gap="1" flex="1">
                <HStack gap="2" wrap="wrap">
                  <Text fontWeight="medium">{ROLES[r.role].libelle}</Text>
                  <Badge size="sm" colorPalette={STATUTS[r.statut].couleur}>
                    {STATUTS[r.statut].libelle}
                  </Badge>
                </HStack>
                {r.motivation && <Aide fontStyle="italic">« {r.motivation} »</Aide>}
              </Stack>
              {r.role !== 'admin' && r.statut !== 'refuse' && (
                <Button
                  size="xs"
                  variant="ghost"
                  loading={renoncement.isPending && renoncement.variables === r.role}
                  onClick={() => renoncement.mutate(r.role)}
                >
                  {r.statut === 'accorde' ? 'Renoncer' : 'Retirer la demande'}
                </Button>
              )}
            </HStack>
          ))}
        </Stack>
      )}
      {renoncement.error && <Message ton="erreur">{renoncement.error.message}</Message>}

      <Stack
        as="form"
        gap="3"
        onSubmit={(e) => {
          e.preventDefault()
          demande.mutate()
        }}
      >
        <LibelleSection>Demander un rôle</LibelleSection>
        <ChoixRoles choix={choix} onChange={setChoix} exclus={exclus} />
        {demande.error && <Message ton="erreur">{demande.error.message}</Message>}
        <Button type="submit" variant="solid" alignSelf="flex-start" loading={demande.isPending} disabled={Object.keys(choix).length === 0}>
          Envoyer la demande
        </Button>
      </Stack>
    </Stack>
  )
}
