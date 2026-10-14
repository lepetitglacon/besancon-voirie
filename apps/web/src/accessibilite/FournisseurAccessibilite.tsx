import '@fontsource/atkinson-hyperlegible/400.css'
import '@fontsource/atkinson-hyperlegible/700.css'
import '@fontsource/opendyslexic/400.css'
import '@fontsource/opendyslexic/700.css'
import { useEffect, type ReactNode } from 'react'
import { usePreference } from '../preferences'
import { ContexteAccessibilite, POLICES, REGLAGES_DEFAUT } from './reglages'

/**
 * Réglages d'accessibilité, mémorisés dans le navigateur et posés en variables CSS sur <html> :
 * le thème (src/theme) les lit pour la taille du texte, le zoom de l'interface et la police.
 */
export function FournisseurAccessibilite({ children }: { children: ReactNode }) {
  const [reglages, setReglages] = usePreference('accessibilite', REGLAGES_DEFAUT)

  useEffect(() => {
    const racine = document.documentElement
    racine.style.setProperty('--echelle-texte', String(reglages.texte))
    racine.style.setProperty('--echelle-ui', String(reglages.interface))
    const famille = POLICES[reglages.police]?.famille
    if (famille) racine.style.setProperty('--police', famille)
    else racine.style.removeProperty('--police')
    racine.toggleAttribute('data-espacement', reglages.espacement)
  }, [reglages])

  return <ContexteAccessibilite.Provider value={[reglages, setReglages]}>{children}</ContexteAccessibilite.Provider>
}
