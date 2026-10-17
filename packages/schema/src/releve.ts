import { z } from 'zod';
import { CodeLigne } from './feux.js';

/**
 * Relevé terrain envoyé par le téléphone : les saisies brutes, horodatées. L'API refait la synthèse
 * (engine `analyserReleve`) et l'enregistre en attente de modération (docs/ARCHITECTURE.md §12).
 */
export const EvenementReleve = z.enum(['bus', 'tram', 'boucle', 'pieton']);

const Instant = z.number().int().positive();

export const SaisieReleve = z.union([
  z.strictObject({ t: Instant, ligne: CodeLigne, couleur: z.enum(['vert', 'jaune', 'rouge']) }),
  z.strictObject({ t: Instant, evenement: EvenementReleve }),
]);
export type SaisieReleve = z.infer<typeof SaisieReleve>;

/** Une bonne heure de relevé (une vingtaine de saisies par cycle) : le corps reste sous 100 ko. */
export const SAISIES_RELEVE_MAX = 1500;

export const EnvoiReleve = z.object({
  carrefour_id: z.uuid(),
  /** Libre et facultatif, jamais d'email. */
  pseudo: z.string().trim().max(40).optional(),
  saisies: z.array(SaisieReleve).min(2).max(SAISIES_RELEVE_MAX),
  /** Champ piège, caché aux humains : rempli, le relevé est ignoré sans le dire. */
  site_web: z.string().max(500).optional(),
});
export type EnvoiReleve = z.infer<typeof EnvoiReleve>;

export type StatutModeration = 'en_attente' | 'valide' | 'rejete';

/** Un relevé tel que l'API le rend : sa synthèse, sans les saisies brutes. */
export interface ReleveResume {
  id: string;
  pseudo: string | null;
  /** Première saisie du relevé. */
  observe_le: string;
  statut: StatutModeration;
  cycles_observes: number;
  cycle_s: number | null;
  ecart_type_cycle_s: number | null;
  /** Durée médiane du vert, puis du jaune, de chaque ligne relevée. */
  verts: Record<string, number | null>;
  jaunes: Record<string, number | null>;
  evenements: Record<z.infer<typeof EvenementReleve>, number>;
}

/** Un relevé avec ses saisies : de quoi le superposer au programme. */
export interface ReleveDetail extends ReleveResume {
  carrefour_id: string;
  saisies: SaisieReleve[];
}
