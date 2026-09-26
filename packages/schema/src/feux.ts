import { z } from 'zod';

/** Types de signaux lumineux (IISR, 6ᵉ partie). */
export const Signal = z.enum(['R11v', 'R12', 'R13c', 'R17', 'R18']);
export type Signal = z.infer<typeof Signal>;

export const Mouvement = z.enum(['tout_droit', 'droite', 'gauche', 'demi_tour']);
export type Mouvement = z.infer<typeof Mouvement>;

export const StatutCarrefour = z.enum(['a_confirmer', 'non_releve', 'estime', 'mesure', 'verifie']);
export type StatutCarrefour = z.infer<typeof StatutCarrefour>;

/** Carrefour à feux, ou traversée piétonne à feux isolée (hors carrefour). */
export const NatureCarrefour = z.enum(['carrefour', 'traversee_pietonne']);
export type NatureCarrefour = z.infer<typeof NatureCarrefour>;

export const Controleur = z.object({
  mode: z.enum(['fixe', 'semi_actue', 'actue', 'inconnu']).default('inconnu'),
  priorite_tc: z.enum(['aucune', 'tram', 'bus', 'inconnue']).default('inconnue'),
  appel_pieton: z.boolean().optional(),
  feu_recompense: z.boolean().optional(),
  remarques: z.string().max(2000).optional(),
});
export type Controleur = z.infer<typeof Controleur>;

/** Code court d'une ligne de feux : F1, P2, V1… */
export const CodeLigne = z.string().regex(/^[A-Z]{1,2}\d{1,2}$/);

export const LigneFeux = z.object({
  code: CodeLigne,
  signal: Signal,
  branche: z.string().min(1).max(8).optional(),
  mouvements: z.array(Mouvement).default([]),
  voies: z.number().int().min(1).max(6).optional(),
  /** Piétons / vélos : code de la branche traversée. */
  traverse: z.string().min(1).max(8).optional(),
});
export type LigneFeux = z.infer<typeof LigneFeux>;

/** Intervalle de vert [début, fin] en secondes depuis le début du cycle. */
export const IntervalleVert = z
  .tuple([z.number().min(0), z.number().min(0)])
  .refine(([debut, fin]) => fin > debut, { message: 'La fin du vert doit suivre son début' });
export type IntervalleVert = z.infer<typeof IntervalleVert>;

const Jour = z.enum(['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim']);
const Heure = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const Plage = z.object({
  jours: z.union([z.literal('tous'), z.array(Jour).min(1)]),
  de: Heure,
  a: Heure,
});
export type Plage = z.infer<typeof Plage>;

const PlanBase = z.object({
  code: z.string().min(1).max(32),
  plages: z.array(Plage).min(1),
});

export const PlanCycle = PlanBase.extend({
  mode: z.literal('cycle'),
  cycle_s: z.number().positive().max(300),
  jaune_s: z.number().positive().max(10).default(3),
  /** Instant absolu d'un début de vert de la ligne de référence : sert au calcul des décalages. */
  reference: z
    .object({
      ligne: CodeLigne,
      t0: z.iso.datetime({ offset: true, precision: 3 }),
    })
    .optional(),
  lignes: z.record(CodeLigne, z.array(IntervalleVert).min(1)),
}).superRefine((plan, ctx) => {
  for (const [code, intervalles] of Object.entries(plan.lignes)) {
    for (const [debut, fin] of intervalles) {
      if (debut >= plan.cycle_s || fin > plan.cycle_s) {
        ctx.addIssue({
          code: 'custom',
          path: ['lignes', code],
          message: `Intervalle [${debut}, ${fin}] hors du cycle de ${plan.cycle_s} s`,
        });
      }
    }
  }
});

export const PlanSansCycle = PlanBase.extend({
  mode: z.enum(['jaune_clignotant', 'eteint']),
});

export const PlanFeux = z.discriminatedUnion('mode', [PlanCycle, PlanSansCycle]);
export type PlanFeux = z.infer<typeof PlanFeux>;
export type PlanCycle = z.infer<typeof PlanCycle>;
