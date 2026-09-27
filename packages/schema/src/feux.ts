import { z } from 'zod';

/** Types de signaux lumineux (IISR, 6ᵉ partie). */
export const Signal = z.enum(['R11v', 'R12', 'R13c', 'R17', 'R18']);
export type Signal = z.infer<typeof Signal>;

export const Mouvement = z.enum(['tout_droit', 'droite', 'gauche', 'demi_tour']);
export type Mouvement = z.infer<typeof Mouvement>;

export const StatutCarrefour = z.enum(['a_confirmer', 'non_releve', 'estime', 'mesure', 'verifie']);
export type StatutCarrefour = z.infer<typeof StatutCarrefour>;

/** Carrefour à feux, giratoire (docs/CONFIGURATION.md §7), ou traversée piétonne à feux isolée (hors carrefour). */
export const NatureCarrefour = z.enum(['carrefour', 'giratoire', 'traversee_pietonne']);
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

/** Clé d'un mouvement : « branche d'origine>branche de destination », par exemple S>O. */
export const CleMouvement = z.string().regex(/^[A-Z0-9]{1,4}>[A-Z0-9]{1,4}$/, 'Mouvement attendu sous la forme S>O');

/**
 * Ligne de feux (signal group) : les feux qui changent toujours ensemble.
 * Véhicules, vélos, transports en commun : les mouvements commandés.
 * Piétons (R12) : la branche traversée.
 * Feu d'anneau d'un giratoire : la branche juste en aval du feu ; il arrête la circulation de
 * l'anneau et ne commande aucun mouvement (docs/CONFIGURATION.md §7).
 */
export const LigneFeux = z
  .object({
    code: CodeLigne,
    signal: Signal,
    mouvements: z.array(CleMouvement).max(40).default([]),
    traverse: z.string().regex(/^[A-Z0-9]{1,4}$/).nullable().default(null),
    /** Feu sur l'anneau d'un giratoire, juste en amont de cette branche. */
    anneau: z.string().regex(/^[A-Z0-9]{1,4}$/).nullable().default(null),
    /** Feux physiques (table feu) qui affichent cette ligne. */
    feux: z.array(z.uuid()).max(40).default([]),
  })
  .superRefine((ligne, ctx) => {
    if (ligne.signal === 'R12') {
      if (!ligne.traverse) ctx.addIssue({ code: 'custom', path: ['traverse'], message: 'Branche traversée manquante' });
      if (ligne.mouvements.length) ctx.addIssue({ code: 'custom', path: ['mouvements'], message: 'Une ligne piétonne ne commande pas de mouvement' });
      if (ligne.anneau) ctx.addIssue({ code: 'custom', path: ['anneau'], message: 'Un feu d’anneau n’est pas une ligne piétonne' });
    } else if (ligne.anneau) {
      if (ligne.mouvements.length) ctx.addIssue({ code: 'custom', path: ['mouvements'], message: 'Un feu d’anneau ne commande pas de mouvement : il arrête l’anneau' });
      if (ligne.traverse) ctx.addIssue({ code: 'custom', path: ['traverse'], message: 'Seule une ligne piétonne traverse une branche' });
    } else {
      if (ligne.mouvements.length === 0) ctx.addIssue({ code: 'custom', path: ['mouvements'], message: 'Aucun mouvement commandé' });
      if (ligne.traverse) ctx.addIssue({ code: 'custom', path: ['traverse'], message: 'Seule une ligne piétonne traverse une branche' });
    }
  });
export type LigneFeux = z.infer<typeof LigneFeux>;

export const typeLigne = (signal: Signal): 'vehicule' | 'pieton' => (signal === 'R12' ? 'pieton' : 'vehicule');

/** Intervalle de vert [début, fin] en secondes depuis le début du cycle. */
export const IntervalleVert = z
  .tuple([z.number().min(0), z.number().min(0)])
  .refine(([debut, fin]) => fin > debut, { message: 'La fin du vert doit suivre son début' });
export type IntervalleVert = z.infer<typeof IntervalleVert>;

export const Jour = z.enum(['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim']);
export type Jour = z.infer<typeof Jour>;
const Heure = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const Plage = z.object({
  jours: z.union([z.literal('tous'), z.array(Jour).min(1)]),
  de: Heure,
  a: Heure,
});
export type Plage = z.infer<typeof Plage>;

export const PlanBase = z.object({
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
