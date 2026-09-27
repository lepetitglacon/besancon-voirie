import { ChakraProvider } from '@chakra-ui/react'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/500.css'
import '@fontsource/ibm-plex-sans/600.css'
import { ThemeProvider } from 'next-themes'
import type { ReactNode } from 'react'
import { system } from '../theme'
import { Notifications } from './Notifications'

/** Thème Chakra, mode clair / sombre (celui du système par défaut) et notifications. */
export function Fournisseur({ children }: { children: ReactNode }) {
  return (
    <ChakraProvider value={system}>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
        {children}
        <Notifications />
      </ThemeProvider>
    </ChakraProvider>
  )
}
