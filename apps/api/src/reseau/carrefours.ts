/**
 * Carrefours bâtis sur le réseau — docs/RESEAU.md §4. Un carrefour est un groupe de nœuds : ceux
 * qui se trouvent parmi ses feux quand on le compose, complétés ou retirés à la main. Ses
 * branches et leurs voies (tables `branche`, `voie`) se déduisent de ces nœuds et sont
 * recalculées à chaque modification du réseau autour d'eux ; ses connexions aussi, tant qu'elles
 * n'ont pas été saisies à la main (`carrefour.connexions_saisies`), après quoi elles sont gardées.
 */
import { vueCarrefour, type LonLat, type NoeudVue, type TronconVue, type TypeVoieReseau } from '@voirie/engine';
import type { Branche, Liaison } from '@voirie/schema';
import { sql } from 'drizzle-orm';
import { connexionsEnregistrees, ecrireBranches } from '../branches/branches.service.js';
import { tableExiste, type Executeur } from '../db/sql.js';

/** Marge (m) autour de l'enveloppe des feux : les nœuds qu'elle couvre entrent dans le carrefour. */
export const MARGE_NOEUDS_M = 8;

const uuids = (ids: readonly string[]) => `{${ids.join(',')}}`;

/**
 * Met dans le carrefour les nœuds libres qui se trouvent parmi ses feux : dans leur enveloppe
 * (élargie de quelques mètres), ou sur un feu OSM. Un giratoire prend aussi tout son anneau.
 * Les nœuds déjà pris (à la main, ou par un autre carrefour) ne bougent pas.
 */
export async function rattacherNoeuds(db: Executeur, carrefourId: string): Promise<number> {
  if (!(await tableExiste(db, 'noeud'))) return 0;
  const { rowCount } = await db.execute(sql`
    UPDATE noeud n SET carrefour_id = ${carrefourId}
    FROM (SELECT ST_ConvexHull(ST_Collect(geom)) AS enveloppe, array_agg(osm_id) AS osm FROM feu WHERE carrefour_id = ${carrefourId}) f
    WHERE n.carrefour_id IS NULL AND f.enveloppe IS NOT NULL
      AND (ST_DWithin(n.geom::geography, f.enveloppe::geography, ${MARGE_NOEUDS_M}) OR n.osm_node_id = ANY (f.osm))
      AND EXISTS (SELECT 1 FROM troncon t WHERE NOT t.supprime AND (t.noeud_de = n.id OR t.noeud_vers = n.id))
  `);
  const { rowCount: anneau } = await db.execute(sql`
    WITH RECURSIVE anneau(id) AS (
      SELECT n.id FROM noeud n JOIN carrefour c ON c.id = n.carrefour_id
      WHERE n.carrefour_id = ${carrefourId} AND c.nature = 'giratoire'
      UNION
      SELECT CASE WHEN t.noeud_de = a.id THEN t.noeud_vers ELSE t.noeud_de END
      FROM anneau a JOIN troncon t ON (t.noeud_de = a.id OR t.noeud_vers = a.id) AND NOT t.supprime
      WHERE t.osm_tags->>'junction' IN ('roundabout', 'circular')
    )
    UPDATE noeud SET carrefour_id = ${carrefourId} WHERE id IN (SELECT id FROM anneau) AND carrefour_id IS NULL
  `);
  return (rowCount ?? 0) + (anneau ?? 0);
}

/**
 * Recalcule les branches, voies et connexions d'un carrefour d'après ses nœuds, et garde les
 * codes de ses branches sur les bouts de tronçons. Des connexions saisies à la main sont gardées,
 * sauf celles dont une voie a disparu. Sans effet (false) pour un carrefour sans nœud, dont les
 * branches se saisissent à la main.
 */
export async function materialiserCarrefour(db: Executeur, carrefourId: string): Promise<boolean> {
  const { rows: noeuds } = await db.execute<{ id: string; lon: number; lat: number; feux: boolean; pieton: string | null; liaisons: Liaison[] | null }>(sql`
    SELECT id, ST_X(geom) AS lon, ST_Y(geom) AS lat, feux, pieton, liaisons FROM noeud WHERE carrefour_id = ${carrefourId}
  `);
  if (noeuds.length === 0) return false;
  const ids = noeuds.map((n) => n.id);
  const { rows: troncons } = await db.execute<Omit<TronconVue, 'points'> & { points: LonLat[] }>(sql`
    SELECT id, noeud_de, noeud_vers, (ST_AsGeoJSON(geom)::json)->'coordinates' AS points, voies_avant, voies_arriere,
           types_avant, types_arriere, nom, osm_way_id::float8 AS osm_way_id, branche_de, branche_vers
    FROM troncon
    WHERE NOT supprime AND (noeud_de = ANY (${uuids(ids)}::uuid[]) OR noeud_vers = ANY (${uuids(ids)}::uuid[]))
  `);
  const touches = [...new Set(troncons.flatMap((t) => [t.noeud_de, t.noeud_vers]))];
  const { rows: degres } = await db.execute<{ id: string; degre: number }>(sql`
    SELECT n AS id, count(*)::int AS degre FROM (
      SELECT noeud_de AS n FROM troncon WHERE NOT supprime UNION ALL SELECT noeud_vers FROM troncon WHERE NOT supprime
    ) b WHERE n = ANY (${uuids(touches)}::uuid[]) GROUP BY n
  `);

  // Passages piétons libres qui traversent ces tronçons (docs/pipeline-donnees.md, étape 11).
  const { rows: passages } = await db.execute<{ id: string; points: [LonLat, LonLat]; troncons: string[] }>(sql`
    SELECT id, (ST_AsGeoJSON(geom)::json)->'coordinates' AS points, troncons::text[] AS troncons FROM passage_pieton
    WHERE troncons && ${uuids(troncons.map((t) => t.id))}::uuid[]
    ORDER BY cree_le
  `);
  const vue = vueCarrefour({
    noeuds: noeuds.map((n): NoeudVue => ({ id: n.id, position: [n.lon, n.lat], feux: n.feux, pieton: n.pieton, liaisons: n.liaisons })),
    troncons: troncons.map((t) => ({ ...t, types_avant: t.types_avant as TypeVoieReseau[] | null, types_arriere: t.types_arriere as TypeVoieReseau[] | null })),
    degres: new Map(degres.map((d) => [d.id, d.degre])),
    passages,
  });
  const branches: Branche[] = vue.branches.map((b) => ({
    code: b.code,
    nom: b.nom,
    azimut: b.azimut,
    osm_way_id: b.osm_way_id,
    geom: b.geom,
    voies: b.voies,
    traversee: b.traversee,
    priorite_entree: null,
    noeud: null,
    troncon: false,
  }));
  const { rows: etat } = await db.execute<{ saisies: boolean }>(sql`SELECT connexions_saisies AS saisies FROM carrefour WHERE id = ${carrefourId}`);
  const connexions = etat[0]?.saisies ? await connexionsEnregistrees(db, carrefourId) : vue.connexions;
  const passagesBranches = new Map(vue.branches.flatMap((b) => (b.passage ? [[b.code, b.passage] as const] : [])));
  await ecrireBranches(db, carrefourId, { branches, connexions, anneau: null }, passagesBranches);
  for (const { troncon, extremite, code } of vue.codes) {
    await db.execute(
      extremite === 'de'
        ? sql`UPDATE troncon SET branche_de = ${code} WHERE id = ${troncon}`
        : sql`UPDATE troncon SET branche_vers = ${code} WHERE id = ${troncon}`,
    );
  }
  return true;
}

/** Recalcule les carrefours dont font partie ces nœuds (bouts de tronçons modifiés, nœud déplacé…). */
export async function rafraichirCarrefours(db: Executeur, noeuds: readonly string[]): Promise<void> {
  if (noeuds.length === 0) return;
  const { rows } = await db.execute<{ carrefour_id: string }>(sql`
    SELECT DISTINCT carrefour_id FROM noeud WHERE carrefour_id IS NOT NULL AND id = ANY (${uuids(noeuds)}::uuid[])
  `);
  for (const { carrefour_id } of rows) await materialiserCarrefour(db, carrefour_id);
}

/** Retrouve les nœuds de chaque carrefour (après un nouveau semis) et recalcule leurs branches. */
export async function rattacherTousLesCarrefours(db: Executeur): Promise<number> {
  const { rows } = await db.execute<{ id: string }>(sql`SELECT DISTINCT carrefour_id AS id FROM feu WHERE carrefour_id IS NOT NULL`);
  let rattaches = 0;
  for (const { id } of rows) {
    if ((await rattacherNoeuds(db, id)) > 0) {
      await materialiserCarrefour(db, id);
      rattaches++;
    }
  }
  return rattaches;
}
