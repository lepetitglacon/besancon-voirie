import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  calculerProgramme,
  contexteProgramme,
  degagementsRetenus,
  etapesDepuisDiagramme,
  type ContexteProgramme,
  type ResultatProgramme,
} from '@voirie/engine';
import {
  typeLigne,
  type ConfigurationProgramme,
  type Etape,
  type Plage,
  type PlanEtapes,
  type PlanProgramme,
  type ProgrammeCarrefour,
} from '@voirie/schema';
import { BranchesService, geometrieDe } from '../branches/branches.service.js';
import { DRIZZLE, type Db } from '../db/db.module.js';
import { LignesService } from '../lignes/lignes.service.js';

/** Cycle maximal accepté par le modèle des plans de feux (PlanCycle). */
const CYCLE_MAX_S = 300;

type LignePlan = {
  code: string;
  mode: 'cycle' | 'jaune_clignotant' | 'eteint';
  plages: Plage[];
  cycle_s: number | null;
  jaune_s: number | null;
  lignes: Record<string, Array<[number, number]>> | null;
  etapes: Etape[] | null;
  degagements: Record<string, number>;
};

@Injectable()
export class ProgrammeService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly branches: BranchesService,
    private readonly lignes: LignesService,
  ) {}

  /** Lignes de feux, conflits et rouges de dégagement calculés du carrefour. */
  private async contexte(carrefourId: string): Promise<ContexteProgramme> {
    const configuration = await this.branches.lire(carrefourId); // 404 si carrefour inconnu
    const { lignes, conflits_admis } = await this.lignes.lire(carrefourId);
    return contexteProgramme(
      lignes.map((l) => ({ code: l.code, type: typeLigne(l.signal), mouvements: l.mouvements, traverse: l.traverse })),
      geometrieDe(configuration),
      conflits_admis,
    );
  }

  private calculer(contexte: ContexteProgramme, plan: PlanEtapes): ResultatProgramme {
    return calculerProgramme({
      ...contexte,
      etapes: plan.etapes,
      jaune_s: plan.jaune_s,
      degagements: degagementsRetenus(contexte.degagements, plan.degagements),
    });
  }

  /** Plans de feux du carrefour, avec leurs étapes (saisies, ou reconstruites depuis le diagramme). */
  async lire(carrefourId: string): Promise<ProgrammeCarrefour> {
    const contexte = await this.contexte(carrefourId);
    const { rows } = await this.db.execute<LignePlan>(sql`
      SELECT code, mode, plages, cycle_s, jaune_s, lignes, etapes, degagements
      FROM plan_feux WHERE carrefour_id = ${carrefourId} ORDER BY code
    `);
    const plans = rows.map((r): PlanProgramme => {
      if (r.mode !== 'cycle') return { code: r.code, mode: r.mode, plages: r.plages, cycle_s: null, etapes_deduites: false };
      const deduites = r.etapes === null;
      return {
        code: r.code,
        mode: 'cycle',
        plages: r.plages,
        jaune_s: r.jaune_s ?? 3,
        etapes: r.etapes ?? (r.lignes && r.cycle_s ? etapesDepuisDiagramme(r.lignes, r.cycle_s) : []),
        degagements: r.degagements,
        cycle_s: r.cycle_s,
        etapes_deduites: deduites,
      };
    });
    const alertes = plans.flatMap((plan) =>
      plan.mode === 'cycle' && plan.etapes.length > 0
        ? this.calculer(contexte, plan)
            .controles.filter((c) => c.niveau === 'erreur')
            .map((c) => `Plan ${plan.code} : ${c.message}`)
        : [],
    );
    return { plans, degagements: contexte.degagements, alertes };
  }

  /**
   * Remplace les plans du carrefour. Les plans à cycle sont calculés : le cycle et le
   * diagramme de feux (intervalles de vert par ligne) sont enregistrés avec les étapes.
   * Un plan conservé garde sa référence de synchronisation et son relevé d'origine.
   */
  async enregistrer(carrefourId: string, { plans }: ConfigurationProgramme): Promise<ProgrammeCarrefour> {
    const contexte = await this.contexte(carrefourId);
    const calculs = new Map<string, ResultatProgramme>();
    const erreurs: string[] = [];
    for (const plan of plans) {
      if (plan.mode !== 'cycle') continue;
      const resultat = this.calculer(contexte, plan);
      calculs.set(plan.code, resultat);
      erreurs.push(...resultat.controles.filter((c) => c.niveau === 'erreur').map((c) => `Plan ${plan.code} : ${c.message}`));
      if (resultat.cycle_s > CYCLE_MAX_S) erreurs.push(`Plan ${plan.code} : cycle de ${resultat.cycle_s} s, au-delà de ${CYCLE_MAX_S} s`);
    }
    if (erreurs.length > 0) throw new BadRequestException({ message: 'Programme invalide', erreurs });

    const codes = plans.map((p) => p.code);
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        DELETE FROM plan_feux WHERE carrefour_id = ${carrefourId} AND NOT (code = ANY (${`{${codes.join(',')}}`}::text[]))
      `);
      for (const plan of plans) {
        const calcul = calculs.get(plan.code);
        const cycle = plan.mode === 'cycle' ? {
          cycle_s: calcul!.cycle_s,
          jaune_s: plan.jaune_s,
          lignes: JSON.stringify(Object.fromEntries(Object.entries(calcul!.verts).filter(([, v]) => v.length > 0))),
          etapes: JSON.stringify(plan.etapes),
          degagements: JSON.stringify(plan.degagements),
        } : { cycle_s: null, jaune_s: null, lignes: null, etapes: null, degagements: '{}' };
        await tx.execute(sql`
          INSERT INTO plan_feux (carrefour_id, code, mode, plages, cycle_s, jaune_s, lignes, etapes, degagements)
          VALUES (${carrefourId}, ${plan.code}, ${plan.mode}, ${JSON.stringify(plan.plages)}::jsonb, ${cycle.cycle_s},
                  ${cycle.jaune_s}, ${cycle.lignes}::jsonb, ${cycle.etapes}::jsonb, ${cycle.degagements}::jsonb)
          ON CONFLICT (carrefour_id, code) DO UPDATE SET
            mode = excluded.mode, plages = excluded.plages, cycle_s = excluded.cycle_s, jaune_s = excluded.jaune_s,
            lignes = excluded.lignes, etapes = excluded.etapes, degagements = excluded.degagements
        `);
      }
    });
    return this.lire(carrefourId);
  }
}
