/**
 * Import OpenStreetMap — docs/ARCHITECTURE.md §5.
 *
 * Usage (depuis apps/api, Node 24+) :
 *   node scripts/osm.ts import [--refresh]   télécharge via Overpass (ou relit le cache
 *                                            data/osm/besancon.json), recharge les tables osm_*
 *                                            et synchronise la table `feu`
 *
 * Aucun carrefour n'est créé automatiquement : on les compose à la main sur la carte, en
 * regroupant les feux qui partagent une même programmation. Les tables osm_* sont régénérées
 * à chaque import. La table `feu` est synchronisée sans jamais perdre un rattachement : les
 * feux nouveaux sont ajoutés, les feux existants mis à jour, et ceux qui ont disparu d'OSM
 * sont marqués `present_osm = false` sans être supprimés.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { HIERARCHIE_VOIES } from '@voirie/engine';
import pg from 'pg';

/** Code INSEE de Besançon : identifie la relation de la commune. */
export const INSEE_BESANCON = '25056';

/** Emprise de téléchargement (sud, ouest, nord, est), un peu plus large que la commune. */
const EMPRISE = [47.19, 5.93, 47.3, 6.09] as const;

const MIROIRS_OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

// ─── Format Overpass ─────────────────────────────────────────────────────────────────────

type Tags = Record<string, string>;
interface Coord {
  lat: number;
  lon: number;
}

interface OverpassNode {
  type: 'node';
  id: number;
  lat: number;
  lon: number;
  tags?: Tags;
}
interface OverpassWay {
  type: 'way';
  id: number;
  nodes: number[];
  geometry: Coord[];
  tags?: Tags;
}
interface OverpassRelation {
  type: 'relation';
  id: number;
  tags?: Tags;
  members: Array<{ type: string; ref: number; role: string; geometry?: Coord[] }>;
}
export type OverpassElement = OverpassNode | OverpassWay | OverpassRelation;

export interface ReponseOverpass {
  osm3s?: { timestamp_osm_base?: string };
  elements: OverpassElement[];
}

export function requeteOverpass(): string {
  const voies = HIERARCHIE_VOIES.join('|');
  return `[out:json][timeout:180][bbox:${EMPRISE.join(',')}];
rel["boundary"="administrative"]["ref:INSEE"="${INSEE_BESANCON}"];
out geom;
node["highway"="traffic_signals"];
out body;
node["crossing"="traffic_signals"];
out body;
way["highway"~"^(${voies})(_link)?$"];
out body geom;
way["railway"="tram"];
out body geom;`;
}

// ─── Tri des éléments ────────────────────────────────────────────────────────────────────

export interface Signal {
  id: number;
  tags: Tags;
  lon: number;
  lat: number;
}
export interface Ligne {
  id: number;
  tags: Tags;
  nodes: number[];
  coords: Array<[number, number]>;
}
export interface DonneesOsm {
  horodatage: string | null;
  commune: { id: number; nom: string; contours: Array<Array<[number, number]>> };
  signaux: Signal[];
  voies: Ligne[];
  trams: Ligne[];
}

const versLonLat = (points: Coord[]): Array<[number, number]> => points.map(({ lon, lat }) => [lon, lat]);

/** Répartit la réponse Overpass par nature d'objet, sans doublons. */
export function trierElements(reponse: ReponseOverpass): DonneesOsm {
  const signaux = new Map<number, Signal>();
  const voies = new Map<number, Ligne>();
  const trams = new Map<number, Ligne>();
  let commune: DonneesOsm['commune'] | undefined;

  for (const element of reponse.elements) {
    const tags = element.tags ?? {};
    if (element.type === 'relation') {
      if (tags['ref:INSEE'] !== INSEE_BESANCON) continue;
      const contours = element.members
        .filter((m) => m.type === 'way' && m.role === 'outer' && (m.geometry?.length ?? 0) >= 2)
        .map((m) => versLonLat(m.geometry!));
      commune = { id: element.id, nom: tags.name ?? 'Besançon', contours };
    } else if (element.type === 'node') {
      if (tags.highway === 'traffic_signals' || tags.crossing === 'traffic_signals') {
        signaux.set(element.id, { id: element.id, tags, lon: element.lon, lat: element.lat });
      }
    } else if (element.geometry?.length >= 2) {
      const ligne = { id: element.id, tags, nodes: element.nodes, coords: versLonLat(element.geometry) };
      if (tags.railway === 'tram') trams.set(element.id, ligne);
      else if (tags.highway) voies.set(element.id, ligne);
    }
  }

  if (!commune || commune.contours.length === 0) {
    throw new Error(`Relation de la commune (INSEE ${INSEE_BESANCON}) absente de la réponse Overpass`);
  }
  return {
    horodatage: reponse.osm3s?.timestamp_osm_base ?? null,
    commune,
    signaux: [...signaux.values()],
    voies: [...voies.values()],
    trams: [...trams.values()],
  };
}

// ─── Téléchargement ──────────────────────────────────────────────────────────────────────

export async function telechargerOverpass(): Promise<ReponseOverpass> {
  const erreurs: string[] = [];
  for (const url of MIROIRS_OVERPASS) {
    try {
      const reponse = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'besancon-voirie/0.1 (projet citoyen open source)',
        },
        body: new URLSearchParams({ data: requeteOverpass() }),
        signal: AbortSignal.timeout(200_000),
      });
      const texte = await reponse.text();
      if (!reponse.ok || !texte.startsWith('{')) {
        throw new Error(`HTTP ${reponse.status} : ${texte.slice(0, 200).replace(/\s+/g, ' ')}`);
      }
      console.log(`Overpass : réponse de ${new URL(url).host}`);
      return JSON.parse(texte) as ReponseOverpass;
    } catch (erreur) {
      erreurs.push(`${url} → ${(erreur as Error).message}`);
    }
  }
  throw new Error(`Overpass injoignable :\n${erreurs.join('\n')}`);
}

// ─── Chargement des tables osm_* ─────────────────────────────────────────────────────────

const ligneGeoJson = (coords: Array<[number, number]>) => ({ type: 'LineString', coordinates: coords });

export interface BilanFeux {
  /** Feux de la commune présents dans cet import. */
  presents: number;
  nouveaux: number;
  /** Feux connus qui ne sont plus dans OSM (conservés, marqués present_osm = false). */
  disparus: number;
}

export interface BilanImport {
  signaux: number;
  voies: number;
  trams: number;
  feux: BilanFeux;
}

/**
 * Synchronise la table `feu` avec les feux OSM situés dans la commune. Ne touche jamais au
 * rattachement d'un feu à un carrefour.
 */
async function synchroniserFeux(client: pg.ClientBase): Promise<BilanFeux> {
  const { rows } = await client.query<{ nouveau: boolean }>(`
    INSERT INTO feu (osm_id, type, tags, geom, present_osm)
    SELECT s.osm_id,
           CASE WHEN coalesce(s.tags->>'highway' = 'traffic_signals', false)
                THEN 'vehicule' ELSE 'pieton' END::type_feu,
           s.tags, s.geom, true
    FROM osm_signal s
    JOIN osm_commune c ON ST_Intersects(s.geom, c.geom)
    ON CONFLICT (osm_id) DO UPDATE
      SET type = EXCLUDED.type, tags = EXCLUDED.tags, geom = EXCLUDED.geom, present_osm = true
    RETURNING (xmax = 0) AS nouveau
  `);
  const { rowCount: disparus } = await client.query(`
    UPDATE feu SET present_osm = false
    WHERE present_osm AND osm_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM osm_signal s JOIN osm_commune c ON ST_Intersects(s.geom, c.geom) WHERE s.osm_id = feu.osm_id
    )
  `);
  return { presents: rows.length, nouveaux: rows.filter((r) => r.nouveau).length, disparus: disparus ?? 0 };
}

/** Recrée les tables osm_*, y charge les données et synchronise `feu`, en une transaction. */
export async function chargerOsm(client: pg.ClientBase, donnees: DonneesOsm): Promise<BilanImport> {
  await client.query('BEGIN');
  try {
    await client.query(`
      DROP TABLE IF EXISTS osm_meta, osm_commune, osm_signal, osm_way, osm_tram;
      CREATE TABLE osm_meta (cle text PRIMARY KEY, valeur text);
      CREATE TABLE osm_commune (osm_id bigint PRIMARY KEY, nom text NOT NULL, geom geometry(MultiPolygon, 4326) NOT NULL);
      CREATE TABLE osm_signal (osm_id bigint PRIMARY KEY, tags jsonb NOT NULL, geom geometry(Point, 4326) NOT NULL);
      CREATE TABLE osm_way (osm_id bigint PRIMARY KEY, tags jsonb NOT NULL, nodes bigint[] NOT NULL, geom geometry(LineString, 4326) NOT NULL);
      CREATE TABLE osm_tram (osm_id bigint PRIMARY KEY, tags jsonb NOT NULL, nodes bigint[] NOT NULL, geom geometry(LineString, 4326) NOT NULL);
    `);

    await client.query(
      `INSERT INTO osm_commune (osm_id, nom, geom)
       SELECT $1, $2, ST_Multi(ST_CollectionExtract(ST_Polygonize(geom), 3))
       FROM (SELECT ST_SetSRID(ST_GeomFromGeoJSON(g), 4326) AS geom FROM jsonb_array_elements_text($3::jsonb) g) l`,
      [
        donnees.commune.id,
        donnees.commune.nom,
        JSON.stringify(donnees.commune.contours.map((c) => JSON.stringify(ligneGeoJson(c)))),
      ],
    );
    const { rows: commune } = await client.query<{ vide: boolean }>(
      'SELECT ST_IsEmpty(geom) AS vide FROM osm_commune',
    );
    if (commune[0]?.vide !== false) throw new Error('Contour de la commune impossible à reconstituer');

    await client.query(
      `INSERT INTO osm_signal (osm_id, tags, geom)
       SELECT (e->>'id')::bigint, e->'tags', ST_SetSRID(ST_MakePoint((e->>'lon')::float8, (e->>'lat')::float8), 4326)
       FROM jsonb_array_elements($1::jsonb) e`,
      [JSON.stringify(donnees.signaux)],
    );

    for (const [table, lignes] of [
      ['osm_way', donnees.voies],
      ['osm_tram', donnees.trams],
    ] as const) {
      await client.query(
        `INSERT INTO ${table} (osm_id, tags, nodes, geom)
         SELECT (e->>'id')::bigint, e->'tags',
                ARRAY(SELECT jsonb_array_elements_text(e->'nodes')::bigint),
                ST_SetSRID(ST_GeomFromGeoJSON(e->>'geom'), 4326)
         FROM jsonb_array_elements($1::jsonb) e`,
        [
          JSON.stringify(
            lignes.map((l) => ({ id: l.id, tags: l.tags, nodes: l.nodes, geom: JSON.stringify(ligneGeoJson(l.coords)) })),
          ),
        ],
      );
    }

    await client.query(`
      CREATE INDEX ON osm_signal USING gist (geom);
      CREATE INDEX ON osm_signal USING gist ((geom::geography));
      CREATE INDEX ON osm_way USING gist (geom);
      CREATE INDEX ON osm_way USING gist ((geom::geography));
      CREATE INDEX ON osm_tram USING gist ((geom::geography));
    `);
    await client.query(
      `INSERT INTO osm_meta (cle, valeur) VALUES ('timestamp_osm_base', $1), ('importe_le', now()::text)`,
      [donnees.horodatage],
    );

    const feux = await synchroniserFeux(client);
    await client.query('COMMIT');
    return { signaux: donnees.signaux.length, voies: donnees.voies.length, trams: donnees.trams.length, feux };
  } catch (erreur) {
    await client.query('ROLLBACK');
    throw erreur;
  }
}

// ─── Ligne de commande ───────────────────────────────────────────────────────────────────

async function principal(commande: string | undefined, options: string[]) {
  const racine = fileURLToPath(new URL('../../../', import.meta.url));
  const env = parseEnv(readFileSync(`${racine}.env`, 'utf8'));
  const databaseUrl = process.env.DATABASE_URL ?? env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL manquant');

  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    if (commande === 'import') {
      const cache = `${racine}data/osm/besancon.json`;
      let reponse: ReponseOverpass;
      if (existsSync(cache) && !options.includes('--refresh')) {
        console.log(`Cache Overpass : ${cache} (--refresh pour retélécharger)`);
        reponse = JSON.parse(readFileSync(cache, 'utf8')) as ReponseOverpass;
      } else {
        console.log('Téléchargement Overpass…');
        reponse = await telechargerOverpass();
        mkdirSync(dirname(cache), { recursive: true });
        writeFileSync(cache, JSON.stringify(reponse));
      }
      const donnees = trierElements(reponse);
      const bilan = await chargerOsm(client, donnees);
      console.log(`Données OSM du ${donnees.horodatage ?? '?'} :`, bilan);
    } else {
      console.error('Usage : node scripts/osm.ts import [--refresh]');
      process.exitCode = 1;
    }
  } finally {
    await client.end();
  }
}

if (import.meta.main) {
  await principal(process.argv[2], process.argv.slice(3));
}
