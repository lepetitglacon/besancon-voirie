/**
 * Import des feux OpenStreetMap — docs/ARCHITECTURE.md §5. Lancé par la ligne de commande
 * (scripts/osm.ts) ou par l'application (outil « Zone OSM » du mode Édition, OsmService). Les
 * voies et le tram ne sont pas importés : ils se chargent à la demande autour d'un carrefour
 * (voies-osm.ts).
 *
 * Aucun carrefour n'est créé automatiquement : on les compose à la main sur la carte, en
 * regroupant les feux qui partagent une même programmation. Les tables osm_* sont régénérées
 * à chaque import. La table `feu` est synchronisée sans jamais perdre un rattachement : les
 * feux nouveaux sont ajoutés, les feux existants mis à jour, et ceux qui ont disparu d'OSM (ou
 * sortis de la zone) sont marqués `present_osm = false` sans être supprimés.
 *
 * La zone d'import (table `zone_osm`) fixe l'emprise téléchargée et les feux retenus ; sans
 * zone, l'emprise par défaut et les feux de la commune de Besançon. SUMO a son propre cache
 * (data/osm/besancon.json), que cet import ne touche pas.
 */
import pg from 'pg';

/** Code INSEE de Besançon : identifie la relation de la commune. */
export const INSEE_BESANCON = '25056';

/** Emprise de téléchargement (sud, ouest, nord, est). */
export type Emprise = readonly [number, number, number, number];

/** Sans zone d'import : un peu plus large que la commune de Besançon. */
export const EMPRISE_COMMUNE: Emprise = [47.19, 5.93, 47.3, 6.09];


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

/**
 * Feux de l'emprise ; le contour de la commune de Besançon quand il sert de zone (aucune zone
 * d'import enregistrée). Les voies et le tram se chargent à la demande, autour d'un carrefour
 * (voies-osm.ts).
 */
export function requeteOverpass(emprise: Emprise = EMPRISE_COMMUNE, { commune = true }: { commune?: boolean } = {}): string {
  return `[out:json][timeout:180][bbox:${emprise.join(',')}];
${commune ? `rel["boundary"="administrative"]["ref:INSEE"="${INSEE_BESANCON}"];\nout geom;\n` : ''}node["highway"="traffic_signals"];
out body;
node["crossing"="traffic_signals"];
out body;`;
}

/**
 * Tables des voies chargées à la demande : elles survivent aux imports. Une base importée avant
 * le chargement à la demande avait toutes les voies de l'emprise par défaut : elle est notée
 * comme couverte.
 */
export const DDL_VOIES = `
  CREATE TABLE IF NOT EXISTS osm_way (osm_id bigint PRIMARY KEY, tags jsonb NOT NULL, nodes bigint[] NOT NULL, geom geometry(LineString, 4326) NOT NULL);
  CREATE TABLE IF NOT EXISTS osm_tram (osm_id bigint PRIMARY KEY, tags jsonb NOT NULL, nodes bigint[] NOT NULL, geom geometry(LineString, 4326) NOT NULL);
  CREATE INDEX IF NOT EXISTS osm_way_geom_idx ON osm_way USING gist (geom);
  CREATE INDEX IF NOT EXISTS osm_way_geog_idx ON osm_way USING gist ((geom::geography));
  CREATE INDEX IF NOT EXISTS osm_tram_geog_idx ON osm_tram USING gist ((geom::geography));
  CREATE TABLE IF NOT EXISTS osm_voies_chargees (
    id serial PRIMARY KEY, geom geometry(Polygon, 4326) NOT NULL, chargee_le timestamptz NOT NULL DEFAULT now()
  );
  INSERT INTO osm_voies_chargees (geom)
  SELECT ST_MakeEnvelope(${EMPRISE_COMMUNE[1]}, ${EMPRISE_COMMUNE[0]}, ${EMPRISE_COMMUNE[3]}, ${EMPRISE_COMMUNE[2]}, 4326)
  WHERE EXISTS (SELECT 1 FROM osm_way) AND NOT EXISTS (SELECT 1 FROM osm_voies_chargees);
`;

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
  /** null quand une zone d'import est enregistrée : la commune n'est alors pas demandée. */
  commune: { id: number; nom: string; contours: Array<Array<[number, number]>> } | null;
  signaux: Signal[];
  voies: Ligne[];
  trams: Ligne[];
}

const versLonLat = (points: Coord[]): Array<[number, number]> => points.map(({ lon, lat }) => [lon, lat]);

/** Répartit la réponse Overpass par nature d'objet, sans doublons. */
export function trierElements(reponse: ReponseOverpass, { exigerCommune = true }: { exigerCommune?: boolean } = {}): DonneesOsm {
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

  if (exigerCommune && (!commune || commune.contours.length === 0)) {
    throw new Error(`Relation de la commune (INSEE ${INSEE_BESANCON}) absente de la réponse Overpass`);
  }
  return {
    horodatage: reponse.osm3s?.timestamp_osm_base ?? null,
    commune: commune ?? null,
    signaux: [...signaux.values()],
    voies: [...voies.values()],
    trams: [...trams.values()],
  };
}

// ─── Téléchargement ──────────────────────────────────────────────────────────────────────

/** Essaie les miroirs l'un après l'autre ; `delaiMs` : abandon d'un miroir (import complet : 11 min). */
export async function telechargerOverpass(requete: string = requeteOverpass(), delaiMs = 660_000): Promise<ReponseOverpass> {
  const erreurs: string[] = [];
  for (const url of MIROIRS_OVERPASS) {
    try {
      const reponse = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'besancon-voirie/0.1 (projet citoyen open source)',
        },
        body: new URLSearchParams({ data: requete }),
        signal: AbortSignal.timeout(delaiMs),
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
 * rattachement d'un feu à un carrefour. La position OSM va dans `geom_osm` ; `geom` la suit,
 * sauf pour un feu placé à la main sur la photo.
 */
async function synchroniserFeux(client: pg.ClientBase): Promise<BilanFeux> {
  // Zone retenue : la zone d'import, sinon la commune ; sans l'une ni l'autre, tout l'import.
  await client.query(`
    CREATE TEMP TABLE zone_retenue ON COMMIT DROP AS
    SELECT geom FROM zone_osm
    UNION ALL
    SELECT geom FROM osm_commune WHERE NOT EXISTS (SELECT 1 FROM zone_osm);
    -- Zone de cet import, affichée par l'outil « Zone OSM » (« dernière zone importée »).
    INSERT INTO osm_zone (nom, geom)
    SELECT coalesce((SELECT source->'contour'->>'nom' FROM zone_osm), (SELECT nom FROM osm_commune LIMIT 1), 'Zone d''import'),
           ST_Multi(ST_Union(geom))
    FROM zone_retenue HAVING count(*) > 0;
    CREATE TEMP TABLE signal_retenu ON COMMIT DROP AS
    SELECT s.* FROM osm_signal s
    WHERE NOT EXISTS (SELECT 1 FROM zone_retenue) OR EXISTS (SELECT 1 FROM zone_retenue z WHERE ST_Intersects(s.geom, z.geom));
  `);
  const { rows } = await client.query<{ nouveau: boolean }>(`
    INSERT INTO feu (osm_id, type, tags, geom, geom_osm, present_osm)
    SELECT s.osm_id,
           CASE WHEN coalesce(s.tags->>'highway' = 'traffic_signals', false)
                THEN 'vehicule' ELSE 'pieton' END::type_feu,
           s.tags, s.geom, s.geom, true
    FROM signal_retenu s
    ON CONFLICT (osm_id) DO UPDATE
      SET type = EXCLUDED.type, tags = EXCLUDED.tags, geom_osm = EXCLUDED.geom_osm, present_osm = true,
          geom = CASE WHEN feu.position_manuelle THEN feu.geom ELSE EXCLUDED.geom_osm END
    RETURNING (xmax = 0) AS nouveau
  `);
  const { rowCount: disparus } = await client.query(`
    UPDATE feu SET present_osm = false
    WHERE present_osm AND osm_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM signal_retenu s WHERE s.osm_id = feu.osm_id
    )
  `);
  return { presents: rows.length, nouveaux: rows.filter((r) => r.nouveau).length, disparus: disparus ?? 0 };
}

/**
 * Recrée les tables des feux (osm_signal, osm_commune, osm_zone, osm_meta), y charge les
 * données et synchronise `feu`, en une transaction. Les voies chargées à la demande restent.
 */
export async function chargerOsm(client: pg.ClientBase, donnees: DonneesOsm): Promise<BilanImport> {
  await client.query('BEGIN');
  try {
    await client.query(`
      DROP TABLE IF EXISTS osm_meta, osm_commune, osm_zone, osm_signal;
      CREATE TABLE osm_meta (cle text PRIMARY KEY, valeur text);
      CREATE TABLE osm_zone (nom text NOT NULL, geom geometry(MultiPolygon, 4326) NOT NULL);
      CREATE TABLE osm_commune (osm_id bigint PRIMARY KEY, nom text NOT NULL, geom geometry(MultiPolygon, 4326) NOT NULL);
      CREATE TABLE osm_signal (osm_id bigint PRIMARY KEY, tags jsonb NOT NULL, geom geometry(Point, 4326) NOT NULL);
    `);
    await client.query(DDL_VOIES);

    // Sans zone d'import, le contour de la commune sert de zone.
    if (donnees.commune) {
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
    }

    await client.query(
      `INSERT INTO osm_signal (osm_id, tags, geom)
       SELECT (e->>'id')::bigint, e->'tags', ST_SetSRID(ST_MakePoint((e->>'lon')::float8, (e->>'lat')::float8), 4326)
       FROM jsonb_array_elements($1::jsonb) e`,
      [JSON.stringify(donnees.signaux)],
    );

    // Voies fournies avec l'import (jeux de test, ancien cache) : elles remplacent celles en base,
    // et leur emprise compte comme chargée. Sinon, les voies chargées à la demande restent.
    if (donnees.voies.length > 0) {
      await client.query('TRUNCATE osm_way, osm_tram, osm_voies_chargees');
    }
    for (const [table, lignes] of [
      ['osm_way', donnees.voies],
      ['osm_tram', donnees.trams],
    ] as const) {
      if (lignes.length === 0) continue;
      await client.query(
        `INSERT INTO ${table} (osm_id, tags, nodes, geom)
         SELECT (e->>'id')::bigint, e->'tags',
                ARRAY(SELECT jsonb_array_elements_text(e->'nodes')::bigint),
                ST_SetSRID(ST_GeomFromGeoJSON(e->>'geom'), 4326)
         FROM jsonb_array_elements($1::jsonb) e
         ON CONFLICT (osm_id) DO UPDATE SET tags = EXCLUDED.tags, nodes = EXCLUDED.nodes, geom = EXCLUDED.geom`,
        [
          JSON.stringify(
            lignes.map((l) => ({ id: l.id, tags: l.tags, nodes: l.nodes, geom: JSON.stringify(ligneGeoJson(l.coords)) })),
          ),
        ],
      );
    }
    if (donnees.voies.length > 0) {
      await client.query(`INSERT INTO osm_voies_chargees (geom) SELECT ST_Expand(ST_Envelope(ST_Extent(geom)), 0.01) FROM osm_way`);
    }

    await client.query(`
      CREATE INDEX ON osm_signal USING gist (geom);
      CREATE INDEX ON osm_signal USING gist ((geom::geography));
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

// ─── Import de la zone ───────────────────────────────────────────────────────────────────

/** Emprise de la zone d'import enregistrée (les feux sont ensuite filtrés sur la zone) ; null sans zone. */
export async function empriseZone(client: Pick<pg.ClientBase, 'query'>): Promise<Emprise | null> {
  const { rows } = await client.query<{ sud: number; ouest: number; nord: number; est: number }>(
    `SELECT ST_YMin(b) AS sud, ST_XMin(b) AS ouest, ST_YMax(b) AS nord, ST_XMax(b) AS est
     FROM (SELECT ST_Extent(geom) AS b FROM zone_osm) e WHERE b IS NOT NULL`,
  );
  const e = rows[0];
  if (!e) return null;
  const arrondi = (v: number, sens: 1 | -1) => Math.round(v * 1e4 + sens * 0.5) / 1e4;
  return [arrondi(e.sud, -1), arrondi(e.ouest, -1), arrondi(e.nord, 1), arrondi(e.est, 1)];
}

export interface OptionsImport {
  /** Étapes, pour suivre l'avancement. */
  etape?: (etape: 'telechargement' | 'chargement', detail: string) => void;
}

/**
 * Télécharge les feux de la zone d'import (ou de l'emprise par défaut et le contour de la
 * commune, sans zone), recharge les tables des feux et synchronise `feu`. Une seule requête
 * légère : quelques secondes, même pour une intercommunalité.
 */
export async function importerOsm(client: pg.ClientBase, { etape }: OptionsImport = {}) {
  const zone = await empriseZone(client);
  const emprise = zone ?? EMPRISE_COMMUNE;
  etape?.('telechargement', `feux, emprise ${emprise.join(', ')}`);
  const reponse = await telechargerOverpass(requeteOverpass(emprise, { commune: zone === null }), 240_000);
  etape?.('chargement', `${reponse.elements.length} éléments`);
  const donnees = trierElements(reponse, { exigerCommune: zone === null });
  const bilan = await chargerOsm(client, donnees);
  return { horodatage: donnees.horodatage, bilan };
}
