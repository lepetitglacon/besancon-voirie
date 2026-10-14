import { CloseButton, Dialog } from '@chakra-ui/react'
import type { ReactNode } from 'react'
import { Route, Routes, useNavigate } from 'react-router'
import { Accessibilite } from '../accessibilite/Accessibilite'
import { APropos } from './APropos'
import { Connexion } from './Connexion'
import { MentionsLegales } from './MentionsLegales'
import { avecVue, PAGES } from './pages'

/** Fenêtre d'une page du site ; la fermer revient à la carte (« / »). */
function Page({ titre, taille = 'lg', children }: { titre: string; taille?: 'sm' | 'lg'; children: ReactNode }) {
  const naviguer = useNavigate()
  return (
    <Dialog.Root open size={taille} scrollBehavior="inside" onOpenChange={(e) => !e.open && naviguer(avecVue('/'))}>
      {/* Sans portail : en dev, StrictMode laissait un double du portail, ouvert, après la fermeture. */}
      <>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content>
            <Dialog.Header>
              <Dialog.Title>{titre}</Dialog.Title>
            </Dialog.Header>
            <Dialog.Body pb="6">{children}</Dialog.Body>
            <Dialog.CloseTrigger asChild>
              <CloseButton size="sm" />
            </Dialog.CloseTrigger>
          </Dialog.Content>
        </Dialog.Positioner>
      </>
    </Dialog.Root>
  )
}

/** Routes des pages du site, rendues par-dessus la carte. */
export function PagesSite() {
  return (
    <Routes>
      <Route
        path={PAGES.connexion.chemin}
        element={
          <Page titre={PAGES.connexion.titre} taille="sm">
            <Connexion />
          </Page>
        }
      />
      <Route
        path={PAGES.accessibilite.chemin}
        element={
          <Page titre={PAGES.accessibilite.titre}>
            <Accessibilite />
          </Page>
        }
      />
      <Route
        path={PAGES.aPropos.chemin}
        element={
          <Page titre={PAGES.aPropos.titre}>
            <APropos />
          </Page>
        }
      />
      <Route
        path={PAGES.mentions.chemin}
        element={
          <Page titre={PAGES.mentions.titre}>
            <MentionsLegales />
          </Page>
        }
      />
      {/* Toute autre adresse : la carte seule. */}
      <Route path="*" element={null} />
    </Routes>
  )
}
