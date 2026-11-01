import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { ResultatProgramme } from '@voirie/engine';
import type { CarrefourResume, Controleur, DiagrammeFeux, FicheCarrefour, FichePlan } from '@voirie/schema';
import { BranchesService } from '../branches/branches.service.js';
import { DRIZZLE, type Db } from '../db/db.module.js';
import { LignesService } from '../lignes/lignes.service.js';
import { ProgrammeService } from '../programme/programme.service.js';
import { RelevesService } from '../releves/releves.service.js';
import { TempsReelService } from '../temps-reel/temps-reel.service.js';

/** Ce que le chronogramme dessine, sans les détails du calcul (contraintes, contrôles). */
const diagramme = (r: ResultatProgramme): DiagrammeFeux => ({
  cycle_s: r.cycle_s,
  etapes: r.etapes.map(({ index, lignes, debut_s, fin_s }) => ({ index, lignes, debut_s, fin_s })),
  transitions: r.transitions.map(({ debut_s, duree_s }) => ({ debut_s, duree_s })),
  verts: r.verts,
  jaunes: r.jaunes,
});

/** Fiche d'un carrefour : saisie (branches, lignes, plans), calculs (diagrammes, calage) et relevés. */
@Injectable()
export class FicheService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly branches: BranchesService,
    private readonly lignes: LignesService,
    private readonly programme: ProgrammeService,
    private readonly tempsReel: TempsReelService,
    private readonly releves: RelevesService,
  ) {}

  async lire(slug: string): Promise<FicheCarrefour> {
    const { rows } = await this.db.execute<CarrefourResume & { controleur: Partial<Controleur>; lon: number; lat: number }>(sql`
      SELECT c.id, c.slug, c.nom, c.statut, c.nature, c.pres_tram, c.controleur,
        (SELECT count(*)::int FROM feu f WHERE f.carrefour_id = c.id) AS nb_feux,
        ST_X(c.geom) AS lon, ST_Y(c.geom) AS lat
      FROM carrefour c WHERE c.slug = ${slug}
    `);
    const ligne = rows[0];
    if (!ligne) throw new NotFoundException('Carrefour inconnu');
    const { lon, lat, ...carrefour } = ligne;

    const [branches, lignes, { programme, diagrammes }, tops, releves] = await Promise.all([
      this.branches.lire(carrefour.id),
      this.lignes.lire(carrefour.id),
      this.programme.avecDiagrammes(carrefour.id),
      this.tempsReel.tops(carrefour.id),
      this.releves.duCarrefour(carrefour.id),
    ]);

    return {
      carrefour: { ...carrefour, position: [lon, lat] },
      branches: branches.branches
        .filter((b) => !b.troncon)
        .map((b) => ({
          code: b.code,
          nom: b.nom,
          azimut: b.azimut,
          entrantes: b.voies.filter((v) => v.sens === 'entrante').length,
          sortantes: b.voies.filter((v) => v.sens === 'sortante').length,
          passages: b.passages.length,
        })),
      lignes: lignes.lignes.map((l) => ({ code: l.code, signal: l.signal, mouvements: l.mouvements, traverse: l.traverse, feux: l.feux.length })),
      plans: programme.plans.map((p): FichePlan => {
        const calcul = diagrammes.get(p.code);
        return {
          code: p.code,
          mode: p.mode,
          plages: p.plages,
          cycle_s: calcul?.cycle_s ?? p.cycle_s,
          diagramme: calcul ? diagramme(calcul) : null,
          synchro: p.mode === 'cycle' ? (tops.plans[p.code] ?? null) : null,
          appels: p.mode === 'cycle' ? [...new Set(p.etapes.flatMap((e) => (e.appel && !e.hors_cycle ? [e.appel] : [])))] : [],
          priorites: p.mode === 'cycle' ? [...new Set(p.etapes.filter((e) => e.hors_cycle).flatMap((e) => e.lignes))] : [],
        };
      }),
      releves,
    };
  }
}
