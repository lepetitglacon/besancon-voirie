import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { CalibrationPrevision, TronconObserve, TypeJour } from '@voirie/schema';
import { DRIZZLE, type Db } from '../db/db.module.js';
import { tramPassage, tramTronconObserve } from '../db/schema.js';
import type { Passage } from './collecte.js';

/** Profondeur par défaut de l'historique exploité, en jours. */
export const HISTORIQUE_JOURS = 28;

/** Type de jour et heure locale (Paris) d'un instant. Fériés et vacances non distingués. */
export function creneauParis(instant_ms: number): { typeJour: TypeJour; heure: number } {
  const parties = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Paris',
    weekday: 'short',
    hour: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(new Date(instant_ms));
  const jour = parties.find((p) => p.type === 'weekday')?.value;
  const heure = Number(parties.find((p) => p.type === 'hour')?.value ?? 0);
  return { typeJour: jour === 'Sat' ? 'samedi' : jour === 'Sun' ? 'dimanche' : 'semaine', heure };
}

/** Durées de tronçon aberrantes (données manquées, rame garée) écartées des statistiques. */
const DUREE_MAX_S = 1800;
/** Une calibration ne vaut qu'avec assez de passages par horizon. */
const CALIBRATION_ECHANTILLONS_MIN = 20;

@Injectable()
export class HistoriqueTramService {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  /** Enregistre des passages ; ceux déjà connus sont ignorés. Renvoie le nombre d'ajouts. */
  async enregistrer(passages: Passage[]): Promise<number> {
    if (passages.length === 0) return 0;
    const date = (s: number) => new Date(s * 1000);
    const ajoutes = await this.db
      .insert(tramPassage)
      .values(
        passages.map((passage) => ({
          ...passage,
          heurePrevue: date(passage.heurePrevue),
          detecteA: date(passage.detecteA),
          heureTheorique: passage.heureTheorique === null ? null : date(passage.heureTheorique),
        })),
      )
      .onConflictDoNothing()
      .returning({ jour: tramPassage.jour });
    return ajoutes.length;
  }

  /**
   * Durées observées de chaque tronçon sur les `jours` derniers jours, pour un type de jour et
   * une heure locale (`null` : toute la journée). La référence est le p10 toutes heures
   * confondues : la durée du tronçon quand ça roule bien.
   */
  async troncons(typeJour: TypeJour, heure: number | null, jours: number): Promise<TronconObserve[]> {
    const t = tramTronconObserve;
    const { rows } = await this.db.execute<TronconObserve & Record<string, unknown>>(sql`
      WITH obs AS (
        SELECT ${t.parcours} AS parcours, ${t.depart} AS depart, ${t.arrivee} AS arrivee,
               ${t.dureeS} AS duree, ${t.heure} AS heure
        FROM ${t}
        WHERE ${t.typeJour} = ${typeJour}
          AND ${t.arriveeA} > now() - make_interval(days => ${jours}::int)
          AND ${t.dureeS} > 0 AND ${t.dureeS} < ${DUREE_MAX_S}
      ),
      reference AS (
        SELECT parcours, depart, arrivee,
               percentile_cont(0.1) WITHIN GROUP (ORDER BY duree) AS reference
        FROM obs GROUP BY parcours, depart, arrivee
      )
      SELECT o.parcours, o.depart, o.arrivee, count(*)::int AS n,
             percentile_cont(0.1) WITHIN GROUP (ORDER BY o.duree) AS p10,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY o.duree) AS p50,
             percentile_cont(0.9) WITHIN GROUP (ORDER BY o.duree) AS p90,
             r.reference
      FROM obs o JOIN reference r USING (parcours, depart, arrivee)
      WHERE ${heure}::int IS NULL OR o.heure = ${heure}::int
      GROUP BY o.parcours, o.depart, o.arrivee, r.reference
      ORDER BY o.parcours, o.depart, o.arrivee
    `);
    return rows;
  }

  /** Volume de l'historique : nombre de passages, premier et dernier. */
  async volume(): Promise<{ passages: number; premier: string | null; dernier: string | null }> {
    const { rows } = await this.db.execute<{ passages: number; premier: string | null; dernier: string | null }>(sql`
      SELECT count(*)::int AS passages, min(${tramPassage.heurePrevue}) AS premier,
             max(${tramPassage.heurePrevue}) AS dernier
      FROM ${tramPassage}
    `);
    return rows[0] ?? { passages: 0, premier: null, dernier: null };
  }

  /** Erreur des prévisions Ginko par horizon (80e centile), sur les `jours` derniers jours. */
  async calibration(jours: number): Promise<CalibrationPrevision | undefined> {
    const { rows } = await this.db.execute<{ horizon: number; n: number; erreur: number }>(sql`
      SELECT e.horizon::int AS horizon, count(*)::int AS n,
             percentile_cont(0.8) WITHIN GROUP (
               ORDER BY abs(extract(epoch FROM ${tramPassage.heurePrevue}) - e.prevue::float8)
             ) AS erreur
      FROM ${tramPassage}
      CROSS JOIN LATERAL jsonb_each_text(${tramPassage.previsions}) AS e(horizon, prevue)
      WHERE ${tramPassage.heurePrevue} > now() - make_interval(days => ${jours}::int)
      GROUP BY 1
      ORDER BY 1
    `);
    const fiables = rows.filter((ligne) => ligne.n >= CALIBRATION_ECHANTILLONS_MIN);
    return fiables.length ? fiables.map((ligne) => [ligne.horizon, ligne.erreur]) : undefined;
  }
}
