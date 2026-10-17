import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { analyserReleve, type SyntheseReleve } from '@voirie/engine';
import type { EnvoiReleve, ReleveDetail, ReleveResume, SaisieReleve, StatutModeration } from '@voirie/schema';
import { DRIZZLE, type Db } from '../db/db.module.js';

/** Un relevé ne peut pas dater de plus d'un mois (stocké hors ligne sur le téléphone entre-temps). */
const ANCIENNETE_MAX_MS = 31 * 86_400_000;
/** Horloge du téléphone en avance : on tolère quelques minutes. */
const AVANCE_MAX_MS = 5 * 60_000;

type LigneReleve = {
  id: string;
  pseudo: string | null;
  observe_le: Date;
  statut: StatutModeration;
  cycles_observes: number;
  ecart_type_cycle_s: number | null;
  synthese: SyntheseReleve;
};

const resume = (r: LigneReleve): ReleveResume => ({
  id: r.id,
  pseudo: r.pseudo,
  observe_le: new Date(r.observe_le).toISOString(),
  statut: r.statut,
  cycles_observes: r.cycles_observes,
  cycle_s: r.synthese.cycle?.cycle_s ?? null,
  ecart_type_cycle_s: r.ecart_type_cycle_s,
  verts: r.synthese.verts,
  // Relevés d'avant la saisie du jaune : pas de jaunes dans leur synthèse.
  jaunes: r.synthese.jaunes ?? {},
  evenements: r.synthese.evenements,
});

/** Relevés terrain : réception anonyme, en attente de modération (docs/ARCHITECTURE.md §7, §12). */
@Injectable()
export class RelevesService {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  /**
   * Saisies valables pour ce carrefour (lignes connues, au moins un changement de couleur), triées,
   * et leur synthèse, refaite ici : celle qu'affichait le téléphone n'est pas reçue.
   */
  private async analyser(carrefourId: string, saisies: readonly SaisieReleve[]) {
    const { rows: carrefour } = await this.db.execute(sql`SELECT 1 FROM carrefour WHERE id = ${carrefourId}`);
    if (carrefour.length === 0) throw new NotFoundException('Carrefour inconnu');
    const { rows: lignes } = await this.db.execute<{ code: string }>(sql`
      SELECT code FROM ligne_feux WHERE carrefour_id = ${carrefourId} ORDER BY code
    `);
    const codes = lignes.map((l) => l.code);

    // Changements de couleur et événements rattachés : la ligne doit exister.
    const inconnues = [...new Set(saisies.flatMap((s) => (s.ligne && !codes.includes(s.ligne) ? [s.ligne] : [])))];
    if (inconnues.length > 0) throw new BadRequestException(`Pas de ligne ${inconnues.join(', ')} à ce carrefour`);
    if (!saisies.some((s) => 'couleur' in s)) throw new BadRequestException('Aucun changement de couleur relevé');
    const triees = [...saisies].sort((a, b) => a.t - b.t);
    return { triees, synthese: analyserReleve(triees, codes) };
  }

  async recevoir({ carrefour_id, pseudo, saisies, site_web }: EnvoiReleve): Promise<ReleveResume> {
    const maintenant = Date.now();
    if (saisies.some((s) => s.t < maintenant - ANCIENNETE_MAX_MS || s.t > maintenant + AVANCE_MAX_MS)) {
      throw new BadRequestException('Relevé daté de plus d’un mois, ou dans le futur');
    }
    const { triees, synthese } = await this.analyser(carrefour_id, saisies);
    const releve: LigneReleve = {
      id: randomUUID(),
      pseudo: pseudo || null,
      observe_le: new Date(triees[0]!.t),
      statut: 'en_attente',
      cycles_observes: synthese.cycle?.cycles ?? 0,
      ecart_type_cycle_s: synthese.cycle?.ecart_type_s ?? null,
      synthese,
    };
    // Champ piège rempli : un robot. On répond comme d'habitude, sans rien enregistrer.
    if (site_web) return resume(releve);

    await this.db.execute(sql`
      INSERT INTO releve (id, carrefour_id, pseudo, brut, synthese, cycles_observes, ecart_type_cycle_s, observe_le)
      VALUES (${releve.id}, ${carrefour_id}, ${releve.pseudo}, ${JSON.stringify(triees)}::jsonb, ${JSON.stringify(synthese)}::jsonb,
        ${releve.cycles_observes}, ${releve.ecart_type_cycle_s}, ${releve.observe_le.toISOString()})
    `);
    return resume(releve);
  }

  /**
   * Relevé corrigé à la seconde (timeline de l'onglet Relevés terrain) : les saisies remplacent les
   * anciennes et la synthèse est refaite. Le statut ne change pas.
   */
  async corriger(id: string, saisies: readonly SaisieReleve[]): Promise<ReleveDetail> {
    const { rows } = await this.db.execute<{ carrefour_id: string }>(sql`SELECT carrefour_id FROM releve WHERE id = ${id}`);
    if (!rows[0]) throw new NotFoundException('Relevé inconnu');
    const { triees, synthese } = await this.analyser(rows[0].carrefour_id, saisies);
    await this.db.execute(sql`
      UPDATE releve SET
        brut = ${JSON.stringify(triees)}::jsonb,
        synthese = ${JSON.stringify(synthese)}::jsonb,
        cycles_observes = ${synthese.cycle?.cycles ?? 0},
        ecart_type_cycle_s = ${synthese.cycle?.ecart_type_s ?? null},
        observe_le = ${new Date(triees[0]!.t).toISOString()}
      WHERE id = ${id}
    `);
    return this.detail(id);
  }

  /** Un relevé et ses saisies (relevé rejeté compris : la modération en a besoin). */
  async detail(id: string): Promise<ReleveDetail> {
    const { rows } = await this.db.execute<LigneReleve & { carrefour_id: string; brut: SaisieReleve[] }>(sql`
      SELECT id, carrefour_id, pseudo, observe_le, statut, cycles_observes, ecart_type_cycle_s, synthese, brut
      FROM releve WHERE id = ${id}
    `);
    const releve = rows[0];
    if (!releve) throw new NotFoundException('Relevé inconnu');
    return { ...resume(releve), carrefour_id: releve.carrefour_id, saisies: releve.brut };
  }

  /** Relevés d'un carrefour, du plus récent au plus ancien ; les relevés rejetés n'apparaissent pas. */
  async duCarrefour(carrefourId: string): Promise<ReleveResume[]> {
    const { rows } = await this.db.execute<LigneReleve>(sql`
      SELECT id, pseudo, observe_le, statut, cycles_observes, ecart_type_cycle_s, synthese
      FROM releve
      WHERE carrefour_id = ${carrefourId} AND statut <> 'rejete'
      ORDER BY observe_le DESC
      LIMIT 50
    `);
    return rows.map(resume);
  }
}
