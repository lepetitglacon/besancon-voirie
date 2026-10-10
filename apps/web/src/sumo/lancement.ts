import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ETAPES_ACTIVES, type LancementSumo } from '@voirie/schema'
import { useEffect, useState } from 'react'
import { api } from '../api'

/**
 * Lancement en cours (ou le dernier), suivi en SSE tant qu'il tourne. À la fin, les essais sont
 * relus : le nouvel essai apparaît dans la liste.
 */
export function useLancementSumo() {
  const queryClient = useQueryClient()
  const lancements = useQuery({ queryKey: ['sumo-lancements'], queryFn: api.lancementsSumo })
  const dernier = lancements.data?.[0]
  const [direct, setDirect] = useState<LancementSumo | null>(null)
  const actifId = dernier && ETAPES_ACTIVES.includes(dernier.etape) ? dernier.id : null

  useEffect(() => {
    if (!actifId) return
    const source = new EventSource(api.fluxLancementSumo(actifId))
    source.onmessage = (evenement) => {
      const lancement = JSON.parse(evenement.data as string) as LancementSumo
      setDirect(lancement)
      if (!ETAPES_ACTIVES.includes(lancement.etape)) {
        source.close()
        void queryClient.invalidateQueries({ queryKey: ['sumo-lancements'] })
        void queryClient.invalidateQueries({ queryKey: ['sumo-essais'] })
      }
    }
    // Coupure (API redémarrée) : EventSource se reconnecte seul.
    return () => source.close()
  }, [actifId, queryClient])

  const lancement = direct && direct.id === dernier?.id ? direct : (dernier ?? null)
  return { lancement, actif: lancement !== null && ETAPES_ACTIVES.includes(lancement.etape) }
}
