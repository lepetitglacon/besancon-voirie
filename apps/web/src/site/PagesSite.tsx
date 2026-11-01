import { CloseButton, Dialog } from '@chakra-ui/react'
import type { ReactNode } from 'react'
import { Route, Routes, useNavigate } from 'react-router'
import { Accessibilite } from '../accessibilite/Accessibilite'
import { Connexion } from '../auth/Connexion'
import { GestionDroits } from '../auth/GestionDroits'
import { Inscription } from '../auth/Inscription'
import { MotDePasseOublie, Reinitialisation, VerificationEmail } from '../auth/LiensEmail'
import { Parametres } from '../auth/Parametres'
import { APropos } from './APropos'
import { MentionsLegales } from './MentionsLegales'
import { avecVue, PAGES } from './pages'

/** Fenêtre d'une page du site ; la fermer revient à la carte (« / »). */
function Page({ titre, taille = 'lg', children }: { titre: string; taille?: 'sm' | 'md' | 'lg' | 'xl'; children: ReactNode }) {
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

const ROUTES: Array<{ page: { chemin: string; titre: string }; taille?: 'sm' | 'md' | 'lg' | 'xl'; contenu: ReactNode }> = [
  { page: PAGES.connexion, taille: 'sm', contenu: <Connexion /> },
  { page: PAGES.inscription, taille: 'md', contenu: <Inscription /> },
  { page: PAGES.motDePasseOublie, taille: 'sm', contenu: <MotDePasseOublie /> },
  { page: PAGES.reinitialisation, taille: 'sm', contenu: <Reinitialisation /> },
  { page: PAGES.verification, taille: 'sm', contenu: <VerificationEmail /> },
  { page: PAGES.parametres, contenu: <Parametres /> },
  { page: PAGES.droits, taille: 'xl', contenu: <GestionDroits /> },
  { page: PAGES.accessibilite, contenu: <Accessibilite /> },
  { page: PAGES.aPropos, contenu: <APropos /> },
  { page: PAGES.mentions, contenu: <MentionsLegales /> },
]

/** Routes des pages du site, rendues par-dessus la carte. */
export function PagesSite() {
  return (
    <Routes>
      {ROUTES.map(({ page, taille, contenu }) => (
        <Route
          key={page.chemin}
          path={page.chemin}
          element={
            <Page titre={page.titre} taille={taille}>
              {contenu}
            </Page>
          }
        />
      ))}
      {/* Toute autre adresse : la carte seule. */}
      <Route path="*" element={null} />
    </Routes>
  )
}
