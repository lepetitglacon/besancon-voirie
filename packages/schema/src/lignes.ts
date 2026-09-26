import { z } from 'zod';
import { CodeLigne, LigneFeux } from './feux.js';
import type { MouvementCarrefour } from './branches.js';

export const ConfigurationLignes = z
  .object({
    lignes: z.array(LigneFeux).max(40),
    /** Paires de lignes en conflit tolérées : elles peuvent être au vert ensemble. */
    conflits_admis: z.array(z.tuple([CodeLigne, CodeLigne])).max(200).default([]),
  })
  .superRefine(({ lignes }, ctx) => {
    const codes = lignes.map((l) => l.code);
    if (new Set(codes).size !== codes.length) {
      ctx.addIssue({ code: 'custom', path: ['lignes'], message: 'Codes de ligne en double' });
    }
    const vus = new Map<string, string>();
    for (const ligne of lignes) {
      for (const cle of ligne.mouvements) {
        const autre = vus.get(cle);
        if (autre) ctx.addIssue({ code: 'custom', path: ['lignes'], message: `Le mouvement ${cle} est commandé par ${autre} et ${ligne.code}` });
        vus.set(cle, ligne.code);
      }
    }
  });
export type ConfigurationLignes = z.infer<typeof ConfigurationLignes>;

export interface ConflitLignes {
  a: string;
  b: string;
  nature: 'croisement' | 'convergence' | 'pieton';
  cause: [string, string];
  admis: boolean;
}

export interface LignesCarrefour {
  lignes: LigneFeux[];
  conflits_admis: Array<[string, string]>;
  conflits: ConflitLignes[];
  /** Mouvements des branches enregistrées. */
  mouvements: MouvementCarrefour[];
  /** Mouvements qu'aucune ligne véhicule ne commande. */
  non_commandes: string[];
  /** Références devenues invalides (branches modifiées depuis). */
  alertes: string[];
}
