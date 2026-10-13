import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type pg from 'pg';
import type { ContourOsm, EnregistrementZoneOsm, ImportOsm, PolygonesZone, ZoneOsm } from '@voirie/schema';
import { DRIZZLE, PG_POOL, type Db } from '../db/db.module.js';
import { tableExiste } from '../db/sql.js';
import { importerOsm, telechargerOverpass } from './import-osm.js';

/** Un contour administratif repris comme zone est élargi d'autant (m), puis simplifié. */
const MARGE_CONTOUR_M = 250;
/** Tolérance de simplification (degrés, ~150 m) : quelques centaines de sommets à retoucher. */
const SIMPLIFICATION_DEG = 0.002;
/** La zone importée n'est que dessinée : simplifiée plus finement (~40 m). */
const SIMPLIFICATION_AFFICHAGE_DEG = 0.0005;
/** Requêtes de contours, légères : un miroir lent est abandonné au profit du suivant. */
const DELAI_CONTOURS_MS = 90_000;

type LonLat = [number, number];

/** Anneau GeoJSON (fermé) → contour ouvert, tel que l'éditeur le manipule. */
const ouvrir = (anneau: LonLat[]): LonLat[] => {
  const [premier, dernier] = [anneau[0], anneau.at(-1)];
  return premier && dernier && premier[0] === dernier[0] && premier[1] === dernier[1] ? anneau.slice(0, -1) : anneau;
};

/** Contours extérieurs d'un MultiPolygon GeoJSON ; les trous sont ignorés. */
const polygonesDe = (coordonnees: LonLat[][][]): PolygonesZone => coordonnees.map((polygone) => ouvrir(polygone[0]!));

/** Nature lisible d'un contour : commune, intercommunalité, département… */
function nature(tags: Record<string, string>): { nature: string; rang: number } {
  if (tags.boundary === 'local_authority') return { nature: 'Intercommunalité', rang: 1 };
  switch (tags.admin_level) {
    case '8':
      return { nature: 'Commune', rang: 0 };
    case '7':
      return { nature: 'Arrondissement', rang: 2 };
    case '6':
      return { nature: 'Département', rang: 3 };
    case '4':
      return { nature: 'Région', rang: 4 };
    default:
      return { nature: `Limite administrative (niveau ${tags.admin_level ?? '?'})`, rang: 5 };
  }
}

/**
 * Zone d'import OSM de l'instance, contours administratifs pour la tracer, et import lancé
 * depuis l'application — docs/ARCHITECTURE.md §5. Un seul import à la fois, suivi en mémoire.
 */
@Injectable()
export class OsmService {
  private readonly journal = new Logger(OsmService.name);
  private etat: ImportOsm = { statut: 'inactif', debut: null, fin: null, erreur: null, bilan: null };

  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    @Inject(PG_POOL) private readonly pool: pg.Pool,
  ) {}

  private get enCours() {
    return this.etat.statut === 'telechargement' || this.etat.statut === 'chargement';
  }

  async lire(): Promise<ZoneOsm> {
    const { rows } = await this.db.execute<{ coordonnees: LonLat[][][]; source: ZoneOsm['source']; modifiee_le: string; km2: number }>(sql`
      SELECT (ST_AsGeoJSON(geom, 6)::json)->'coordinates' AS coordonnees, source,
             modifiee_le::text AS modifiee_le, ST_Area(geom::geography) / 1e6 AS km2
      FROM zone_osm
    `);
    const zone = rows[0];
    let dernier: ZoneOsm['dernier_import'] = null;
    if (await tableExiste(this.db, 'osm_meta')) {
      const { rows: meta } = await this.db.execute<{ cle: string; valeur: string }>(sql`SELECT cle, valeur FROM osm_meta`);
      const valeur = (cle: string) => meta.find((m) => m.cle === cle)?.valeur ?? null;
      dernier = { importe_le: valeur('importe_le'), donnees_du: valeur('timestamp_osm_base') };
    }
    // Zone du dernier import ; un import antérieur à osm_zone gardait les feux de la commune.
    const tableImportee = (await tableExiste(this.db, 'osm_zone'))
      ? 'osm_zone'
      : (await tableExiste(this.db, 'osm_commune'))
        ? 'osm_commune'
        : null;
    let importee: ZoneOsm['zone_importee'] = null;
    if (tableImportee) {
      const { rows: zones } = await this.db.execute<{ nom: string; coordonnees: LonLat[][][]; km2: number }>(sql`
        SELECT nom, (ST_AsGeoJSON(ST_Multi(ST_CollectionExtract(ST_SimplifyPreserveTopology(geom, ${SIMPLIFICATION_AFFICHAGE_DEG}), 3)), 6)::json)->'coordinates' AS coordonnees,
               ST_Area(geom::geography) / 1e6 AS km2
        FROM ${sql.identifier(tableImportee)} LIMIT 1
      `);
      const z = zones[0];
      if (z?.coordonnees?.length) importee = { nom: z.nom, polygones: polygonesDe(z.coordonnees), superficie_km2: Math.round(z.km2 * 10) / 10 };
    }
    const { rows: feux } = await this.db.execute<ZoneOsm['feux']>(sql`
      SELECT count(*) FILTER (WHERE present_osm)::int AS presents,
             count(*) FILTER (WHERE NOT present_osm AND osm_id IS NOT NULL)::int AS absents,
             count(*) FILTER (WHERE carrefour_id IS NOT NULL)::int AS rattaches
      FROM feu
    `);
    return {
      polygones: zone ? polygonesDe(zone.coordonnees) : null,
      source: zone?.source ?? null,
      modifiee_le: zone?.modifiee_le ?? null,
      superficie_km2: zone ? Math.round(zone.km2 * 10) / 10 : null,
      zone_importee: importee,
      dernier_import: dernier,
      feux: feux[0]!,
      import: this.etat,
    };
  }

  /** Enregistre la zone ; elle ne s'applique aux feux qu'au prochain import. */
  async enregistrer({ polygones, source }: EnregistrementZoneOsm): Promise<ZoneOsm> {
    if (this.enCours) throw new ConflictException('Import OSM en cours : la zone ne peut pas changer');
    const geometrie = JSON.stringify({
      type: 'MultiPolygon',
      coordinates: polygones.map((contour) => [[...contour, contour[0]!]]),
    });
    await this.db.execute(sql`
      INSERT INTO zone_osm (id, geom, source, modifiee_le)
      VALUES (1, ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(${geometrie}), 4326)), 3)),
              ${JSON.stringify(source)}::jsonb, now())
      ON CONFLICT (id) DO UPDATE SET geom = EXCLUDED.geom, source = EXCLUDED.source, modifiee_le = now()
    `);
    return this.lire();
  }

  /** Supprime la zone : l'import suivant revient à la commune de Besançon. */
  async supprimer(): Promise<ZoneOsm> {
    if (this.enCours) throw new ConflictException('Import OSM en cours : la zone ne peut pas changer');
    await this.db.execute(sql`DELETE FROM zone_osm`);
    return this.lire();
  }

  /** Contours administratifs d'OSM qui contiennent le point, du plus petit au plus grand. */
  async contoursAuPoint(lon: number, lat: number): Promise<ContourOsm[]> {
    const reponse = await telechargerOverpass(`[out:json][timeout:60];
is_in(${lat},${lon})->.a;
(
  rel(pivot.a)["boundary"="administrative"]["admin_level"~"^[4-8]$"];
  rel(pivot.a)["boundary"="local_authority"];
);
out tags;`, DELAI_CONTOURS_MS);
    return reponse.elements
      .flatMap((e) => (e.type === 'relation' && e.tags?.name ? [{ id: e.id, tags: e.tags }] : []))
      .map(({ id, tags }) => ({ osm_id: id, nom: tags.name!, admin_level: tags.admin_level ? Number(tags.admin_level) : null, ...nature(tags) }))
      .sort((a, b) => a.rang - b.rang)
      .map(({ rang: _rang, ...contour }) => contour);
  }

  /** Contour d'une relation OSM, élargi de MARGE_CONTOUR_M et simplifié, prêt à retoucher. */
  async contour(osmId: number): Promise<{ nom: string; polygones: PolygonesZone; superficie_km2: number }> {
    const reponse = await telechargerOverpass(`[out:json][timeout:120];
rel(${osmId});
out geom;`, DELAI_CONTOURS_MS);
    const relation = reponse.elements.find((e) => e.type === 'relation' && e.id === osmId);
    if (relation?.type !== 'relation') throw new NotFoundException(`Relation OSM ${osmId} introuvable`);
    const lignes = relation.members
      .filter((m) => m.type === 'way' && m.role === 'outer' && (m.geometry?.length ?? 0) >= 2)
      .map((m) => JSON.stringify({ type: 'LineString', coordinates: m.geometry!.map(({ lon, lat }) => [lon, lat]) }));
    if (lignes.length === 0) throw new NotFoundException(`Relation OSM ${osmId} sans contour extérieur`);
    const { rows } = await this.db.execute<{ coordonnees: LonLat[][][] | null; km2: number | null }>(sql`
      WITH lignes AS (
        SELECT ST_SetSRID(ST_GeomFromGeoJSON(g), 4326) AS geom FROM jsonb_array_elements_text(${JSON.stringify(lignes)}::jsonb) g
      ), surface AS (
        SELECT ST_CollectionExtract(ST_Polygonize(geom), 3) AS geom FROM lignes
      ), zone AS (
        SELECT ST_Multi(ST_CollectionExtract(ST_MakeValid(
                 ST_SimplifyPreserveTopology(ST_Buffer(geom::geography, ${MARGE_CONTOUR_M})::geometry, ${SIMPLIFICATION_DEG})), 3)) AS geom
        FROM surface
      )
      SELECT (ST_AsGeoJSON(geom, 6)::json)->'coordinates' AS coordonnees, ST_Area(geom::geography) / 1e6 AS km2 FROM zone
    `);
    const zone = rows[0];
    if (!zone?.coordonnees?.length) throw new NotFoundException(`Contour de la relation OSM ${osmId} impossible à reconstituer`);
    return {
      nom: relation.tags?.name ?? `Relation ${osmId}`,
      polygones: polygonesDe(zone.coordonnees),
      superficie_km2: Math.round((zone.km2 ?? 0) * 10) / 10,
    };
  }

  /** Lance l'import en tâche de fond (téléchargement frais) ; son état se lit avec `lire`. */
  lancerImport(): ImportOsm {
    if (this.enCours) throw new ConflictException('Un import OSM est déjà en cours');
    this.etat = { statut: 'telechargement', debut: new Date().toISOString(), fin: null, erreur: null, bilan: null };
    void this.importer();
    return this.etat;
  }

  private async importer() {
    const client = await this.pool.connect();
    try {
      const { horodatage, bilan } = await importerOsm(client, {
        etape: (statut, detail) => {
          this.etat = { ...this.etat, statut };
          this.journal.log(`Import OSM : ${statut} (${detail})`);
        },
      });
      this.etat = { ...this.etat, statut: 'termine', fin: new Date().toISOString(), bilan };
      this.journal.log(`Import OSM terminé, données du ${horodatage ?? '?'} : ${JSON.stringify(bilan)}`);
    } catch (erreur) {
      this.etat = { ...this.etat, statut: 'echec', fin: new Date().toISOString(), erreur: (erreur as Error).message };
      this.journal.error(`Import OSM en échec : ${(erreur as Error).message}`);
    } finally {
      client.release();
    }
  }
}
