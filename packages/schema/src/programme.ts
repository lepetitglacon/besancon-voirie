import { z } from 'zod';
import { CodeLigne, PlanBase, PlanSansCycle, type Plage } from './feux.js';

/** Étape d'un programme : lignes au vert ensemble, pendant `duree_s` (hors transitions). */
export const Etape = z.object({
  lignes: z.array(CodeLigne).max(40),
  duree_s: z.number().min(1).max(300),
  /** Étape servie seulement si cette ligne est demandée (bouton piéton, boucle de détection). */
  appel: CodeLigne.nullable().optional(),
  /** Étape hors du cycle de base, atteinte seulement par un arc du graphe (priorité tram). */
  hors_cycle: z.boolean().optional(),
});
export type Etape = z.infer<typeof Etape>;

/** Couple « ligne qui s'arrête>ligne qui démarre » d'un rouge de dégagement, par exemple F1>F2. */
export const CleDegagement = z.string().regex(/^[A-Z]{1,2}\d{1,2}>[A-Z]{1,2}\d{1,2}$/, 'Couple attendu sous la forme F1>F2');

/** Arc du graphe des étapes (indices dans `etapes`) — docs/CONFIGURATION.md §6. */
export const ArcGraphe = z.object({
  de: z.int().min(0).max(15),
  vers: z.int().min(0).max(15),
  /** Ligne dont la demande déclenche l'arc ; null : arc sans condition (reprise du cycle). */
  demande: CodeLigne.nullable().default(null),
  /** Écourte l'étape de départ dès son vert minimal quand la demande arrive. */
  anticipe: z.boolean().default(false),
});
export type ArcGraphe = z.infer<typeof ArcGraphe>;

/** Plan à cycle saisi par étapes ; le moteur en déduit le cycle et le diagramme de feux. */
export const PlanEtapes = PlanBase.extend({
  mode: z.literal('cycle'),
  jaune_s: z.number().min(2).max(6).default(3),
  etapes: z.array(Etape).min(1).max(16),
  /** Rouges de dégagement saisis à la main : ils remplacent la valeur calculée. */
  degagements: z.record(CleDegagement, z.number().min(0).max(30)).default({}),
  /** Arcs du graphe des étapes en plus du cycle de base. */
  arcs: z.array(ArcGraphe).max(64).default([]),
});
export type PlanEtapes = z.infer<typeof PlanEtapes>;

export const PlanSaisi = z.discriminatedUnion('mode', [PlanEtapes, PlanSansCycle]);
export type PlanSaisi = z.infer<typeof PlanSaisi>;

export const ConfigurationProgramme = z
  .object({ plans: z.array(PlanSaisi).max(12) })
  .superRefine(({ plans }, ctx) => {
    const codes = plans.map((p) => p.code);
    if (new Set(codes).size !== codes.length) ctx.addIssue({ code: 'custom', path: ['plans'], message: 'Codes de plan en double' });
  });
export type ConfigurationProgramme = z.infer<typeof ConfigurationProgramme>;

export interface DegagementCalcule {
  de: string;
  vers: string;
  rouge_s: number;
  distances?: { sortant: number; entrant: number };
}

export type PlanProgramme = PlanSaisi & {
  /** Cycle enregistré (plans à cycle). */
  cycle_s: number | null;
  /** Étapes reconstruites depuis le diagramme de feux (plan saisi sans étapes, relevé terrain). */
  etapes_deduites: boolean;
};

export interface ProgrammeCarrefour {
  plans: PlanProgramme[];
  /** Rouges de dégagement calculés sur la géométrie, pour chaque couple de lignes en conflit. */
  degagements: DegagementCalcule[];
  /** Plans devenus incohérents avec les lignes de feux actuelles. */
  alertes: string[];
}

/** Plage par défaut d'un nouveau plan : tous les jours, toute la journée. */
export const PLAGE_TOUTE_LA_JOURNEE: Plage = { jours: 'tous', de: '00:00', a: '00:00' };
