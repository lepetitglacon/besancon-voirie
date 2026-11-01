import { Button, HStack, Link, Separator, Text, type LinkProps } from '@chakra-ui/react'
import type { ReactNode } from 'react'
import { Link as LienRouteur } from 'react-router'
import { api } from '../api'
import { Aide } from '../ds'
import { avecVue } from '../site/pages'
import { useSession } from './session'

/** Logo Google, en couleurs (charte « Sign in with Google »). */
function LogoGoogle() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 48 48">
      <path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 8 3l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.6-.4-3.9z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 8 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2c-2 1.5-4.5 2.4-7.2 2.4-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z" />
    </svg>
  )
}

/**
 * Départ vers Google : navigation complète, l'API redirige vers Google puis revient sur le site.
 * Grisé tant que le serveur n'a pas d'identifiants Google.
 */
export function BoutonGoogle({ mode = 'connexion', children }: { mode?: 'connexion' | 'liaison'; children: ReactNode }) {
  const { googleDisponible } = useSession()
  if (!googleDisponible) {
    return (
      <Button variant="outline" size="lg" disabled title="Connexion Google non configurée sur ce serveur">
        <LogoGoogle />
        {children}
      </Button>
    )
  }
  return (
    <Button asChild variant="outline" size="lg">
      <a href={api.urlGoogle(mode, mode === 'liaison' ? '/parametres?onglet=comptes' : '/')}>
        <LogoGoogle />
        {children}
      </a>
    </Button>
  )
}

/** « ——— ou avec une adresse e-mail ——— » */
export function SeparateurOu({ children }: { children: ReactNode }) {
  return (
    <HStack gap="3">
      <Separator flex="1" />
      <Aide flexShrink="0">{children}</Aide>
      <Separator flex="1" />
    </HStack>
  )
}

/** Lien vers une autre page du site, en gardant la vue de la carte. */
export function LienPage({ vers, children, ...props }: LinkProps & { vers: string }) {
  return (
    <Link asChild color="brand.fg" fontWeight="medium" {...props}>
      <LienRouteur to={avecVue(vers)}>{children}</LienRouteur>
    </Link>
  )
}

/** Ligne de bas de modale : « Pas encore de compte ? Créer un compte ». */
export function Relance({ children }: { children: ReactNode }) {
  return (
    <Text textStyle="sm" color="fg.secondary" textAlign="center">
      {children}
    </Text>
  )
}
