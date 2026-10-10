/**
 * Pilote l'éditeur Streetmix d'une iframe : attend qu'il soit prêt, lui charge une rue, suit ses
 * modifications, lui demande la rue et le PNG — docs/integration-streetmix.md.
 */
import type { RueStreetmix } from '@voirie/schema'
import { VERSION_SCHEMA_STREETMIX } from '@voirie/schema'
import { useEffect, useRef, useState } from 'react'
import { enveloppe, estMessageEditeur, type MessageVersEditeur, type OptionsExport } from './protocole'

/** Au-delà, l'éditeur est tenu pour injoignable (Streetmix non lancé). */
const DELAI_PRET_MS = 20_000
/** Chargement ou export sans réponse au-delà : échec. */
const DELAI_REPONSE_MS = 30_000

export type EtatEditeur = 'chargement' | 'pret' | 'injoignable' | 'incompatible'

export interface ExportEditeur {
  rue: RueStreetmix
  image: Blob
}

interface Attente {
  resoudre: (valeur: unknown) => void
  rejeter: (erreur: Error) => void
  minuteur: ReturnType<typeof setTimeout>
}

export function useEditeurStreetmix(url: string) {
  const iframe = useRef<HTMLIFrameElement>(null)
  const origine = new URL(url).origin
  const [etat, setEtat] = useState<EtatEditeur>('chargement')
  const [modifie, setModifie] = useState(false)
  /** Réponses attendues : `loaded` (clé `load`), ou `exported` par numéro de demande. */
  const attentes = useRef(new Map<string, Attente>())

  useEffect(() => {
    const minuteur = setTimeout(() => setEtat((e) => (e === 'chargement' ? 'injoignable' : e)), DELAI_PRET_MS)
    const terminer = (cle: string, action: (a: Attente) => void) => {
      const attente = attentes.current.get(cle)
      if (!attente) return
      clearTimeout(attente.minuteur)
      attentes.current.delete(cle)
      action(attente)
    }
    const recevoir = (evenement: MessageEvent) => {
      if (evenement.origin !== origine || evenement.source !== iframe.current?.contentWindow) return
      const message = evenement.data
      if (!estMessageEditeur(message)) return
      switch (message.type) {
        case 'ready':
          clearTimeout(minuteur)
          setEtat(message.schemaVersion === VERSION_SCHEMA_STREETMIX ? 'pret' : 'incompatible')
          break
        case 'loaded':
          setModifie(false)
          terminer('load', (a) => a.resoudre(undefined))
          break
        case 'changed':
          setModifie(message.dirty)
          break
        case 'exported':
          terminer(message.requestId ?? '', (a) => a.resoudre({ rue: message.street, image: message.image }))
          break
        case 'error': {
          const erreur = new Error(`Streetmix : ${message.message}`)
          if (message.requestId) terminer(message.requestId, (a) => a.rejeter(erreur))
          else terminer('load', (a) => a.rejeter(erreur))
          break
        }
      }
    }
    window.addEventListener('message', recevoir)
    const enCours = attentes.current
    return () => {
      clearTimeout(minuteur)
      window.removeEventListener('message', recevoir)
      for (const attente of enCours.values()) {
        clearTimeout(attente.minuteur)
        attente.rejeter(new Error('Éditeur fermé'))
      }
      enCours.clear()
    }
  }, [origine])

  const envoyer = <T,>(cle: string, message: MessageVersEditeur): Promise<T> =>
    new Promise<T>((resoudre, rejeter) => {
      const fenetre = iframe.current?.contentWindow
      if (!fenetre) return rejeter(new Error('Éditeur Streetmix absent'))
      attentes.current.get(cle)?.rejeter(new Error('Demande remplacée'))
      const minuteur = setTimeout(() => {
        attentes.current.delete(cle)
        rejeter(new Error('Streetmix ne répond pas'))
      }, DELAI_REPONSE_MS)
      attentes.current.set(cle, { resoudre: resoudre as (valeur: unknown) => void, rejeter, minuteur })
      fenetre.postMessage(enveloppe(message), origine)
    })

  /** Remplace la rue affichée ; résolu quand l'éditeur l'a dessinée. */
  const charger = (rue: RueStreetmix, nom: string | null) => envoyer<void>('load', { type: 'load', street: rue, name: nom, locale: 'fr' })

  /** Rue affichée et son PNG. */
  const exporter = (options: OptionsExport = {}) => {
    const requestId = crypto.randomUUID()
    return envoyer<ExportEditeur>(requestId, { type: 'export', requestId, labels: true, streetName: true, watermark: true, dpi: 2, ...options })
  }

  return { iframe, etat, modifie, charger, exporter }
}
