import { Avatar, Menu, Portal, type MenuTriggerProps } from '@chakra-ui/react'
import { Accessibility, Code, Info, LogIn, Palette, Scale } from 'lucide-react'
import { useNavigate } from 'react-router'
import { avecVue, DEPOT, PAGES } from './pages'

/** Avatar en haut à droite de la carte : menu du site (connexion, à propos, mentions). */
export function MenuSite(props: MenuTriggerProps) {
  const naviguer = useNavigate()

  return (
    <Menu.Root positioning={{ placement: 'bottom-end', gutter: 8 }}>
      <Menu.Trigger borderRadius="full" cursor="pointer" aria-label="Menu du site" title="Menu du site" {...props}>
        <Avatar.Root size="sm" bg="bg.panel" color="fg" boxShadow="carte">
          <Avatar.Fallback />
        </Avatar.Root>
      </Menu.Trigger>
      <Portal>
        <Menu.Positioner>
          <Menu.Content minW="200px">
            <Menu.Item value="connexion" onSelect={() => naviguer(avecVue(PAGES.connexion.chemin))}>
              <LogIn />
              <Menu.ItemText>Se connecter</Menu.ItemText>
            </Menu.Item>
            <Menu.Item value="accessibilite" onSelect={() => naviguer(avecVue(PAGES.accessibilite.chemin))}>
              <Accessibility />
              <Menu.ItemText>Accessibilité</Menu.ItemText>
            </Menu.Item>
            <Menu.Separator />
            <Menu.Item value="a-propos" onSelect={() => naviguer(avecVue(PAGES.aPropos.chemin))}>
              <Info />
              <Menu.ItemText>À propos</Menu.ItemText>
            </Menu.Item>
            <Menu.Item value="mentions" onSelect={() => naviguer(avecVue(PAGES.mentions.chemin))}>
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
          </Menu.Content>
        </Menu.Positioner>
      </Portal>
    </Menu.Root>
  )
}
