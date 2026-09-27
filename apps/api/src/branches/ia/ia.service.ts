import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BadGatewayException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { LonLat } from '@voirie/engine';
import type { DetectionBranchesIa, SourceBranche, TypeFeu } from '@voirie/schema';
import { sql } from 'drizzle-orm';
import { DRIZZLE, type Db } from '../../db/db.module.js';
import { tableExiste } from '../../db/sql.js';
import { BranchesService, deduire } from '../branches.service.js';
import { ErreurClaude, lancerClaude } from './claude.js';
import { configurationDepuisLecture, consigne, LectureIa, schemaJsonLecture, SYSTEME, type ContexteIa } from './lecture.js';
import { cadrePhoto, urlOrthophoto } from './photo.js';

/** Côté de l'image envoyée (px) : ~10 à 18 cm/pixel selon la taille du carrefour. */
const TAILLE_PX = 1024;
/** Marge autour du cercle de détection, pour voir les voies en amont des lignes d'arrêt (m). */
const MARGE_PHOTO_M = 35;
const COTE_MIN_M = 100;
const COTE_MAX_M = 180;
const FICHIER_PHOTO = 'orthophoto.jpg';

/**
 * Proposition « OSM + IA » : la détection OSM, corrigée par Claude d'après l'orthophoto IGN.
 * Rien n'est enregistré : la proposition arrive dans l'éditeur comme celle d'OSM.
 */
@Injectable()
export class IaService {
  private readonly logger = new Logger(IaService.name);
  /** Une seule analyse à la fois par carrefour : un second clic attend la première. */
  private readonly enCours = new Map<string, Promise<DetectionBranchesIa>>();

  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly branches: BranchesService,
    private readonly config: ConfigService,
  ) {}

  detecter(carrefourId: string): Promise<DetectionBranchesIa> {
    const existante = this.enCours.get(carrefourId);
    if (existante) return existante;
    const analyse = this.analyser(carrefourId).finally(() => this.enCours.delete(carrefourId));
    this.enCours.set(carrefourId, analyse);
    return analyse;
  }

  private async analyser(carrefourId: string): Promise<DetectionBranchesIa> {
    const detection = await this.branches.detecter(carrefourId); // 404 si le carrefour n'existe pas
    const centre = detection.centre as LonLat;
    const cote = Math.min(COTE_MAX_M, Math.max(COTE_MIN_M, Math.round(2 * (detection.rayon_m + MARGE_PHOTO_M))));
    const cadre = cadrePhoto(centre, cote, TAILLE_PX);
    const contexte: ContexteIa = {
      cadre,
      detection,
      feux: await this.feux(carrefourId),
      voiesOsm: await this.voiesOsm(centre, cote / 2),
    };

    const dossier = await mkdtemp(join(tmpdir(), 'voirie-ia-'));
    try {
      await writeFile(join(dossier, FICHIER_PHOTO), await this.orthophoto(urlOrthophoto(cadre)));
      const reponse = await lancerClaude({
        commande: this.config.get<string>('IA_CLAUDE_CMD') || 'claude',
        modele: this.config.get<string>('IA_MODELE') || 'opus',
        dossier,
        systeme: SYSTEME,
        consigne: consigne(contexte, join(dossier, FICHIER_PHOTO)),
        schemaJson: schemaJsonLecture(),
        delaiMs: Number(this.config.get<string>('IA_DELAI_S') || 300) * 1000,
      }).catch((erreur: unknown) => {
        throw erreur instanceof ErreurClaude ? new ServiceUnavailableException(erreur.message) : erreur;
      });

      const lecture = LectureIa.safeParse(reponse.sortie);
      if (!lecture.success) throw new UnprocessableEntityException('Réponse de Claude hors schéma');
      let resultat;
      try {
        resultat = configurationDepuisLecture(lecture.data, cadre, detection);
      } catch (erreur) {
        throw new UnprocessableEntityException((erreur as Error).message);
      }
      const { branches, connexions } = resultat.configuration;
      const remarques = [
        lecture.data.remarques,
        resultat.ecartees.length ? `Connexions écartées (voie inconnue ou en double) : ${resultat.ecartees.join(', ')}.` : '',
      ]
        .filter(Boolean)
        .join(' ');
      this.logger.log(
        `Carrefour ${carrefourId} : ${branches.length} branches, ${connexions.length} connexions, ` +
          `${reponse.modele}, ${reponse.duree_s} s, ${reponse.cout_usd?.toFixed(3) ?? '?'} $`,
      );
      return {
        ...deduire(detection.centre, branches, connexions),
        rayon_m: detection.rayon_m,
        sources: Object.fromEntries(branches.map((b) => [b.code, 'ia' satisfies SourceBranche])),
        ia: {
          remarques,
          branches: resultat.branches,
          modele: reponse.modele,
          duree_s: reponse.duree_s,
          cout_usd: reponse.cout_usd,
        },
      };
    } finally {
      if (this.config.get<string>('IA_GARDER_FICHIERS') === 'true') this.logger.log(`Fichiers gardés : ${dossier}`);
      else await rm(dossier, { recursive: true, force: true });
    }
  }

  private async orthophoto(url: string): Promise<Buffer> {
    const reponse = await fetch(url, { signal: AbortSignal.timeout(30_000) }).catch(() => null);
    if (!reponse?.ok || !reponse.headers.get('content-type')?.startsWith('image/')) {
      throw new BadGatewayException("Orthophoto IGN indisponible (Géoplateforme)");
    }
    return Buffer.from(await reponse.arrayBuffer());
  }

  private async feux(carrefourId: string): Promise<ContexteIa['feux']> {
    const { rows } = await this.db.execute<{ type: TypeFeu; lon: number; lat: number; tags: Record<string, string> }>(sql`
      SELECT type, ST_X(geom) AS lon, ST_Y(geom) AS lat, tags FROM feu
      WHERE carrefour_id = ${carrefourId}
      ORDER BY type, ST_X(geom), ST_Y(geom)
    `);
    return rows.map((f, i) => ({ numero: i + 1, type: f.type, position: [f.lon, f.lat], tags: f.tags }));
  }

  /** Voies OSM circulables (et voies de tram) dans le cadre de la photo, découpées au cadre. */
  private async voiesOsm([lon, lat]: LonLat, demiCote: number): Promise<ContexteIa['voiesOsm']> {
    if (!(await tableExiste(this.db, 'osm_way'))) return [];
    const { rows } = await this.db.execute<{ osm_id: string; tags: Record<string, string>; coordonnees: LonLat[] }>(sql`
      WITH cadre AS (
        SELECT ST_Buffer(ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)::geography, ${demiCote}::float8)::geometry AS g
      )
      SELECT w.osm_id::text, w.tags,
             (ST_AsGeoJSON(ST_Simplify(ST_Intersection(w.geom, cadre.g), 0.000005))::json)->'coordinates' AS coordonnees
      FROM osm_way w, cadre
      WHERE ST_Intersects(w.geom, cadre.g)
        AND ((w.tags ? 'highway'
              AND w.tags->>'highway' NOT IN ('footway', 'path', 'steps', 'pedestrian', 'track', 'corridor', 'elevator'))
             OR w.tags->>'railway' = 'tram')
        AND GeometryType(ST_Intersection(w.geom, cadre.g)) = 'LINESTRING'
    `);
    return rows.map((r) => ({ osm_id: Number(r.osm_id), tags: r.tags, coordonnees: r.coordonnees }));
  }
}
