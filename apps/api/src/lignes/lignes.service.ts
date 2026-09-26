import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { matriceConflits, mouvementsNonCommandes, type LigneConflits } from '@voirie/engine';
import { typeLigne, type ConfigurationLignes, type LigneFeux, type LignesCarrefour } from '@voirie/schema';
import { BranchesService, geometrieDe } from '../branches/branches.service.js';
import { DRIZZLE, type Db } from '../db/db.module.js';
import { uuids } from '../db/sql.js';

const pourConflits = (l: LigneFeux): LigneConflits => ({
  code: l.code,
  type: typeLigne(l.signal),
  mouvements: l.mouvements,
  traverse: l.traverse,
});

@Injectable()
export class LignesService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly branches: BranchesService,
  ) {}

  /** Lignes de feux du carrefour, matrice des conflits et contrôles de cohérence. */
  async lire(carrefourId: string): Promise<LignesCarrefour> {
    const configuration = await this.branches.lire(carrefourId); // 404 si carrefour inconnu
    const { branches, mouvements } = configuration;
    const { rows: lignes } = await this.db.execute<LigneFeux>(sql`
      SELECT l.code, l.signal, l.mouvements, l.traverse,
             coalesce(array_agg(lf.feu_id ORDER BY lf.feu_id) FILTER (WHERE lf.feu_id IS NOT NULL), '{}') AS feux
      FROM ligne_feux l
      LEFT JOIN ligne_feux_feu lf ON lf.ligne_feux_id = l.id
      WHERE l.carrefour_id = ${carrefourId}
      GROUP BY l.id
      ORDER BY l.code
    `);
    const { rows } = await this.db.execute<{ conflits_admis: Array<[string, string]> }>(
      sql`SELECT conflits_admis FROM carrefour WHERE id = ${carrefourId}`,
    );
    const conflitsAdmis = rows[0]?.conflits_admis ?? [];

    const cles = new Set(mouvements.map((m) => `${m.origine}>${m.destination}`));
    const traversees = new Set(branches.filter((b) => b.traversee).map((b) => b.code));
    const alertes = lignes.flatMap((l) => [
      ...l.mouvements.filter((cle) => !cles.has(cle)).map((cle) => `${l.code} : le mouvement ${cle} n'existe plus`),
      ...(l.traverse && !traversees.has(l.traverse) ? [`${l.code} : plus de passage piéton sur la branche ${l.traverse}`] : []),
    ]);

    return {
      lignes,
      conflits_admis: conflitsAdmis,
      conflits: matriceConflits(lignes.map(pourConflits), geometrieDe(configuration), conflitsAdmis),
      mouvements,
      non_commandes: mouvementsNonCommandes(mouvements, lignes.map(pourConflits)),
      alertes,
    };
  }

  /** Remplace les lignes de feux et les conflits admis du carrefour. */
  async enregistrer(carrefourId: string, { lignes, conflits_admis }: ConfigurationLignes): Promise<LignesCarrefour> {
    const { branches, mouvements } = await this.branches.lire(carrefourId);
    const cles = new Set(mouvements.map((m) => `${m.origine}>${m.destination}`));
    const traversees = new Set(branches.filter((b) => b.traversee).map((b) => b.code));
    const codesLignes = new Set(lignes.map((l) => l.code));
    const feux = [...new Set(lignes.flatMap((l) => l.feux))];

    const erreurs = lignes.flatMap((l) => [
      ...l.mouvements.filter((cle) => !cles.has(cle)).map((cle) => `${l.code} : mouvement ${cle} inconnu`),
      ...(l.traverse && !traversees.has(l.traverse) ? [`${l.code} : pas de passage piéton sur la branche ${l.traverse}`] : []),
    ]);
    if (feux.length > 0) {
      const { rows } = await this.db.execute<{ id: string }>(sql`
        SELECT id FROM feu WHERE id = ANY (${uuids(feux)}) AND carrefour_id = ${carrefourId}
      `);
      const duCarrefour = new Set(rows.map((r) => r.id));
      erreurs.push(...feux.filter((id) => !duCarrefour.has(id)).map((id) => `feu ${id} hors de ce carrefour`));
    }
    if (erreurs.length > 0) throw new BadRequestException({ message: 'Lignes de feux invalides', erreurs });

    await this.db.transaction(async (tx) => {
      await tx.execute(sql`DELETE FROM ligne_feux WHERE carrefour_id = ${carrefourId}`);
      for (const ligne of lignes) {
        const { rows } = await tx.execute<{ id: string }>(sql`
          INSERT INTO ligne_feux (carrefour_id, code, signal, mouvements, traverse)
          VALUES (${carrefourId}, ${ligne.code}, ${ligne.signal}, ${`{${ligne.mouvements.join(',')}}`}::text[], ${ligne.traverse})
          RETURNING id
        `);
        if (ligne.feux.length > 0) {
          await tx.execute(sql`
            INSERT INTO ligne_feux_feu (ligne_feux_id, feu_id)
            SELECT ${rows[0]!.id}, unnest(${uuids(ligne.feux)})
          `);
        }
      }
      // Seules les paires qui désignent des lignes existantes sont conservées.
      const admis = conflits_admis.filter(([a, b]) => codesLignes.has(a) && codesLignes.has(b) && a !== b);
      await tx.execute(sql`UPDATE carrefour SET conflits_admis = ${JSON.stringify(admis)}::jsonb WHERE id = ${carrefourId}`);
    });
    return this.lire(carrefourId);
  }
}
