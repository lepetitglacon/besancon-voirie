import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { controlerCarrefour, etatNiveau } from '@voirie/engine';
import type { CarrefourResume, MaturiteCarrefour } from '@voirie/schema';
import { sql } from 'drizzle-orm';
import { BranchesService } from '../branches/branches.service.js';
import { DRIZZLE, type Db } from '../db/db.module.js';
import { LignesService } from '../lignes/lignes.service.js';
import { ProgrammeService } from '../programme/programme.service.js';

type LigneCarrefour = CarrefourResume & { lon: number; lat: number; feux: string[] };

/**
 * Maturité des carrefours (docs/pipeline-donnees.md, étape 5) : pour chacun, les contrôles du
 * moteur sur ce qui est enregistré, niveau par niveau (N2 carrefour, N3 fonctionnement, N4
 * sorties). Les brouillons du navigateur n'y sont pas : seul compte ce qui est enregistré.
 */
@Injectable()
export class MaturiteService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly branches: BranchesService,
    private readonly lignes: LignesService,
    private readonly programme: ProgrammeService,
  ) {}

  /** Tous les carrefours, du moins avancé au plus avancé. */
  async tous(): Promise<MaturiteCarrefour[]> {
    const lignes = await this.carrefours();
    const maturites: MaturiteCarrefour[] = [];
    for (const ligne of lignes) maturites.push(await this.evaluer(ligne));
    const poids = (m: MaturiteCarrefour) =>
      (['N2', 'N3', 'N4'] as const).reduce((s, n, i) => s + { erreur: 2, avertissement: 1, ok: 0 }[m.niveaux[n]] * 3 ** (2 - i), 0);
    return maturites.sort((a, b) => poids(b) - poids(a) || a.carrefour.nom.localeCompare(b.carrefour.nom, 'fr'));
  }

  async un(carrefourId: string): Promise<MaturiteCarrefour> {
    const [ligne] = await this.carrefours(carrefourId);
    if (!ligne) throw new NotFoundException('Carrefour inconnu');
    return this.evaluer(ligne);
  }

  private async carrefours(id?: string): Promise<LigneCarrefour[]> {
    const { rows } = await this.db.execute<LigneCarrefour>(sql`
      SELECT c.id, c.slug, c.nom, c.statut, c.nature, c.pres_tram, ST_X(c.geom) AS lon, ST_Y(c.geom) AS lat,
             coalesce(array_agg(f.id ORDER BY f.id) FILTER (WHERE f.id IS NOT NULL), '{}') AS feux
      FROM carrefour c LEFT JOIN feu f ON f.carrefour_id = c.id
      ${id ? sql`WHERE c.id = ${id}` : sql``}
      GROUP BY c.id
      ORDER BY c.nom
    `);
    return rows;
  }

  private async evaluer({ lon, lat, feux, ...carrefour }: LigneCarrefour): Promise<MaturiteCarrefour> {
    const configuration = await this.branches.lire(carrefour.id);
    const lignes = await this.lignes.lire(carrefour.id);
    const programme = await this.programme.lire(carrefour.id);
    const constats = controlerCarrefour({
      nature: carrefour.nature,
      surLeReseau: configuration.graphe,
      branches: configuration.branches,
      connexions: configuration.connexions,
      feux,
      lignes: lignes.lignes,
      nonCommandes: lignes.non_commandes,
      alertesLignes: lignes.alertes,
      plans: programme.plans.map((p) => ({ code: p.code, mode: p.mode, etapes: p.mode === 'cycle' ? p.etapes.length : 0 })),
      alertesProgramme: programme.alertes,
    });
    return {
      carrefour: { ...carrefour, nb_feux: feux.length },
      position: [lon, lat],
      sur_le_reseau: configuration.graphe,
      niveaux: { N2: etatNiveau(constats, 'N2'), N3: etatNiveau(constats, 'N3'), N4: etatNiveau(constats, 'N4') },
      constats,
    };
  }
}
