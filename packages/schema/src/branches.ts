import { z } from 'zod';
import { Mouvement } from './feux.js';

export const SensBranche = z.enum(['entrant', 'sortant', 'double']);
export type SensBranche = z.infer<typeof SensBranche>;

export const TypeVoie = z.enum(['generale', 'bus', 'velo', 'tram']);
export type TypeVoie = z.infer<typeof TypeVoie>;

/** Voie entrante : rang 0 = la plus à gauche dans le sens d'arrivée. */
export const Voie = z.object({
  rang: z.number().int().min(0).max(9),
  mouvements: z.array(Mouvement).max(4),
  type: TypeVoie.default('generale'),
});
export type Voie = z.infer<typeof Voie>;

export const CoordonneesLigne = z.array(z.tuple([z.number(), z.number()])).min(2).max(50);

export const Branche = z
  .object({
    code: z.string().trim().regex(/^[A-Z0-9]{1,4}$/, 'Code en majuscules, 4 caractères au plus (N, NE, S2…)'),
    nom: z.string().trim().max(200).nullable().default(null),
    /** Degrés, sens horaire depuis le nord, du centre du carrefour vers la branche. */
    azimut: z.number().min(0).max(360),
    sens: SensBranche,
    voies_sortantes: z.number().int().min(0).max(9),
    osm_way_id: z.number().int().nullable().default(null),
    /** Du centre du carrefour vers la branche, en [lon, lat]. */
    geom: CoordonneesLigne.nullable().default(null),
    voies: z.array(Voie).max(10),
  })
  .superRefine((branche, ctx) => {
    const rangs = branche.voies.map((v) => v.rang);
    if (new Set(rangs).size !== rangs.length) ctx.addIssue({ code: 'custom', path: ['voies'], message: 'Rangs de voie en double' });
    if (branche.sens === 'sortant' && branche.voies.length > 0) {
      ctx.addIssue({ code: 'custom', path: ['voies'], message: 'Une branche sortante n’a pas de voie entrante' });
    }
  });
export type Branche = z.infer<typeof Branche>;

export const ConfigurationBranches = z
  .object({ branches: z.array(Branche).max(12) })
  .superRefine(({ branches }, ctx) => {
    const codes = branches.map((b) => b.code);
    if (new Set(codes).size !== codes.length) {
      ctx.addIssue({ code: 'custom', path: ['branches'], message: 'Codes de branche en double' });
    }
  });
export type ConfigurationBranches = z.infer<typeof ConfigurationBranches>;

export interface MouvementCarrefour {
  origine: string;
  destination: string;
  direction: Mouvement;
  voies: number[];
}

export interface BranchesCarrefour {
  branches: Branche[];
  mouvements: MouvementCarrefour[];
  /** Flèches qui ne mènent à aucune sortie. */
  alertes: Array<{ branche: string; rang: number; direction: Mouvement }>;
}

/** Proposition de branches détectée depuis OSM, non enregistrée. */
export interface DetectionBranches extends BranchesCarrefour {
  centre: [number, number];
  rayon_m: number;
  /** Par code de branche : d'où viennent les flèches des voies entrantes. */
  sources: Record<string, 'osm' | 'defaut'>;
}
