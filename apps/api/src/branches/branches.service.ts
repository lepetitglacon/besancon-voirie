import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { calculerMouvements } from '@voirie/engine';
import type { Branche, BranchesCarrefour, ConfigurationBranches, DetectionBranches } from '@voirie/schema';
import { DRIZZLE, type Db } from '../db/db.module.js';
import { tableExiste, type Executeur } from '../db/sql.js';
import { proposerBranches, type Passage } from './detection.js';

/** Marge ajoutée au feu le plus éloigné du centre pour tracer le cercle de détection. */
const MARGE_CERCLE_M = 15;
const RAYON_MIN_M = 20;
const RAYON_MAX_M = 80;

/**
 * Voies prises en compte pour détecter les branches. Les voies `service` (parkings, accès
 * riverains) sont écartées : elles encombrent la proposition et sont rarement réglées par des feux.
 */
const VOIES_CIRCULABLES = [
  'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified',
  'residential', 'living_street', 'busway', 'road',
];

function avecMouvements(branches: Branche[]): BranchesCarrefour {
  const { mouvements, alertes } = calculerMouvements(branches);
  return { branches, mouvements, alertes };
}

@Injectable()
export class BranchesService {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  /** Branches enregistrées, leurs voies et les mouvements qu'elles permettent. */
  async lire(carrefourId: string): Promise<BranchesCarrefour> {
    await this.exiger(this.db, carrefourId);
    const { rows } = await this.db.execute<Branche>(sql`
      SELECT b.code, b.nom, b.azimut_deg AS azimut, b.sens, b.voies_sortantes,
             b.osm_way_id::float8 AS osm_way_id,
             (ST_AsGeoJSON(b.geom)::json)->'coordinates' AS geom,
             coalesce(
               (SELECT json_agg(json_build_object('rang', v.rang, 'mouvements', v.mouvements, 'type', v.type) ORDER BY v.rang)
                FROM voie v WHERE v.branche_id = b.id),
               '[]'::json
             ) AS voies
      FROM branche b
      WHERE b.carrefour_id = ${carrefourId}
      ORDER BY b.azimut_deg
    `);
    return avecMouvements(rows);
  }

  /** Proposition de branches depuis les voies OSM : rien n'est enregistré. */
  async detecter(carrefourId: string): Promise<DetectionBranches> {
    const { rows } = await this.db.execute<{ lon: number; lat: number; rayon: number }>(sql`
      SELECT ST_X(c.geom) AS lon, ST_Y(c.geom) AS lat,
             least(greatest(coalesce(max(ST_Distance(f.geom::geography, c.geom::geography)), 0) + ${MARGE_CERCLE_M},
                            ${RAYON_MIN_M}), ${RAYON_MAX_M}) AS rayon
      FROM carrefour c LEFT JOIN feu f ON f.carrefour_id = c.id
      WHERE c.id = ${carrefourId}
      GROUP BY c.id
    `);
    const cercle = rows[0];
    if (!cercle) throw new NotFoundException('Carrefour inconnu');
    const centre: [number, number] = [cercle.lon, cercle.lat];
    const passages = (await tableExiste(this.db, 'osm_way')) ? await this.passages(carrefourId, cercle.rayon) : [];
    const { branches, sources } = proposerBranches(passages, centre);
    return { ...avecMouvements(branches), centre, rayon_m: Math.round(cercle.rayon), sources };
  }

  /** Remplace toutes les branches et voies du carrefour. */
  async enregistrer(carrefourId: string, { branches }: ConfigurationBranches): Promise<BranchesCarrefour> {
    await this.db.transaction(async (tx) => {
      await this.exiger(tx, carrefourId);
      await tx.execute(sql`DELETE FROM branche WHERE carrefour_id = ${carrefourId}`);
      for (const b of branches) {
        const geom = b.geom ? JSON.stringify({ type: 'LineString', coordinates: b.geom }) : null;
        const { rows } = await tx.execute<{ id: string }>(sql`
          INSERT INTO branche (carrefour_id, code, nom, azimut_deg, sens, voies_sortantes, osm_way_id, geom)
          VALUES (${carrefourId}, ${b.code}, ${b.nom}, ${b.azimut}, ${b.sens}, ${b.voies_sortantes}, ${b.osm_way_id},
                  ST_SetSRID(ST_GeomFromGeoJSON(${geom}), 4326))
          RETURNING id
        `);
        for (const v of b.voies) {
          await tx.execute(sql`
            INSERT INTO voie (branche_id, rang, mouvements, type)
            VALUES (${rows[0]!.id}, ${v.rang}, ${`{${v.mouvements.join(',')}}`}::text[], ${v.type})
          `);
        }
      }
    });
    return this.lire(carrefourId);
  }

  private async exiger(db: Executeur, carrefourId: string): Promise<void> {
    const { rows } = await db.execute(sql`SELECT 1 FROM carrefour WHERE id = ${carrefourId}`);
    if (rows.length === 0) throw new NotFoundException('Carrefour inconnu');
  }

  /** Points où les voies OSM circulables traversent le cercle autour du carrefour. */
  private async passages(carrefourId: string, rayon: number): Promise<Passage[]> {
    const { rows } = await this.db.execute<{
      osm_id: string;
      tags: Record<string, string>;
      azimut: number;
      lon: number;
      lat: number;
      vient_de_l_interieur: boolean;
    }>(sql`
      WITH c AS (
        SELECT geom AS centre, ST_ExteriorRing(ST_Buffer(geom::geography, ${rayon}::float8, 32)::geometry) AS cercle
        FROM carrefour WHERE id = ${carrefourId}
      ), voies AS (
        SELECT w.osm_id, w.tags, w.geom FROM osm_way w, c
        WHERE ST_DWithin(w.geom::geography, c.centre::geography, ${rayon}::float8 + 5)
          AND regexp_replace(w.tags->>'highway', '_link$', '') = ANY (${`{${VOIES_CIRCULABLES.join(',')}}`}::text[])
          AND coalesce(w.tags->>'area', 'no') <> 'yes'
      ), passages AS (
        SELECT v.osm_id, v.tags, v.geom, (ST_Dump(ST_Intersection(v.geom, c.cercle))).geom AS pt, c.centre
        FROM voies v, c WHERE ST_Intersects(v.geom, c.cercle)
      )
      SELECT osm_id::text, tags, ST_X(pt) AS lon, ST_Y(pt) AS lat,
             (degrees(ST_Azimuth(centre::geography, pt::geography)) + 360)::numeric % 360 AS azimut,
             ST_DWithin(
               ST_LineInterpolatePoint(geom, greatest(
                 ST_LineLocatePoint(geom, pt) - 2.0 / nullif(ST_Length(geom::geography), 0), 0))::geography,
               centre::geography, ${rayon}::float8
             ) AS vient_de_l_interieur
      FROM passages
      WHERE GeometryType(pt) = 'POINT'
    `);
    return rows.map((r) => ({
      osmId: Number(r.osm_id),
      tags: r.tags,
      azimut: Number(r.azimut),
      lon: r.lon,
      lat: r.lat,
      vientDeLInterieur: r.vient_de_l_interieur,
    }));
  }
}
