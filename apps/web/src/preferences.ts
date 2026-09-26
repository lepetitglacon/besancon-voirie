import { useEffect, useState } from 'react'

/**
 * État mémorisé dans le navigateur (réglages d'affichage). Le stockage peut être indisponible
 * (navigation privée, données bloquées) : on retombe alors sur la valeur par défaut.
 */
export function usePreference<T extends object | string | boolean>(cle: string, defaut: T) {
  const [valeur, setValeur] = useState<T>(() => {
    try {
      const lue = localStorage.getItem(`voirie.${cle}`)
      if (lue === null) return defaut
      const analysee = JSON.parse(lue) as T
      // Réglages ajoutés depuis la dernière visite : valeurs par défaut.
      return typeof defaut === 'object' ? ({ ...(defaut as object), ...(analysee as object) } as T) : analysee
    } catch {
      return defaut
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(`voirie.${cle}`, JSON.stringify(valeur))
    } catch {
      // Stockage indisponible : le réglage vaut pour la session.
    }
  }, [cle, valeur])
  return [valeur, setValeur] as const
}
