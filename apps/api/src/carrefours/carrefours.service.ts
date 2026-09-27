import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { HIERARCHIE_VOIES, proposerNom, slugifier, slugLibre } from '@voirie/engine';
import type {
  Bbox,
  CarrefourResume,
  CarrefoursGeoJson,
  CreerCarrefour,
  ModifierCarrefour,
  NatureCarrefour,
  PointGeoJson,
} from '@voirie/schema';
import { DRIZZLE, type Db } from '../db/db.module.js';
import { tableExiste, uuids, type Executeur, type Tx } from '../db/sql.js';
import { materialiserCarrefour, rattacherNoeuds } from '../reseau/carrefours.js';
import { recalculerCarrefour } from './positions.js';

const LIMITE_CARREFOURS = 2000;
/** Voies prises en compte pour proposer un nom. */
const RAYON_NOMMAGE_M = 20;

const RANG_VOIE = sql.raw(
  `array_position(ARRAY[${HIERARCHIE_VOIES.map((h) => `'${h}'`).join(',')}], regexp_replace(w.tags->>'highway', '_link$', ''))`,
);

type LigneCarrefour = CarrefourResume & { geometry: PointGeoJson };

const COLONNES_RESUME = sql`
  c.id, c.slug, c.nom, c.statut, c.nature, c.pres_tram,
  (SELECT count(*)::int FROM feu f WHERE f.carrefour_id = c.id) AS nb_feux,
  ST_AsGeoJSON(c.geom)::json AS geometry`;

@Injectable()
export class CarrefoursService {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  /** Carrefours contenus dans l'emprise de la carte, au format GeoJSON. */
  async dansEmprise([minLon, minLat, maxLon, maxLat]: Bbox): Promise<CarrefoursGeoJson> {
    const { rows } = await this.db.execute<LigneCarrefour>(sql`
      SELECT ${COLONNES_RESUME}
      FROM carrefour c
      WHERE c.geom && ST_MakeEnvelope(${minLon}, ${minLat}, ${maxLon}, ${maxLat}, 4326)
      ORDER BY c.nom
      LIMIT ${LIMITE_CARREFOURS}
    `);

    return {
      type: 'FeatureCollection',
      features: rows.map(({ geometry, ...properties }) => ({
        type: 'Feature',
        id: properties.id,
        geometry,
        properties,
      })),
    };
  }

  /** Nom proposé pour un groupe de feux, d'après les rues qui les entourent. */
  async suggererNom(feux: string[], nature: NatureCarrefour): Promise<string> {
    return proposerNom(await this.nomsProches(this.db, feux), nature);
  }

  /** Compose un carrefour à partir de feux encore libres. */
  async creer({ nom, nature, feux }: CreerCarrefour): Promise<CarrefourResume> {
    return this.db.transaction(async (tx) => {
      await this.verrouillerFeux(tx, feux, null);
      const nomRetenu = nom ?? proposerNom(await this.nomsProches(tx, feux), nature);
      const slug = await this.slugDisponible(tx, slugifier(nomRetenu));

      const { rows } = await tx.execute<{ id: string }>(sql`
        INSERT INTO carrefour (slug, nom, nature, statut, geom)
        SELECT ${slug}, ${nomRetenu}, ${nature}, 'non_releve', ST_Centroid(ST_Collect(geom))
        FROM feu WHERE id = ANY (${uuids(feux)})
        RETURNING id
      `);
      const id = rows[0]!.id;
      await tx.execute(sql`UPDATE feu SET carrefour_id = ${id} WHERE id = ANY (${uuids(feux)})`);
      await recalculerCarrefour(tx, id);
      // Les nœuds du réseau parmi ses feux forment le carrefour (docs/RESEAU.md §4).
      if ((await rattacherNoeuds(tx, id)) > 0) await materialiserCarrefour(tx, id);
      return this.resume(tx, id);
    });
  }

  /** Renomme, change la nature ou recompose les feux d'un carrefour (le slug ne change pas). */
  async modifier(id: string, modification: ModifierCarrefour): Promise<CarrefourResume> {
    return this.db.transaction(async (tx) => {
      await this.exiger(tx, id);
      if (modification.feux) {
        await this.verrouillerFeux(tx, modification.feux, id);
        await tx.execute(sql`
          UPDATE feu SET carrefour_id = NULL
          WHERE carrefour_id = ${id} AND NOT (id = ANY (${uuids(modification.feux)}))
        `);
        await tx.execute(sql`UPDATE feu SET carrefour_id = ${id} WHERE id = ANY (${uuids(modification.feux)})`);
      }
      if (modification.nom !== undefined || modification.nature !== undefined) {
        await tx.execute(sql`
          UPDATE carrefour
          SET nom = coalesce(${modification.nom ?? null}, nom),
              nature = coalesce(${modification.nature ?? null}::nature_carrefour, nature),
              modifie_le = now()
          WHERE id = ${id}
        `);
      }
      await recalculerCarrefour(tx, id);
      // Des feux ajoutés couvrent de nouveaux nœuds ; ceux déjà pris restent (retirés à la main).
      if (modification.feux && (await rattacherNoeuds(tx, id)) > 0) await materialiserCarrefour(tx, id);
      return this.resume(tx, id);
    });
  }

  /** Supprime un carrefour sans relevé ni plan de feux ; ses feux redeviennent libres. */
  async supprimer(id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.exiger(tx, id);
      const { rows } = await tx.execute<{ n: number }>(sql`
        SELECT (SELECT count(*) FROM releve WHERE carrefour_id = ${id})
             + (SELECT count(*) FROM plan_feux WHERE carrefour_id = ${id}) AS n
      `);
      if (Number(rows[0]?.n) > 0) {
        throw new ConflictException('Ce carrefour a des relevés ou des plans de feux : suppression refusée');
      }
      await tx.execute(sql`DELETE FROM carrefour WHERE id = ${id}`);
    });
  }

  private async exiger(tx: Tx, id: string): Promise<void> {
    const { rows } = await tx.execute(sql`SELECT 1 FROM carrefour WHERE id = ${id} FOR UPDATE`);
    if (rows.length === 0) throw new NotFoundException('Carrefour inconnu');
  }

  /** Vérifie que les feux existent et sont libres (ou déjà à ce carrefour), et les verrouille. */
  private async verrouillerFeux(tx: Tx, feux: string[], carrefourId: string | null): Promise<void> {
    const { rows } = await tx.execute<{ id: string; carrefour_id: string | null }>(sql`
      SELECT id, carrefour_id FROM feu WHERE id = ANY (${uuids(feux)}) FOR UPDATE
    `);
    if (rows.length !== new Set(feux).size) throw new NotFoundException('Feu inconnu');
    const pris = rows.filter((f) => f.carrefour_id !== null && f.carrefour_id !== carrefourId);
    if (pris.length > 0) {
      throw new ConflictException({
        message: 'Des feux appartiennent déjà à un autre carrefour',
        feux: pris.map((f) => f.id),
      });
    }
  }

  private async resume(db: Executeur, id: string): Promise<CarrefourResume> {
    const { rows } = await db.execute<LigneCarrefour>(
      sql`SELECT ${COLONNES_RESUME} FROM carrefour c WHERE c.id = ${id}`,
    );
    const { geometry: _geometry, ...resume } = rows[0]!;
    return resume;
  }

  private async slugDisponible(db: Executeur, base: string): Promise<string> {
    const racine = base || 'carrefour';
    const { rows } = await db.execute<{ slug: string }>(sql`
      SELECT slug FROM carrefour WHERE slug = ${racine} OR slug LIKE ${`${racine}-%`}
    `);
    return slugLibre(racine, new Set(rows.map((r) => r.slug)));
  }

  /** Voies nommées autour des feux, par importance puis distance. */
  private async nomsProches(db: Executeur, feux: string[]): Promise<string[]> {
    if (!(await tableExiste(db, 'osm_way'))) return [];
    const { rows } = await db.execute<{ nom: string }>(sql`
      WITH g AS (
        SELECT ST_Collect(geom) AS points, ST_Centroid(ST_Collect(geom)) AS centre
        FROM feu WHERE id = ANY (${uuids(feux)})
      )
      SELECT nom FROM (
        SELECT w.tags->>'name' AS nom, min(${RANG_VOIE}) AS rang,
               min(ST_Distance(w.geom::geography, g.centre::geography)) AS distance
        FROM osm_way w, g
        WHERE w.tags ? 'name' AND w.tags->>'highway' NOT IN ('cycleway', 'path')
          AND ST_DWithin(w.geom::geography, g.points::geography, ${RAYON_NOMMAGE_M})
        GROUP BY 1
      ) v
      ORDER BY rang NULLS LAST, distance
    `);
    return rows.map((r) => r.nom);
  }
}
