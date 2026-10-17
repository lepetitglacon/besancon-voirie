import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { analyserReleve, type SyntheseReleve } from '@voirie/engine';
import type { EnvoiReleve, ReleveResume, StatutModeration } from '@voirie/schema';
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
  evenements: r.synthese.evenements,
});

/** Relevés terrain : réception anonyme, en attente de modération (docs/ARCHITECTURE.md §7, §12). */
@Injectable()
export class RelevesService {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  async recevoir({ carrefour_id, pseudo, saisies, site_web }: EnvoiReleve): Promise<ReleveResume> {
    const { rows: carrefour } = await this.db.execute(sql`SELECT 1 FROM carrefour WHERE id = ${carrefour_id}`);
    if (carrefour.length === 0) throw new NotFoundException('Carrefour inconnu');
    const { rows: lignes } = await this.db.execute<{ code: string }>(sql`
      SELECT code FROM ligne_feux WHERE carrefour_id = ${carrefour_id} ORDER BY code
    `);
    const codes = lignes.map((l) => l.code);

    const inconnues = [...new Set(saisies.flatMap((s) => ('ligne' in s && !codes.includes(s.ligne) ? [s.ligne] : [])))];
    if (inconnues.length > 0) throw new BadRequestException(`Pas de ligne ${inconnues.join(', ')} à ce carrefour`);
    if (!saisies.some((s) => 'ligne' in s)) throw new BadRequestException('Aucun changement de couleur relevé');
    const maintenant = Date.now();
    if (saisies.some((s) => s.t < maintenant - ANCIENNETE_MAX_MS || s.t > maintenant + AVANCE_MAX_MS)) {
      throw new BadRequestException('Relevé daté de plus d’un mois, ou dans le futur');
    }

    // La synthèse est refaite ici : celle qu'affichait le téléphone n'est pas reçue.
    const triees = [...saisies].sort((a, b) => a.t - b.t);
    const synthese = analyserReleve(triees, codes);
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
