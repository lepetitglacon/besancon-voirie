import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { boutsAuNoeud, configurationNetconvert, exporterSumo, liaisonsRetenues, type LonLat, type ReseauSumo } from '@voirie/engine';
import type {
  Accroche,
  Bbox,
  FichierSumo,
  Liaison,
  ModificationTroncon,
  NouveauTroncon,
  ReseauGeoJson,
  SaisieLiaisons,
  TronconResume,
} from '@voirie/schema';
import { sql, type SQL } from 'drizzle-orm';
import { DRIZZLE, type Db } from '../db/db.module.js';
import type { Executeur } from '../db/sql.js';
import { genererReseau, type BilanReseau } from './generation.js';

/** Au-delà, la carte ne reçoit qu'une partie des tronçons de l'emprise (`tronque`). */
const LIMITE_TRONCONS = 6000;
/** Un tronçon accroché à moins de cette distance (m) du bout d'un autre s'accroche à son nœud. */
const TOLERANCE_BOUT_M = 1.5;

type LigneTroncon = { [K in keyof TronconResume]: TronconResume[K] } & { geometry: { type: 'LineString'; coordinates: LonLat[] } };

const COLONNES = sql`
  t.id, ST_AsGeoJSON(t.geom)::json AS geometry, t.nom, t.highway, t.voies_avant, t.voies_arriere, t.vitesse_kmh,
  t.source, t.modifie, t.noeud_de, t.noeud_vers, nd.carrefour_id AS carrefour_de, nv.carrefour_id AS carrefour_vers`;

const FROM_TRONCONS = sql`troncon t JOIN noeud nd ON nd.id = t.noeud_de JOIN noeud nv ON nv.id = t.noeud_vers`;

const enveloppe = ([minLon, minLat, maxLon, maxLat]: Bbox) => sql`ST_MakeEnvelope(${minLon}, ${minLat}, ${maxLon}, ${maxLat}, 4326)`;
const pointSql = ([lon, lat]: LonLat) => sql`ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)`;

const enFeature = ({ geometry, ...properties }: LigneTroncon) => ({ type: 'Feature' as const, id: properties.id, geometry, properties });

/**
 * Un tronçon OSM corrigé (ou supprimé) à la main est gardé à la régénération. Ses moitiés, s'il a
 * été coupé, partagent ses nœuds OSM d'origine : on les marque ensemble.
 */
async function marquerModifie(db: Executeur, id: string): Promise<void> {
  await db.execute(sql`
    UPDATE troncon t SET modifie = true
    FROM troncon o
    WHERE o.id = ${id} AND t.source = 'osm'
      AND (t.id = o.id OR (t.osm_way_id, t.osm_de, t.osm_vers) = (o.osm_way_id, o.osm_de, o.osm_vers))
  `);
}

@Injectable()
export class ReseauService {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  /** Tronçons et nœuds de l'emprise. */
  async dansEmprise(bbox: Bbox): Promise<ReseauGeoJson> {
    const { rows: troncons } = await this.db.execute<LigneTroncon>(sql`
      SELECT ${COLONNES} FROM ${FROM_TRONCONS}
      WHERE NOT t.supprime AND t.geom && ${enveloppe(bbox)}
      LIMIT ${LIMITE_TRONCONS + 1}
    `);
    const { rows: noeuds } = await this.db.execute<{
      id: string;
      geometry: { type: 'Point'; coordinates: LonLat };
      carrefour_id: string | null;
      osm_node_id: number | null;
      degre: number;
      liaisons: Liaison[] | null;
    }>(sql`
      SELECT n.id, ST_AsGeoJSON(n.geom)::json AS geometry, n.carrefour_id, n.osm_node_id::float8 AS osm_node_id, n.liaisons,
             (SELECT count(*)::int FROM troncon t WHERE NOT t.supprime AND (t.noeud_de = n.id OR t.noeud_vers = n.id)) AS degre
      FROM noeud n WHERE n.geom && ${enveloppe(bbox)}
      LIMIT ${LIMITE_TRONCONS * 2}
    `);
    return {
      troncons: { type: 'FeatureCollection', features: troncons.slice(0, LIMITE_TRONCONS).map(enFeature) },
      noeuds: {
        type: 'FeatureCollection',
        features: noeuds
          .filter((n) => n.degre > 0 || n.carrefour_id !== null)
          .map(({ geometry, ...properties }) => ({ type: 'Feature' as const, id: properties.id, geometry, properties })),
      },
      tronque: troncons.length > LIMITE_TRONCONS,
    };
  }

  /**
   * Liaisons voie à voie d'un nœud ordinaire. Les tronçons qui le touchent sont marqués corrigés :
   * la régénération depuis OSM les garde, avec les identifiants auxquels les liaisons renvoient.
   */
  async enregistrerLiaisons(noeudId: string, { liaisons }: SaisieLiaisons): Promise<{ liaisons: Liaison[] | null }> {
    return this.db.transaction(async (tx) => {
      const { rows: noeuds } = await tx.execute<{ carrefour_id: string | null }>(sql`SELECT carrefour_id FROM noeud WHERE id = ${noeudId}`);
      if (!noeuds[0]) throw new NotFoundException('Nœud inconnu');
      const { rows: autour } = await tx.execute<{
        id: string;
        source: string;
        noeud_de: string;
        noeud_vers: string;
        points: LonLat[];
        voies_avant: number;
        voies_arriere: number;
      }>(sql`
        SELECT id, source, noeud_de, noeud_vers, (ST_AsGeoJSON(geom)::json)->'coordinates' AS points, voies_avant, voies_arriere
        FROM troncon WHERE NOT supprime AND (noeud_de = ${noeudId} OR noeud_vers = ${noeudId})
      `);
      if (liaisons) {
        const retenues = liaisonsRetenues(boutsAuNoeud(noeudId, autour), liaisons).liaisons;
        if (retenues.length !== liaisons.length) throw new BadRequestException('Liaison vers un tronçon ou une voie qui n’arrive pas à ce nœud');
      }
      await tx.execute(sql`UPDATE noeud SET liaisons = ${liaisons ? JSON.stringify(liaisons) : null}::jsonb WHERE id = ${noeudId}`);
      for (const t of autour) if (t.source === 'osm') await marquerModifie(tx, t.id);
      return { liaisons };
    });
  }

  generer(): Promise<BilanReseau> {
    return this.db.transaction((tx) => genererReseau(tx));
  }

  /** Tronçon tracé à la main ; ses bouts s'accrochent à des nœuds, coupent des tronçons ou en créent. */
  async creer(nouveau: NouveauTroncon) {
    const id = await this.db.transaction(async (tx) => {
      const de = await this.accrocher(tx, nouveau.de, nouveau.points[0]!);
      const vers = await this.accrocher(tx, nouveau.vers, nouveau.points.at(-1)!);
      if (de.id === vers.id) throw new BadRequestException('Un tronçon relie deux nœuds différents');
      const points = [de.position, ...nouveau.points.slice(1, -1), vers.position];
      const { rows } = await tx.execute<{ id: string }>(sql`
        INSERT INTO troncon (noeud_de, noeud_vers, geom, nom, voies_avant, voies_arriere, vitesse_kmh, source)
        VALUES (${de.id}, ${vers.id}, ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify({ type: 'LineString', coordinates: points })}), 4326),
                ${nouveau.nom}, ${nouveau.voies_avant}, ${nouveau.voies_arriere}, ${nouveau.vitesse_kmh}, 'manuel')
        RETURNING id
      `);
      return rows[0]!.id;
    });
    return this.lire(this.db, id);
  }

  async modifier(id: string, modification: ModificationTroncon) {
    await this.db.transaction(async (tx) => {
      const { rows } = await tx.execute<{ source: string; noeud_de: string; noeud_vers: string }>(sql`
        SELECT source, noeud_de, noeud_vers FROM troncon WHERE id = ${id} AND NOT supprime FOR UPDATE
      `);
      const troncon = rows[0];
      if (!troncon) throw new NotFoundException('Tronçon inconnu');
      if (modification.inverser) {
        // PostgreSQL évalue tous les SET avec les anciennes valeurs : les échanges sont simultanés.
        await tx.execute(sql`
          UPDATE troncon SET geom = ST_Reverse(geom), noeud_de = noeud_vers, noeud_vers = noeud_de,
            voies_avant = voies_arriere, voies_arriere = voies_avant, branche_de = branche_vers, branche_vers = branche_de
          WHERE id = ${id}
        `);
      }
      const champs: SQL[] = [];
      if (modification.nom !== undefined) champs.push(sql`nom = ${modification.nom}`);
      if (modification.voies_avant !== undefined) champs.push(sql`voies_avant = ${modification.voies_avant}`);
      if (modification.voies_arriere !== undefined) champs.push(sql`voies_arriere = ${modification.voies_arriere}`);
      if (modification.vitesse_kmh !== undefined) champs.push(sql`vitesse_kmh = ${modification.vitesse_kmh}`);
      if (champs.length > 0) {
        try {
          await tx.execute(sql`UPDATE troncon SET ${sql.join(champs, sql`, `)}, modifie_le = now() WHERE id = ${id}`);
        } catch (erreur) {
          if ((erreur as { cause?: { code?: string } }).cause?.code === '23514') {
            throw new BadRequestException('Au moins une voie dans un sens');
          }
          throw erreur;
        }
      }
      if (troncon.source === 'osm') await marquerModifie(tx, id);
    });
    return this.lire(this.db, id);
  }

  /** Supprime un tronçon tracé à la main ; un tronçon OSM est masqué, pour ne pas revenir à la régénération. */
  async supprimer(id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const { rows } = await tx.execute<{ source: string; noeud_de: string; noeud_vers: string }>(sql`
        SELECT source, noeud_de, noeud_vers FROM troncon WHERE id = ${id} AND NOT supprime
      `);
      const troncon = rows[0];
      if (!troncon) throw new NotFoundException('Tronçon inconnu');
      if (troncon.source === 'osm') {
        await marquerModifie(tx, id);
        await tx.execute(sql`UPDATE troncon SET supprime = true WHERE id = ${id}`);
      } else {
        await tx.execute(sql`DELETE FROM troncon WHERE id = ${id}`);
        await tx.execute(sql`
          DELETE FROM noeud n WHERE n.id IN (${troncon.noeud_de}, ${troncon.noeud_vers})
            AND n.carrefour_id IS NULL AND n.osm_node_id IS NULL
            AND NOT EXISTS (SELECT 1 FROM troncon t WHERE t.noeud_de = n.id OR t.noeud_vers = n.id)
        `);
      }
    });
  }

  /** Fichiers SUMO plain XML du réseau (dans l'emprise, ou en entier). */
  async exporter(fichier: FichierSumo, bbox?: Bbox): Promise<string> {
    if (fichier === 'reseau.netccfg') return configurationNetconvert();
    const sortie = exporterSumo(await donneesSumo(this.db, bbox));
    const alertes = sortie.alertes.map((a) => `<!-- ${a.replace(/--/g, '—')} -->`).join('\n');
    const avecAlertes = (xml: string) => (alertes ? xml.replace(/\n/, `\n${alertes}\n`) : xml);
    return fichier === 'reseau.nod.xml' ? avecAlertes(sortie.nod) : fichier === 'reseau.edg.xml' ? sortie.edg : sortie.con;
  }

  private async lire(db: Executeur, id: string) {
    const { rows } = await db.execute<LigneTroncon>(sql`SELECT ${COLONNES} FROM ${FROM_TRONCONS} WHERE t.id = ${id}`);
    if (!rows[0]) throw new NotFoundException('Tronçon inconnu');
    return enFeature(rows[0]);
  }

  /** Nœud où accrocher un bout de tronçon : existant, nouveau, ou créé en coupant un tronçon. */
  private async accrocher(tx: Executeur, accroche: Accroche, point: LonLat): Promise<{ id: string; position: LonLat }> {
    if (accroche.type === 'noeud') {
      const { rows } = await tx.execute<{ id: string; lon: number; lat: number }>(sql`
        SELECT id, ST_X(geom) AS lon, ST_Y(geom) AS lat FROM noeud WHERE id = ${accroche.id}
      `);
      if (!rows[0]) throw new NotFoundException('Nœud inconnu');
      return { id: rows[0].id, position: [rows[0].lon, rows[0].lat] };
    }
    if (accroche.type === 'libre') {
      const { rows } = await tx.execute<{ id: string }>(sql`INSERT INTO noeud (geom) VALUES (${pointSql(point)}) RETURNING id`);
      return { id: rows[0]!.id, position: point };
    }
    const { rows } = await tx.execute<{ source: string; noeud_de: string; noeud_vers: string; f: number; longueur: number; lon: number; lat: number }>(sql`
      SELECT source, noeud_de, noeud_vers, f, ST_Length(geom::geography) AS longueur,
             ST_X(ST_LineInterpolatePoint(geom, f)) AS lon, ST_Y(ST_LineInterpolatePoint(geom, f)) AS lat
      FROM (SELECT *, ST_LineLocatePoint(geom, ${pointSql(point)}) AS f FROM troncon WHERE id = ${accroche.id} AND NOT supprime) t
    `);
    const coupe = rows[0];
    if (!coupe) throw new NotFoundException('Tronçon inconnu');
    const bout = async (noeud: string) => this.accrocher(tx, { type: 'noeud', id: noeud }, point);
    if (coupe.f * coupe.longueur < TOLERANCE_BOUT_M) return bout(coupe.noeud_de);
    if ((1 - coupe.f) * coupe.longueur < TOLERANCE_BOUT_M) return bout(coupe.noeud_vers);

    const position: LonLat = [coupe.lon, coupe.lat];
    const { rows: noeud } = await tx.execute<{ id: string }>(sql`INSERT INTO noeud (geom) VALUES (${pointSql(position)}) RETURNING id`);
    const milieu = noeud[0]!.id;
    await tx.execute(sql`
      INSERT INTO troncon (noeud_de, noeud_vers, geom, osm_way_id, osm_de, osm_vers, nom, highway, voies_avant, voies_arriere,
                           vitesse_kmh, source, modifie, branche_vers)
      SELECT ${milieu}, noeud_vers, ST_LineSubstring(geom, ${coupe.f}, 1), osm_way_id, osm_de, osm_vers, nom, highway,
             voies_avant, voies_arriere, vitesse_kmh, source, modifie, branche_vers
      FROM troncon WHERE id = ${accroche.id}
    `);
    await tx.execute(sql`
      UPDATE troncon SET geom = ST_LineSubstring(geom, 0, ${coupe.f}), noeud_vers = ${milieu}, branche_vers = NULL
      WHERE id = ${accroche.id}
    `);
    if (coupe.source === 'osm') await marquerModifie(tx, accroche.id);
    return { id: milieu, position };
  }
}

/** Réseau à exporter : tronçons de l'emprise et leurs nœuds, avec le carrefour de chacun. */
export async function donneesSumo(db: Executeur, bbox?: Bbox): Promise<ReseauSumo> {
  const { rows: troncons } = await db.execute<{
    id: string;
    de: string;
    vers: string;
    points: LonLat[];
    voies_avant: number;
    voies_arriere: number;
    vitesse_kmh: number | null;
    nom: string | null;
    highway: string | null;
  }>(sql`
    SELECT t.id, t.noeud_de AS de, t.noeud_vers AS vers, (ST_AsGeoJSON(t.geom)::json)->'coordinates' AS points,
           t.voies_avant, t.voies_arriere, t.vitesse_kmh, t.nom, t.highway
    FROM troncon t
    WHERE NOT t.supprime ${bbox ? sql`AND t.geom && ${enveloppe(bbox)}` : sql``}
    ORDER BY t.id
  `);
  const idsNoeuds = [...new Set(troncons.flatMap((t) => [t.de, t.vers]))];
  const { rows: noeuds } = await db.execute<{ id: string; lon: number; lat: number; carrefour_id: string | null; liaisons: Liaison[] | null }>(sql`
    SELECT n.id, ST_X(n.geom) AS lon, ST_Y(n.geom) AS lat, n.carrefour_id, n.liaisons
    FROM noeud n
    WHERE n.id = ANY (${`{${idsNoeuds.join(',')}}`}::uuid[])
  `);
  return {
    noeuds: noeuds.map((n) => ({ id: n.id, position: [n.lon, n.lat], carrefour: n.carrefour_id, liaisons: n.liaisons })),
    troncons,
  };
}
