/**
 * Messages échangés avec l'éditeur Streetmix (fork, `client/src/integrations/embed_bridge.ts`)
 * affiché dans une iframe — docs/integration-streetmix.md, « Protocole appli ↔ éditeur ».
 */
import type { RueStreetmix } from '@voirie/schema'

export const CANAL = 'streetmix-embed'
export const VERSION = 1

/** URL de l'instance Streetmix locale (`pnpm streetmix:up`) ; absente : l'éditeur n'est pas proposé. */
export const URL_STREETMIX: string | null = import.meta.env.VITE_STREETMIX_URL?.replace(/\/$/, '') || null

export interface OptionsExport {
  labels?: boolean
  streetName?: boolean
  watermark?: boolean
  transparentSky?: boolean
  dpi?: number
}

/** Messages de l'appli vers l'éditeur. */
export type MessageVersEditeur =
  | { type: 'load'; street: RueStreetmix; name?: string | null; locale?: string }
  | ({ type: 'export'; requestId: string } & OptionsExport)

/** Messages de l'éditeur vers l'appli. */
export type MessageDeEditeur =
  | { type: 'ready'; schemaVersion: number }
  | { type: 'loaded' }
  | { type: 'changed'; dirty: boolean }
  | { type: 'exported'; requestId?: string; street: RueStreetmix; name: string | null; width: number; image: Blob }
  | { type: 'error'; requestId?: string; message: string }

export const enveloppe = <M extends MessageVersEditeur>(message: M) => ({ channel: CANAL, version: VERSION, ...message })

export function estMessageEditeur(donnee: unknown): donnee is MessageDeEditeur & { channel: string; version: number } {
  return (
    typeof donnee === 'object' &&
    donnee !== null &&
    (donnee as { channel?: unknown }).channel === CANAL &&
    (donnee as { version?: unknown }).version === VERSION &&
    typeof (donnee as { type?: unknown }).type === 'string'
  )
}
