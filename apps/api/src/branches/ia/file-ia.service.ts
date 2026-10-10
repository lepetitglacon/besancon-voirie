import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import type { AnalyseIa, AnalyseIaDetail, DetectionBranchesIa, EmpriseIa, EssaiIa, EssaiIaDetail } from '@voirie/schema';
import { sql, type SQL } from 'drizzle-orm';
import { DRIZZLE, type Db } from '../../db/db.module.js';
import { DELAI_DEFAUT_S, IaService, TAILLE_PHOTO_PX, type EssaiCalcule } from './ia.service.js';
import { cadreEmprise, refusEmprise } from './photo.js';

/** Analyses lancées en même temps (IA_PARALLELE) : chacune est un `claude -p` sur le serveur. */
const PARALLELE_DEFAUT = 2;
const VEILLE_MS = 30_000;
/** Une analyse finie reste listée tant qu'elle n'est pas consultée, ou pendant ce délai. */
const GARDER_FINIES = sql`interval '1 hour'`;

/** Dates en ISO 8601 (to_json), lisibles telles quelles par le navigateur. */
const COLONNES = sql`
  a.id, a.statut, a.erreur, a.emprise,
  to_json(a.demandee_le) AS demandee_le, to_json(a.commencee_le) AS commencee_le,
  to_json(a.finie_le) AS finie_le, to_json(a.consultee_le) AS consultee_le,
  json_build_object(
    'id', c.id, 'slug', c.slug, 'nom', c.nom, 'statut', c.statut, 'nature', c.nature, 'pres_tram', c.pres_tram,
    'nb_feux', (SELECT count(*)::int FROM feu f WHERE f.carrefour_id = c.id)
  ) AS carrefour,
  json_build_array(ST_X(c.geom), ST_Y(c.geom)) AS position,
  CASE WHEN a.statut = 'en_attente' THEN
    (SELECT count(*)::int FROM analyse_ia p WHERE p.statut = 'en_attente' AND p.demandee_le <= a.demandee_le)
  END AS rang`;

const COLONNES_ESSAI = sql`
  e.id, e.analyse_id, e.carrefour_id, e.modele, e.modele_reel, e.effort, e.statut, e.duree_s, e.cout_usd,
  e.tokens_entree, e.tokens_sortie, e.erreur, e.dossier, to_json(e.cree_le) AS cree_le`;

/**
 * File d'attente des propositions « OSM + IA », en base pour survivre à un redémarrage de
 * l'API. Les analyses se lancent dans l'ordre des demandes, IA_PARALLELE à la fois ; une
 * analyse interrompue par un redémarrage est relancée.
 */
@Injectable()
export class FileIaService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(FileIaService.name);
  private actives = 0;
  private arret = false;
  /** Filet de sécurité : une demande arrivée pendant qu'un travailleur s'arrêtait. */
  private veille?: NodeJS.Timeout;

  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly ia: IaService,
    private readonly config: ConfigService,
  ) {}

  async onApplicationBootstrap() {
    // Une file indisponible (migration pas encore appliquée…) ne doit pas empêcher l'API de démarrer.
    try {
      const { rows } = await this.db.execute<{ id: string }>(sql`
        UPDATE analyse_ia SET statut = 'en_attente', commencee_le = NULL WHERE statut = 'en_cours' RETURNING id
      `);
      if (rows.length) this.logger.log(`${rows.length} analyse(s) interrompue(s) remise(s) en file`);
    } catch (erreur) {
      this.logger.error(`File IA indisponible (pnpm db:migrate ?) : ${(erreur as Error).message}`);
    }
    this.relancer();
    this.veille = setInterval(() => this.relancer(), VEILLE_MS);
  }

  onApplicationShutdown() {
    this.arret = true;
    clearInterval(this.veille);
  }

  /**
   * Met le carrefour en file, sauf s'il y est déjà (en attente ou en cours).
   * `emprise` : zone de la photo dessinée sur la carte, sinon calculée d'après les feux.
   */
  async demander(carrefourId: string, emprise?: EmpriseIa): Promise<AnalyseIa> {
    const { rows: existe } = await this.db.execute<{ lon: number; lat: number }>(
      sql`SELECT ST_X(geom) AS lon, ST_Y(geom) AS lat FROM carrefour WHERE id = ${carrefourId}`,
    );
    const carrefour = existe[0];
    if (!carrefour) throw new NotFoundException('Carrefour inconnu');
    const refus = emprise && refusEmprise(cadreEmprise(emprise, TAILLE_PHOTO_PX), [carrefour.lon, carrefour.lat]);
    if (refus) throw new BadRequestException(refus);
    const { rows: enFile } = await this.db.execute<{ id: string }>(sql`
      SELECT id FROM analyse_ia WHERE carrefour_id = ${carrefourId} AND statut IN ('en_attente', 'en_cours') LIMIT 1
    `);
    const id =
      enFile[0]?.id ??
      (await this.db.execute<{ id: string }>(sql`INSERT INTO analyse_ia (carrefour_id, emprise) VALUES (${carrefourId}, ${emprise ? JSON.stringify(emprise) : null}::jsonb) RETURNING id`))
        .rows[0]!.id;
    this.relancer();
    return this.resume(id);
  }

  /** Analyses en file, en cours, ou finies et pas encore consultées (ou il y a moins d'une heure). */
  async lister(): Promise<AnalyseIa[]> {
    const { rows } = await this.db.execute<Ligne<AnalyseIa>>(sql`
      SELECT ${COLONNES} FROM analyse_ia a JOIN carrefour c ON c.id = a.carrefour_id
      WHERE a.statut IN ('en_attente', 'en_cours') OR a.consultee_le IS NULL OR a.finie_le > now() - ${GARDER_FINIES}
      ORDER BY a.demandee_le DESC
      LIMIT 50
    `);
    return rows;
  }

  async lire(id: string): Promise<AnalyseIaDetail> {
    const { rows } = await this.db.execute<Ligne<AnalyseIaDetail>>(sql`
      SELECT ${COLONNES}, a.resultat FROM analyse_ia a JOIN carrefour c ON c.id = a.carrefour_id WHERE a.id = ${id}
    `);
    if (!rows[0]) throw new NotFoundException('Analyse inconnue');
    const { rows: essais } = await this.db.execute<Ligne<EssaiIa>>(sql`
      SELECT ${COLONNES_ESSAI} FROM essai_ia e WHERE e.analyse_id = ${id} ORDER BY e.cree_le, e.modele
    `);
    return { ...rows[0], essais };
  }

  /** Essais d'un carrefour, du plus récent au plus ancien : ils restent quand l'analyse est retirée. */
  async essais(carrefourId: string): Promise<EssaiIa[]> {
    const { rows } = await this.db.execute<Ligne<EssaiIa>>(sql`
      SELECT ${COLONNES_ESSAI} FROM essai_ia e WHERE e.carrefour_id = ${carrefourId} ORDER BY e.cree_le DESC LIMIT 100
    `);
    return rows;
  }

  async lireEssai(id: string): Promise<EssaiIaDetail> {
    const { rows } = await this.db.execute<Ligne<EssaiIaDetail>>(sql`SELECT ${COLONNES_ESSAI}, e.resultat FROM essai_ia e WHERE e.id = ${id}`);
    if (!rows[0]) throw new NotFoundException('Essai inconnu');
    return rows[0];
  }

  async marquerConsultee(id: string): Promise<AnalyseIa> {
    await this.modifier(id, sql`UPDATE analyse_ia SET consultee_le = coalesce(consultee_le, now()) WHERE id = ${id}`);
    return this.resume(id);
  }

  /** Retire une analyse de la liste. Une analyse en cours va jusqu'au bout. */
  async retirer(id: string): Promise<void> {
    const { rows } = await this.db.execute<{ statut: string }>(sql`SELECT statut FROM analyse_ia WHERE id = ${id}`);
    if (!rows[0]) throw new NotFoundException('Analyse inconnue');
    if (rows[0].statut === 'en_cours') throw new ConflictException('Analyse en cours : attendez la fin');
    await this.db.execute(sql`DELETE FROM analyse_ia WHERE id = ${id}`);
  }

  private async resume(id: string): Promise<AnalyseIa> {
    const { resultat: _resultat, essais: _essais, ...analyse } = await this.lire(id);
    return analyse;
  }

  private async modifier(id: string, requete: SQL) {
    const { rowCount } = await this.db.execute(requete);
    if (!rowCount) throw new NotFoundException('Analyse inconnue');
  }

  /** Lance des travailleurs, dans la limite de IA_PARALLELE ; chacun vide la file puis s'arrête. */
  private relancer() {
    const reglage = this.config.get<string>('IA_PARALLELE');
    // IA_PARALLELE=0 : file sans travailleur (tests), les demandes restent en attente.
    const parallele = reglage === undefined || reglage === '' ? PARALLELE_DEFAUT : Number(reglage);
    while (!this.arret && this.actives < parallele) {
      this.actives++;
      void this.travailler().finally(() => this.actives--);
    }
  }

  private async travailler() {
    try {
      while (!this.arret && (await this.suivante()));
    } catch (erreur) {
      this.logger.error(`File IA : ${(erreur as Error).message}`);
    }
  }

  /**
   * Enregistre un essai par modèle ; renvoie la proposition retenue (celle du premier modèle
   * d'IA_MODELES qui a réussi), marquée de son analyse et de son essai, ou null.
   */
  private async enregistrerEssais(
    analyseId: string,
    carrefourId: string,
    essais: readonly EssaiCalcule[],
    dossier: string | null,
  ): Promise<DetectionBranchesIa | null> {
    let retenu: DetectionBranchesIa | null = null;
    for (const e of essais) {
      const id = randomUUID();
      const resultat = e.resultat && { ...e.resultat, ia: { ...e.resultat.ia, analyse_id: analyseId, essai_id: id } };
      retenu ??= resultat;
      await this.db.execute(sql`
        INSERT INTO essai_ia (id, analyse_id, carrefour_id, modele, modele_reel, effort, statut, duree_s, cout_usd,
                              tokens_entree, tokens_sortie, resultat, erreur, dossier)
        VALUES (${id}, ${analyseId}, ${carrefourId}, ${e.modele}, ${e.modele_reel}, ${e.effort}, ${e.statut}, ${e.duree_s},
                ${e.cout_usd}, ${e.tokens_entree}, ${e.tokens_sortie}, ${resultat ? JSON.stringify(resultat) : null}::jsonb,
                ${e.erreur}, ${dossier})
      `);
    }
    return retenu;
  }

  /** Prend la plus ancienne analyse en attente et la mène à son terme. Faux si la file est vide. */
  private async suivante(): Promise<boolean> {
    const { rows } = await this.db.execute<{ id: string; carrefour_id: string; emprise: EmpriseIa | null }>(sql`
      UPDATE analyse_ia SET statut = 'en_cours', commencee_le = now()
      WHERE id = (
        SELECT id FROM analyse_ia WHERE statut = 'en_attente' ORDER BY demandee_le LIMIT 1 FOR UPDATE SKIP LOCKED
      )
      RETURNING id, carrefour_id, emprise
    `);
    const analyse = rows[0];
    if (!analyse) return false;
    try {
      const { essais, dossier } = await this.ia.analyser(analyse.carrefour_id, analyse.emprise);
      const retenu = await this.enregistrerEssais(analyse.id, analyse.carrefour_id, essais, dossier);
      if (!retenu) throw new Error(messageEchec(essais, Number(this.config.get<string>('IA_DELAI_S') || DELAI_DEFAUT_S)));
      await this.db.execute(sql`
        UPDATE analyse_ia SET statut = 'terminee', resultat = ${JSON.stringify(retenu)}::jsonb, finie_le = now()
        WHERE id = ${analyse.id}
      `);
    } catch (erreur) {
      const message = (erreur as Error).message;
      this.logger.warn(`Analyse ${analyse.id} en échec : ${message}`);
      await this.db.execute(sql`
        UPDATE analyse_ia SET statut = 'echec', erreur = ${message}, finie_le = now() WHERE id = ${analyse.id}
      `);
    }
    return true;
  }
}

/** Ce qui est montré quand aucun modèle n'a fait de proposition. */
export function messageEchec(essais: readonly Pick<EssaiCalcule, 'modele' | 'statut' | 'erreur'>[], delaiS: number): string {
  if (essais.length > 0 && essais.every((e) => e.statut === 'delai')) {
    return (
      `L'IA n'a pas répondu en ${delaiS} s (${essais.map((e) => e.modele).join(', ')}). C'est anormal pour une seule photo : ` +
      'réessayez, et si ça se reproduit vérifiez que Claude Code est connecté sur le serveur (claude -p).'
    );
  }
  return essais.map((e) => `${e.modele} : ${e.erreur ?? 'sans proposition'}`).join(' ; ') || 'Aucun modèle lancé (IA_MODELES)';
}

/** `db.execute` attend un type indexable ; les interfaces partagées ne le sont pas. */
type Ligne<T> = T & Record<string, unknown>;
