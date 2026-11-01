import { useQuery, useQueryClient } from '@tanstack/react-query'
import { creerDroits, type Droits, type Session } from '@voirie/schema'
import { useCallback, useMemo } from 'react'
import { api } from '../api'

/** Session du compte connecté, rechargée après une erreur 401 (main.tsx). */
export const CLE_SESSION = ['session'] as const

export function useSession() {
  const { data, isPending } = useQuery({ queryKey: CLE_SESSION, queryFn: api.session, staleTime: 5 * 60_000 })
  return { utilisateur: data?.utilisateur ?? null, googleDisponible: data?.googleDisponible ?? false, chargement: isPending }
}

/** Droits CASL du compte connecté (aucun pour un visiteur) : `droits.can('update', 'Branche')`. */
export function useDroits(): Droits {
  const { data } = useQuery({ queryKey: CLE_SESSION, queryFn: api.session, staleTime: 5 * 60_000 })
  return useMemo(() => creerDroits(data?.regles ?? []), [data])
}

/** Remplace la session en cache par celle renvoyée par l'API (connexion, paramètres…). */
export function useMajSession() {
  const queryClient = useQueryClient()
  return useCallback(
    (session: Session | null) => {
      if (session) queryClient.setQueryData<Session>(CLE_SESSION, session)
      else void queryClient.invalidateQueries({ queryKey: CLE_SESSION })
    },
    [queryClient],
  )
}
