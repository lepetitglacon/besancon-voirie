import { useQuery } from '@tanstack/react-query'
import type { AnalyseIa, StatutAnalyseIa } from '@voirie/schema'
import { useEffect, useRef } from 'react'
import { api } from '../api'
import { notifications } from '../ds'

/** Rafraîchissement de la file : rapide tant qu'une analyse attend ou tourne. */
const SUIVI_ACTIF_MS = 3_000
const SUIVI_REPOS_MS = 30_000

export const enFile = (a: AnalyseIa) => a.statut === 'en_attente' || a.statut === 'en_cours'

/** File des propositions OSM + IA, partagée par la liste, le panneau et les notifications. */
export function useAnalysesIa() {
  return useQuery({
    queryKey: ['analyses-ia'],
    queryFn: api.analysesIa,
    refetchInterval: (requete) => (requete.state.data?.some(enFile) ? SUIVI_ACTIF_MS : SUIVI_REPOS_MS),
  })
}

/** Demande, au premier ajout dans la file, le droit d'afficher des notifications système. */
export function demanderNotificationsSysteme() {
  if ('Notification' in window && Notification.permission === 'default') void Notification.requestPermission()
}

/**
 * Prévient quand une analyse de la file se termine : notification dans l'application avec un
 * bouton « Ouvrir », et notification système si l'onglet est en arrière-plan.
 */
export function useNotificationsIa(analyses: AnalyseIa[] | undefined, ouvrir: (analyse: AnalyseIa) => void) {
  const precedents = useRef<Map<string, StatutAnalyseIa> | null>(null)
  const ouvrirActuel = useRef(ouvrir)
  useEffect(() => {
    ouvrirActuel.current = ouvrir
  }, [ouvrir])

  useEffect(() => {
    if (!analyses) return
    const avant = precedents.current
    precedents.current = new Map(analyses.map((a) => [a.id, a.statut]))
    if (!avant) return // premier chargement : rien ne vient de finir
    for (const analyse of analyses) {
      const statutAvant = avant.get(analyse.id)
      if (statutAvant !== 'en_attente' && statutAvant !== 'en_cours') continue
      if (analyse.statut !== 'terminee' && analyse.statut !== 'echec') continue
      const prete = analyse.statut === 'terminee'
      const titre = prete ? 'Proposition IA prête' : 'Analyse IA en échec'
      notifications.create({
        type: prete ? 'success' : 'error',
        title: titre,
        description: prete ? analyse.carrefour.nom : `${analyse.carrefour.nom} : ${analyse.erreur ?? 'erreur inconnue'}`,
        duration: prete ? 60_000 : 15_000,
        closable: true,
        action: prete ? { label: 'Ouvrir', onClick: () => ouvrirActuel.current(analyse) } : undefined,
      })
      if (prete && document.hidden && 'Notification' in window && Notification.permission === 'granted') {
        const systeme = new Notification(titre, { body: analyse.carrefour.nom, tag: analyse.id })
        systeme.onclick = () => {
          window.focus()
          ouvrirActuel.current(analyse)
          systeme.close()
        }
      }
    }
  }, [analyses])
}
