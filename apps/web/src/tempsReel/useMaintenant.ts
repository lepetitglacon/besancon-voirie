import { useEffect, useState } from 'react'

/** Les feux changent à la seconde près : quatre relectures par seconde suffisent. */
const RELECTURE_MS = 250

/** L'heure qui avance, relue à intervalle régulier. */
export function useMaintenant(actif = true, intervalle_ms = RELECTURE_MS): number {
  const [maintenant, setMaintenant] = useState(() => Date.now())
  useEffect(() => {
    if (!actif) return
    const minuterie = window.setInterval(() => setMaintenant(Date.now()), intervalle_ms)
    return () => window.clearInterval(minuterie)
  }, [actif, intervalle_ms])
  return maintenant
}
