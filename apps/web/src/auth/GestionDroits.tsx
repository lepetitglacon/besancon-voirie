import { Badge, Button, HStack, Input, Stack, Table, Tabs, Text, Wrap } from '@chakra-ui/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ROLES, Role, type DemandeRoleAdmin, type UtilisateurAdmin } from '@voirie/schema'
import { useState } from 'react'
import { api } from '../api'
import { Aide, Bascule, Message, notifications } from '../ds'
import { useDroits, useSession } from './session'

const dateCourte = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })

/** Gestion des droits (admin) : demandes de rôles à valider, puis rôles et état de chaque compte. */
export function GestionDroits() {
  const admin = useDroits().can('manage', 'Utilisateur')
  const [onglet, setOnglet] = useState('demandes')
  const { data: demandes = [] } = useQuery({ queryKey: ['demandes-roles'], queryFn: api.demandesRoles, enabled: admin })
  const { data: utilisateurs = [] } = useQuery({ queryKey: ['utilisateurs'], queryFn: api.utilisateurs, enabled: admin })

  if (!admin) return <Aide>Réservé aux administrateurs.</Aide>
  return (
    <Tabs.Root value={onglet} onValueChange={(e) => setOnglet(e.value)} variant="line">
      <Tabs.List>
        <Tabs.Trigger value="demandes">
          Demandes
          {demandes.length > 0 && (
            <Badge size="sm" colorPalette="orange">
              {demandes.length}
            </Badge>
          )}
        </Tabs.Trigger>
        <Tabs.Trigger value="utilisateurs">Utilisateurs ({utilisateurs.length})</Tabs.Trigger>
      </Tabs.List>
      <Tabs.Content value="demandes">
        <Demandes demandes={demandes} />
      </Tabs.Content>
      <Tabs.Content value="utilisateurs">
        <Utilisateurs utilisateurs={utilisateurs} />
      </Tabs.Content>
    </Tabs.Root>
  )
}

/** Après une décision : demandes, comptes et pastille du menu à jour. */
function useRafraichir() {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: ['demandes-roles'] })
    void queryClient.invalidateQueries({ queryKey: ['utilisateurs'] })
  }
}

function Demandes({ demandes }: { demandes: DemandeRoleAdmin[] }) {
  const rafraichir = useRafraichir()
  const decision = useMutation({
    mutationFn: ({ demande, choix }: { demande: DemandeRoleAdmin; choix: 'accorde' | 'refuse' }) =>
      api.deciderDemande(demande.utilisateur.id, demande.role, choix),
    onSuccess: (_, { demande, choix }) => {
      rafraichir()
      notifications.create({
        type: choix === 'accorde' ? 'success' : 'info',
        title: `${ROLES[demande.role].libelle} ${choix === 'accorde' ? 'accordé' : 'refusé'} à ${demande.utilisateur.nom}`,
        description: 'Un e-mail le prévient.',
      })
    },
    onError: (erreur) => notifications.create({ type: 'error', title: 'Décision impossible', description: erreur.message }),
  })

  if (demandes.length === 0) return <Aide>Aucune demande en attente.</Aide>
  return (
    <Stack gap="3">
      {demandes.map((demande) => {
        const enCours =
          decision.isPending &&
          decision.variables.demande.utilisateur.id === demande.utilisateur.id &&
          decision.variables.demande.role === demande.role
        return (
          <Stack key={`${demande.utilisateur.id}-${demande.role}`} gap="2" p="3" borderWidth="1px" borderRadius="md">
            <HStack justify="space-between" align="flex-start" gap="3" wrap="wrap">
              <Stack gap="0.5">
                <Text fontWeight="medium">{demande.utilisateur.nom}</Text>
                <Aide>
                  {demande.utilisateur.email} · {dateCourte(demande.creeLe)}
                </Aide>
              </Stack>
              <Badge colorPalette="orange">{ROLES[demande.role].libelle}</Badge>
            </HStack>
            {demande.motivation ? (
              <Text textStyle="sm" color="fg.secondary" whiteSpace="pre-line">
                « {demande.motivation} »
              </Text>
            ) : (
              <Aide>Sans motivation.</Aide>
            )}
            <HStack gap="2">
              <Button size="sm" variant="solid" loading={enCours && decision.variables.choix === 'accorde'} disabled={enCours}
                onClick={() => decision.mutate({ demande, choix: 'accorde' })}>
                Accorder
              </Button>
              <Button size="sm" variant="outline" loading={enCours && decision.variables.choix === 'refuse'} disabled={enCours}
                onClick={() => decision.mutate({ demande, choix: 'refuse' })}>
                Refuser
              </Button>
            </HStack>
          </Stack>
        )
      })}
    </Stack>
  )
}

function Utilisateurs({ utilisateurs }: { utilisateurs: UtilisateurAdmin[] }) {
  const { utilisateur: moi } = useSession()
  const rafraichir = useRafraichir()
  const [recherche, setRecherche] = useState('')
  const signalerErreur = (erreur: Error) => notifications.create({ type: 'error', title: 'Modification impossible', description: erreur.message })
  const bascule = useMutation({
    mutationFn: ({ compte, role, accorde }: { compte: UtilisateurAdmin; role: Role; accorde: boolean }) =>
      accorde ? api.retirerRole(compte.id, role) : api.accorderRole(compte.id, role),
    onSuccess: rafraichir,
    onError: signalerErreur,
  })
  const activation = useMutation({
    mutationFn: ({ compte, actif }: { compte: UtilisateurAdmin; actif: boolean }) => api.activerUtilisateur(compte.id, actif),
    onSuccess: rafraichir,
    onError: signalerErreur,
  })

  const filtre = recherche.trim().toLowerCase()
  const visibles = utilisateurs.filter((u) => !filtre || u.nom.toLowerCase().includes(filtre) || u.email.includes(filtre))

  return (
    <Stack gap="3">
      <Input placeholder="Rechercher un nom ou une adresse" value={recherche} onChange={(e) => setRecherche(e.target.value)} />
      <Aide>Cliquez sur un rôle pour l’accorder ou le retirer. Orange : demandé, en attente de décision.</Aide>
      <Table.ScrollArea borderWidth="1px" borderRadius="md">
        <Table.Root size="sm">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader>Compte</Table.ColumnHeader>
              <Table.ColumnHeader>Rôles</Table.ColumnHeader>
              <Table.ColumnHeader>Actif</Table.ColumnHeader>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {visibles.map((compte) => (
              <Table.Row key={compte.id} opacity={compte.actif ? 1 : 0.6}>
                <Table.Cell verticalAlign="top" minW="200px">
                  <Stack gap="1">
                    <Text fontWeight="medium">{compte.nom}</Text>
                    <Aide>{compte.email}</Aide>
                    <Wrap gap="1">
                      {compte.google && <Badge size="sm">Google</Badge>}
                      {compte.motDePasse && <Badge size="sm">Mot de passe</Badge>}
                      {!compte.emailVerifie && (
                        <Badge size="sm" colorPalette="red">
                          Adresse non confirmée
                        </Badge>
                      )}
                    </Wrap>
                    <Aide>
                      {compte.derniereConnexionLe ? `Vu le ${dateCourte(compte.derniereConnexionLe)}` : 'Jamais connecté'}
                    </Aide>
                  </Stack>
                </Table.Cell>
                <Table.Cell verticalAlign="top">
                  <Wrap gap="1">
                    {Role.options.map((role) => {
                      const statut = compte.roles.find((r) => r.role === role)?.statut
                      const accorde = statut === 'accorde'
                      return (
                        <Button
                          key={role}
                          size="2xs"
                          variant={accorde ? 'solid' : 'outline'}
                          colorPalette={statut === 'en_attente' ? 'orange' : accorde ? 'brand' : 'gray'}
                          aria-pressed={accorde}
                          title={ROLES[role].description}
                          disabled={bascule.isPending}
                          onClick={() => bascule.mutate({ compte, role, accorde })}
                        >
                          {ROLES[role].libelle}
                        </Button>
                      )
                    })}
                  </Wrap>
                </Table.Cell>
                <Table.Cell verticalAlign="top">
                  <Bascule
                    size="sm"
                    coche={compte.actif}
                    disabled={compte.id === moi?.id || activation.isPending}
                    aria-label={`Compte de ${compte.nom} actif`}
                    onChange={(actif) => activation.mutate({ compte, actif })}
                  />
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      </Table.ScrollArea>
      {visibles.length === 0 && <Message ton="avertissement">Aucun compte ne correspond.</Message>}
    </Stack>
  )
}
