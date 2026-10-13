import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { BadGatewayException, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { LonLat } from '@voirie/engine';
import type { CadrePhotoIa, DetectionBranches, DetectionBranchesIa, EmpriseIa, SourceBranche, StatutEssaiIa, TypeFeu } from '@voirie/schema';
import { sql } from 'drizzle-orm';
import { DRIZZLE, type Db } from '../../db/db.module.js';
import { tableExiste } from '../../db/sql.js';
import { assurerVoies } from '../../osm/voies-osm.js';
import { BranchesService, deduire } from '../branches.service.js';
import { DelaiClaude, ErreurClaude, lancerClaude, type ReponseClaude } from './claude.js';
import { configurationDepuisLecture, consigne, LectureIa, schemaJsonLecture, SYSTEME, type ContexteIa, type ResultatLecture } from './lecture.js';
import { cadreEmprise, cadrePhoto, cadrePourClient, urlOrthophoto, type CadrePhoto } from './photo.js';

/** Plus grand côté de l'image envoyée (px) : ~10 à 18 cm/pixel pour un cadre automatique. */
export const TAILLE_PHOTO_PX = 1024;
/** Cadre automatique : marge autour du cercle des feux, pour voir les voies en amont des lignes d'arrêt (m). */
const MARGE_PHOTO_M = 35;
const COTE_MIN_M = 100;
const COTE_MAX_M = 180;

/** Cadre de la photo : zone dessinée sur la carte, sinon un carré autour du cercle des feux (`rayon_m`). */
function cadreDe(detection: DetectionBranches, emprise?: EmpriseIa | null): CadrePhoto {
  if (emprise) return cadreEmprise(emprise, TAILLE_PHOTO_PX);
  const cote = Math.min(COTE_MAX_M, Math.max(COTE_MIN_M, Math.round(2 * (detection.rayon_m + MARGE_PHOTO_M))));
  return cadrePhoto(detection.centre as LonLat, cote, TAILLE_PHOTO_PX);
}
const FICHIER_PHOTO = 'orthophoto.jpg';
/** Modèles lancés en même temps sur la même photo (IA_MODELES), pour comparer. */
const MODELES_DEFAUT = 'opus,sonnet';
/** Au-delà, un modèle est anormalement long : il est arrêté et l'essai noté `delai` (IA_DELAI_S). */
export const DELAI_DEFAUT_S = 180;

/** Dossier des fichiers gardés (IA_DOSSIER), relatif au dossier de l'API : `data/ia` à la racine du projet. */
const DOSSIER_DEFAUT = '../../data/ia';

/** `<racine>/2026-10-09T22-40-12_<slug>` : un dossier par analyse, triable par date. */
async function dossierGarde(racine: string, slug: string): Promise<string> {
  const horodatage = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
  const dossier = resolve(racine, `${horodatage}_${slug.replace(/[^\w-]/g, '_')}`);
  await mkdir(dossier, { recursive: true });
  return dossier;
}

/** Un modèle lancé sur la photo : ce qu'il a coûté, et sa proposition s'il en a fait une. */
export interface EssaiCalcule {
  modele: string;
  modele_reel: string | null;
  effort: string;
  statut: StatutEssaiIa;
  duree_s: number;
  cout_usd: number | null;
  tokens_entree: number | null;
  tokens_sortie: number | null;
  erreur: string | null;
  resultat: DetectionBranchesIa | null;
}

export interface AnalyseCalculee {
  essais: EssaiCalcule[];
  /** Dossier gardé (IA_GARDER_FICHIERS=true) : photo, consigne, sortie brute de chaque modèle. */
  dossier: string | null;
}

/**
 * Proposition « OSM + IA » : la détection OSM, corrigée par Claude d'après l'orthophoto IGN.
 * Chaque modèle d'IA_MODELES lit la même photo, en même temps, jusqu'au bout : chacun donne sa
 * proposition, avec son temps et son coût. Rien n'est enregistré dans les branches : la
 * proposition arrive dans l'éditeur comme celle d'OSM. Lancée par la file d'attente
 * (`FileIaService`), jamais directement par une requête.
 */
@Injectable()
export class IaService {
  private readonly logger = new Logger(IaService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly branches: BranchesService,
    private readonly config: ConfigService,
  ) {}

  /** Cadre automatique de la photo, montré sur la carte avant qu'on dessine la zone. */
  async cadre(carrefourId: string): Promise<CadrePhotoIa> {
    return cadrePourClient(cadreDe(await this.branches.detecter(carrefourId)));
  }

  /**
   * `emprise` : zone de la photo dessinée sur la carte, sinon calculée d'après les feux.
   * Échoue seulement avant l'IA (carrefour inconnu, orthophoto indisponible) : l'échec d'un
   * modèle est noté dans son essai.
   */
  async analyser(carrefourId: string, emprise?: EmpriseIa | null): Promise<AnalyseCalculee> {
    const detection = await this.branches.detecter(carrefourId); // 404 si le carrefour n'existe pas
    const cadre = cadreDe(detection, emprise);
    const { rows } = await this.db.execute<{ nature: string; slug: string }>(sql`SELECT nature, slug FROM carrefour WHERE id = ${carrefourId}`);
    const contexte: ContexteIa = {
      cadre,
      giratoire: rows[0]?.nature === 'giratoire',
      detection,
      feux: await this.feux(carrefourId),
      voiesOsm: await this.voiesOsm(cadre),
    };
    const garder = this.config.get<string>('IA_GARDER_FICHIERS') === 'true';
    const modeles = (this.config.get<string>('IA_MODELES') || MODELES_DEFAUT)
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean);

    // Gardés : dans le projet (data/ia, hors git), pour survivre à un redémarrage ; sinon /tmp.
    const dossier = garder
      ? await dossierGarde(this.config.get<string>('IA_DOSSIER') || DOSSIER_DEFAUT, rows[0]?.slug ?? carrefourId)
      : await mkdtemp(join(tmpdir(), 'voirie-ia-'));
    try {
      const photo = await this.orthophoto(urlOrthophoto(cadre));
      const texte = consigne(contexte);
      if (garder) {
        await writeFile(join(dossier, FICHIER_PHOTO), photo);
        await writeFile(join(dossier, 'consigne.md'), `# Système\n\n${SYSTEME}\n\n# Consigne\n\n${texte}\n`);
      }
      const essais = await Promise.all(modeles.map((modele) => this.essai(modele, dossier, contexte, texte, photo, garder)));
      for (const e of essais) {
        this.logger.log(
          `Carrefour ${carrefourId}, ${e.modele} (${e.modele_reel ?? '?'}, effort ${e.effort}) : ${e.statut}, ` +
            `${e.duree_s} s, ${e.cout_usd?.toFixed(3) ?? '?'} $${e.erreur ? `, ${e.erreur}` : ''}`,
        );
      }
      return { essais, dossier: garder ? dossier : null };
    } finally {
      if (garder) this.logger.log(`Fichiers gardés : ${dossier}`);
      else await rm(dossier, { recursive: true, force: true });
    }
  }

  /** Un modèle sur la photo, jusqu'à sa réponse ou au délai ; ne lève jamais d'erreur. */
  private async essai(
    modele: string,
    dossier: string,
    contexte: ContexteIa,
    texte: string,
    photo: Buffer,
    garder: boolean,
  ): Promise<EssaiCalcule> {
    const effort = this.config.get<string>('IA_EFFORT') || 'medium';
    const debut = performance.now();
    const essai = (statut: StatutEssaiIa, reponse: ReponseClaude | null, erreur: string | null, resultat: DetectionBranchesIa | null): EssaiCalcule => ({
      modele,
      modele_reel: reponse?.modele ?? null,
      effort,
      statut,
      duree_s: Math.round((performance.now() - debut) / 100) / 10,
      cout_usd: reponse?.cout_usd ?? null,
      tokens_entree: reponse?.tokens_entree ?? null,
      tokens_sortie: reponse?.tokens_sortie ?? null,
      erreur,
      resultat,
    });
    const garderSortie = (brut: string) =>
      garder ? writeFile(join(dossier, `${modele.replace(/[^\w.-]/g, '_')}.jsonl`), brut).catch(() => {}) : Promise.resolve();

    let reponse: ReponseClaude;
    try {
      const { brut, ...lue } = await lancerClaude({
        commande: this.config.get<string>('IA_CLAUDE_CMD') || 'claude',
        modele,
        effort,
        dossier,
        systeme: SYSTEME,
        consigne: texte,
        image: { donnees: photo, type: 'image/jpeg' },
        schemaJson: schemaJsonLecture(),
        delaiMs: Number(this.config.get<string>('IA_DELAI_S') || DELAI_DEFAUT_S) * 1000,
      });
      await garderSortie(brut);
      reponse = lue;
    } catch (erreur) {
      if (erreur instanceof ErreurClaude) await garderSortie(erreur.brut);
      return essai(erreur instanceof DelaiClaude ? 'delai' : 'echec', null, (erreur as Error).message, null);
    }

    const lecture = LectureIa.safeParse(reponse.sortie);
    if (!lecture.success) return essai('echec', reponse, 'Réponse hors schéma', null);
    let resultat: ResultatLecture;
    try {
      resultat = configurationDepuisLecture(lecture.data, contexte.cadre, contexte.detection, contexte.giratoire, contexte.feux);
    } catch (erreur) {
      return essai('echec', reponse, (erreur as Error).message, null);
    }
    const fini = essai('terminee', reponse, null, null);
    return { ...fini, resultat: proposition(contexte, lecture.data, resultat, fini) };
  }

  private async orthophoto(url: string): Promise<Buffer> {
    const reponse = await fetch(url, { signal: AbortSignal.timeout(30_000) }).catch(() => null);
    if (!reponse?.ok || !reponse.headers.get('content-type')?.startsWith('image/')) {
      throw new BadGatewayException("Orthophoto IGN indisponible (Géoplateforme)");
    }
    return Buffer.from(await reponse.arrayBuffer());
  }

  private async feux(carrefourId: string): Promise<ContexteIa['feux']> {
    const { rows } = await this.db.execute<{ id: string; type: TypeFeu; lon: number; lat: number; tags: Record<string, string> }>(sql`
      SELECT id, type, ST_X(geom) AS lon, ST_Y(geom) AS lat, tags FROM feu
      WHERE carrefour_id = ${carrefourId}
      ORDER BY type, ST_X(geom), ST_Y(geom)
    `);
    return rows.map((f, i) => ({ id: f.id, numero: i + 1, type: f.type, position: [f.lon, f.lat], tags: f.tags }));
  }

  /** Voies OSM circulables (et voies de tram) dans le cadre de la photo, découpées au cadre. */
  private async voiesOsm({ bbox: [xmin, ymin, xmax, ymax] }: CadrePhoto): Promise<ContexteIa['voiesOsm']> {
    // Voies chargées à la demande sur tout le cadre (Web Mercator → lon/lat, demi-diagonale en m).
    const R = 6_378_137;
    const lat = ((2 * Math.atan(Math.exp((ymin + ymax) / 2 / R)) - Math.PI / 2) * 180) / Math.PI;
    const lon = ((xmin + xmax) / 2 / R) * (180 / Math.PI);
    const demiDiagonale = (Math.hypot(xmax - xmin, ymax - ymin) / 2) * Math.cos((lat * Math.PI) / 180);
    await assurerVoies(this.db, [lon, lat], demiDiagonale, { exiger: false });
    if (!(await tableExiste(this.db, 'osm_way'))) return [];
    const { rows } = await this.db.execute<{ osm_id: string; tags: Record<string, string>; coordonnees: LonLat[] }>(sql`
      WITH cadre AS (
        SELECT ST_Transform(ST_MakeEnvelope(${xmin}, ${ymin}, ${xmax}, ${ymax}, 3857), 4326) AS g
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

/** Proposition au format de l'éditeur, avec les remarques de l'IA et ce qu'a coûté l'essai. */
function proposition(contexte: ContexteIa, lecture: LectureIa, resultat: ResultatLecture, essai: EssaiCalcule): DetectionBranchesIa {
  const { detection, giratoire } = contexte;
  const { branches, connexions, anneau } = resultat.configuration;
  const remarques = [
    lecture.remarques,
    resultat.noeuds === 'ia'
      ? `Nœuds de l'anneau lus sur la photo (${anneau!.noeuds.length}).`
      : resultat.noeuds === 'osm'
        ? "Nœuds de l'anneau d'après OSM : l'IA n'en a pas proposé trois distincts."
        : giratoire
          ? "Aucun nœud d'anneau : posez-les avec l'outil Nœud."
          : '',
    resultat.ecartees.length ? `Connexions écartées (voie inconnue ou en double) : ${resultat.ecartees.join(', ')}.` : '',
    resultat.lignes.length ? `${resultat.lignes.length} ligne(s) de feux proposée(s) d'après les feux vus sur la photo.` : '',
    resultat.feuxIgnores.length ? `Feux sans ligne proposée : ${resultat.feuxIgnores.join(' ; ')}.` : '',
  ]
    .filter(Boolean)
    .join(' ');
  return {
    ...deduire(detection.centre, branches, connexions, anneau),
    rayon_m: detection.rayon_m,
    lignes: resultat.lignes,
    sources: Object.fromEntries(branches.map((b) => [b.code, 'ia' satisfies SourceBranche])),
    ia: {
      remarques,
      branches: resultat.branches,
      modele: essai.modele_reel ?? essai.modele,
      duree_s: Math.round(essai.duree_s),
      cout_usd: essai.cout_usd,
    },
  };
}
