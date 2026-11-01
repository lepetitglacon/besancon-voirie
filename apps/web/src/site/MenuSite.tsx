import { Avatar, Badge, Box, Float, Menu, Portal, Stack, Text, Wrap, type MenuTriggerProps } from '@chakra-ui/react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { ROLES } from '@voirie/schema'
import { Accessibility, Code, Info, LogIn, LogOut, Palette, Scale, Settings, ShieldCheck } from 'lucide-react'
import { useNavigate } from 'react-router'
import { api } from '../api'
import { useDroits, useMajSession, useSession } from '../auth/session'
import { notifications } from '../ds'
import { avecVue, DEPOT, PAGES } from './pages'

/** Avatar en haut à droite de la carte : compte (connexion, paramètres, droits) et menu du site. */
export function MenuSite(props: MenuTriggerProps) {
  const naviguer = useNavigate()
  const aller = (chemin: string) => naviguer(avecVue(chemin))
  const { utilisateur } = useSession()
  const admin = useDroits().can('manage', 'Utilisateur')
  const majSession = useMajSession()
  const { data: demandes = [] } = useQuery({ queryKey: ['demandes-roles'], queryFn: api.demandesRoles, enabled: admin })
  const deconnexion = useMutation({
    mutationFn: api.deconnexion,
    onSuccess: () => {
      majSession(null)
      notifications.create({ type: 'info', title: 'Vous êtes déconnecté' })
    },
  })
  const accordes = utilisateur?.roles.filter((r) => r.statut === 'accorde') ?? []
  const enAttente = utilisateur?.roles.filter((r) => r.statut === 'en_attente').length ?? 0

  return (
    <Menu.Root positioning={{ placement: 'bottom-end', gutter: 8 }}>
      <Menu.Trigger
        borderRadius="full"
        cursor="pointer"
        aria-label={utilisateur ? `Compte de ${utilisateur.nom}` : 'Menu du site'}
        title={utilisateur ? utilisateur.nom : 'Menu du site'}
        {...props}
      >
        <Avatar.Root
          size="sm"
          bg={utilisateur ? 'brand.solid' : 'bg.panel'}
          color={utilisateur ? 'brand.contrast' : 'fg'}
          boxShadow="carte"
        >
          <Avatar.Fallback name={utilisateur?.nom} />
          {admin && demandes.length > 0 && (
            <Float placement="top-end" offset="1">
              <Box boxSize="2.5" borderRadius="full" bg="orange.solid" borderWidth="2px" borderColor="bg.panel" />
            </Float>
          )}
        </Avatar.Root>
      </Menu.Trigger>
      <Portal>
        <Menu.Positioner>
          <Menu.Content minW="240px" maxW="300px">
            {utilisateur ? (
              <>
                <Stack gap="1" px="2" py="2">
                  <Text fontWeight="semibold" textStyle="md">
                    {utilisateur.nom}
                  </Text>
                  <Text textStyle="xs" color="fg.muted">
                    {utilisateur.email}
                  </Text>
                  {(accordes.length > 0 || enAttente > 0) && (
                    <Wrap gap="1" mt="1">
                      {accordes.map((r) => (
                        <Badge key={r.role} size="sm" colorPalette={r.role === 'admin' ? 'brand' : 'green'}>
                          {ROLES[r.role].libelle}
                        </Badge>
                      ))}
                      {enAttente > 0 && (
                        <Badge size="sm" colorPalette="orange">
                          {enAttente} en attente
                        </Badge>
                      )}
                    </Wrap>
                  )}
                </Stack>
                <Menu.Separator />
                <Menu.Item value="parametres" onSelect={() => aller(PAGES.parametres.chemin)}>
                  <Settings />
                  <Menu.ItemText>Paramètres</Menu.ItemText>
                </Menu.Item>
                {admin && (
                  <Menu.Item value="droits" onSelect={() => aller(PAGES.droits.chemin)}>
                    <ShieldCheck />
                    <Menu.ItemText flex="1">Gestion des droits</Menu.ItemText>
                    {demandes.length > 0 && (
                      <Badge size="sm" colorPalette="orange">
                        {demandes.length}
                      </Badge>
                    )}
                  </Menu.Item>
                )}
              </>
            ) : (
              <Menu.Item value="connexion" onSelect={() => aller(PAGES.connexion.chemin)} color="brand.fg" fontWeight="semibold">
                <LogIn />
                <Menu.ItemText>Se connecter</Menu.ItemText>
              </Menu.Item>
            )}
            <Menu.Item value="accessibilite" onSelect={() => aller(PAGES.accessibilite.chemin)}>
              <Accessibility />
              <Menu.ItemText>Accessibilité</Menu.ItemText>
            </Menu.Item>
            <Menu.Separator />
            <Menu.Item value="a-propos" onSelect={() => aller(PAGES.aPropos.chemin)}>
              <Info />
              <Menu.ItemText>À propos</Menu.ItemText>
            </Menu.Item>
            <Menu.Item value="mentions" onSelect={() => aller(PAGES.mentions.chemin)}>
              <Scale />
              <Menu.ItemText>Mentions légales</Menu.ItemText>
            </Menu.Item>
            <Menu.Separator />
            <Menu.Item value="design-system" onSelect={() =>
                // La carte, démontée, efface sa vue de l'URL : on la passe à la page pour le retour.
                naviguer(PAGES.designSystem.chemin, { state: { vue: window.location.hash } })
              }>
              <Palette />
              <Menu.ItemText>Design system</Menu.ItemText>
            </Menu.Item>
            <Menu.Item value="code" asChild>
              <a href={DEPOT} target="_blank" rel="noreferrer">
                <Code />
                <Menu.ItemText>Code source</Menu.ItemText>
              </a>
            </Menu.Item>
            {utilisateur && (
              <>
                <Menu.Separator />
                <Menu.Item value="deconnexion" color="fg.error" onSelect={() => deconnexion.mutate()}>
                  <LogOut />
                  <Menu.ItemText>Se déconnecter</Menu.ItemText>
                </Menu.Item>
              </>
            )}
          </Menu.Content>
        </Menu.Positioner>
      </Portal>
    </Menu.Root>
  )
}
