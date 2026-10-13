import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { debutsDeVert, decalageDuTop, planEnVigueur, synchroniser } from '@voirie/engine';
import {
  typeLigne,
  type AjoutTops,
  type Bbox,
  type CarrefourTempsReel,
  type Controleur,
  type Etape,
  type FeuxTempsReel,
  type IntervalleVert,
  type Plage,
  type PlanTempsReel,
  type Signal,
  type SynchronisationPlan,
  type TopsCarrefour,
  type TopSynchro,
} from '@voirie/schema';
import { DRIZZLE, type Db } from '../db/db.module.js';
import { tableExiste, uuids } from '../db/sql.js';

/** Voies de tram prises en compte autour d'un carrefour. */
const RAYON_TRAM_M = 80;

/** Signaux des transports en commun (tram, bus en site propre) : la ligne que sert la priorité. */
const SIGNAUX_TC: readonly Signal[] = ['R17', 'R18'];

type LignePlan = {
  carrefour_id: string;
  code: string;
  mode: PlanTempsReel['mode'];
  plages: Plage[];
  cycle_s: number | null;
  jaune_s: number | null;
  lignes: Record<string, IntervalleVert[]> | null;
  etapes?: Etape[] | null;
};

/**
 * Lignes au vert pendant la priorité tram : l'étape qui sert une ligne de transports en commun,
 * de préférence une étape hors cycle (l'« étape prioritaire » du graphe) — CONFIGURATION.md §6.
 */
export function etapeTram(etapes: readonly Etape[] | null | undefined, lignesTc: ReadonlySet<string>): string[] | null {
  const servies = (etapes ?? []).filter((e) => e.lignes.some((code) => lignesTc.has(code)));
  const etape = servies.find((e) => e.hors_cycle) ?? servies[0];
  return etape ? [...etape.lignes] : null;
}

type LigneTop = { id: string; carrefour_id: string; ligne: string; instant: Date };

/**
 * Rattache chaque top au plan en vigueur à son instant, et en déduit le décalage de chaque plan
 * à cycle. Une ligne au vert deux fois par cycle : son premier vert fait foi.
 */
export function synchroniserPlans(
  plans: readonly LignePlan[],
  tops: readonly Omit<LigneTop, 'carrefour_id'>[],
): { tops: TopSynchro[]; plans: Record<string, SynchronisationPlan> } {
  const aCycle = plans.filter((p) => p.mode === 'cycle' && p.cycle_s && p.lignes);
  const lus = tops.map((top) => {
    const instant_ms = top.instant.getTime();
    const plan = planEnVigueur(aCycle, instant_ms);
    const debut = plan ? debutsDeVert(plan.lignes![top.ligne] ?? [], plan.cycle_s!)[0] : undefined;
    return { top, instant_ms, plan, debut };
  });
  const synchros = Object.fromEntries(
    aCycle.map((plan) => {
      const utiles = lus.flatMap((l) => (l.plan === plan && l.debut !== undefined ? [{ instant_ms: l.instant_ms, debutVert_s: l.debut }] : []));
      return [plan.code, synchroniser(utiles, plan.cycle_s!)];
    }),
  );
  return {
    tops: lus.map(({ top, instant_ms, plan, debut }) => ({
      id: top.id,
      ligne: top.ligne,
      instant: top.instant.toISOString(),
      plan: plan?.code ?? null,
      decalage_s: plan && debut !== undefined ? Math.round(decalageDuTop(instant_ms, debut, plan.cycle_s!) * 100) / 100 : null,
    })),
    plans: synchros,
  };
}

@Injectable()
export class TempsReelService {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  private async plans(carrefours: readonly string[]): Promise<LignePlan[]> {
    const { rows } = await this.db.execute<LignePlan>(sql`
      SELECT carrefour_id, code, mode, plages, cycle_s, jaune_s, lignes, etapes
      FROM plan_feux WHERE carrefour_id = ANY (${uuids(carrefours)}) ORDER BY code
    `);
    return rows;
  }

  private async topsDe(carrefours: readonly string[]): Promise<LigneTop[]> {
    const { rows } = await this.db.execute<{ id: string; carrefour_id: string; ligne: string; instant: string }>(sql`
      SELECT id, carrefour_id, ligne, instant FROM top_synchro
      WHERE carrefour_id = ANY (${uuids(carrefours)}) ORDER BY instant
    `);
    return rows.map((r) => ({ ...r, instant: new Date(r.instant) }));
  }

  private async existe(carrefourId: string): Promise<void> {
    const { rows } = await this.db.execute(sql`SELECT 1 FROM carrefour WHERE id = ${carrefourId}`);
    if (rows.length === 0) throw new NotFoundException('Carrefour inconnu');
  }

  /** Tops du carrefour, avec le plan et le décalage que donne chacun, et la synchronisation des plans. */
  async tops(carrefourId: string): Promise<TopsCarrefour> {
    await this.existe(carrefourId);
    return synchroniserPlans(await this.plans([carrefourId]), await this.topsDe([carrefourId]));
  }

  async ajouterTops(carrefourId: string, { ligne, instants }: AjoutTops): Promise<TopsCarrefour> {
    await this.existe(carrefourId);
    const { rows } = await this.db.execute(sql`SELECT 1 FROM ligne_feux WHERE carrefour_id = ${carrefourId} AND code = ${ligne}`);
    if (rows.length === 0) throw new BadRequestException(`Pas de ligne ${ligne} à ce carrefour`);
    await this.db.execute(sql`
      INSERT INTO top_synchro (carrefour_id, ligne, instant)
      SELECT ${carrefourId}, ${ligne}, unnest(${`{${instants.join(',')}}`}::timestamptz[])
    `);
    return this.tops(carrefourId);
  }

  async supprimerTop(carrefourId: string, id: string): Promise<TopsCarrefour> {
    const { rows } = await this.db.execute(sql`DELETE FROM top_synchro WHERE id = ${id} AND carrefour_id = ${carrefourId} RETURNING id`);
    if (rows.length === 0) throw new NotFoundException('Top inconnu');
    return this.tops(carrefourId);
  }

  /**
   * Où dessiner chaque ligne de feux (clé « carrefour|code ») : ses feux physiques ; à défaut,
   * le bout côté carrefour des voies entrantes dont une connexion suit un mouvement qu'elle
   * commande, ou le milieu de la traversée pour une ligne piétonne.
   */
  private async positionsDesLignes(carrefours: readonly string[]): Promise<Map<string, Array<[number, number]>>> {
    const { rows } = await this.db.execute<{ carrefour_id: string; code: string; source: 'feu' | 'voie'; lon: number; lat: number }>(sql`
      SELECT l.carrefour_id, l.code, 'feu' AS source, ST_X(f.geom) AS lon, ST_Y(f.geom) AS lat
      FROM ligne_feux l
      JOIN ligne_feux_feu lf ON lf.ligne_feux_id = l.id
      JOIN feu f ON f.id = lf.feu_id
      WHERE l.carrefour_id = ANY (${uuids(carrefours)})
      UNION
      SELECT l.carrefour_id, l.code, 'voie', ST_X(ST_StartPoint(ve.geom)), ST_Y(ST_StartPoint(ve.geom))
      FROM connexion cx
      JOIN voie ve ON ve.id = cx.voie_entree_id
      JOIN branche be ON be.id = ve.branche_id
      JOIN voie vs ON vs.id = cx.voie_sortie_id
      JOIN branche bs ON bs.id = vs.branche_id
      JOIN ligne_feux l ON l.carrefour_id = cx.carrefour_id AND be.code || '>' || bs.code = ANY (l.mouvements)
      WHERE cx.carrefour_id = ANY (${uuids(carrefours)})
      UNION
      SELECT l.carrefour_id, l.code, 'voie', ST_X(p.point), ST_Y(p.point)
      FROM ligne_feux l
      JOIN branche b ON b.carrefour_id = l.carrefour_id AND b.code = l.traverse
      -- Un point au milieu de chacun des passages de la branche.
      CROSS JOIN LATERAL (SELECT ST_LineInterpolatePoint((ST_Dump(b.traversee)).geom, 0.5) AS point) p
      WHERE l.carrefour_id = ANY (${uuids(carrefours)}) AND b.traversee IS NOT NULL
    `);
    const parLigne = new Map<string, { feu: Array<[number, number]>; voie: Array<[number, number]> }>();
    for (const r of rows) {
      const cle = `${r.carrefour_id}|${r.code}`;
      const positions = parLigne.get(cle) ?? { feu: [], voie: [] };
      positions[r.source].push([r.lon, r.lat]);
      parLigne.set(cle, positions);
    }
    return new Map([...parLigne].map(([cle, { feu, voie }]) => [cle, feu.length > 0 ? feu : voie]));
  }

  /**
   * Lignes qui coupent une voie de tram (clé « carrefour|code ») : une connexion d'une voie
   * entrante à une voie sortante (corde entre leurs bouts côté carrefour) ou la traversée
   * piétonne croise la voie de tram d'OpenStreetMap. Elles passent au rouge quand le tram passe.
   */
  private async lignesQuiCoupentLeTram(carrefours: readonly string[]): Promise<Set<string>> {
    if (!(await tableExiste(this.db, 'osm_tram'))) return new Set();
    const { rows } = await this.db.execute<{ carrefour_id: string; code: string }>(sql`
      WITH trams AS (
        SELECT c.id AS carrefour_id, t.geom
        FROM carrefour c
        JOIN osm_tram t ON ST_DWithin(t.geom::geography, c.geom::geography, ${RAYON_TRAM_M})
        WHERE c.id = ANY (${uuids(carrefours)})
      )
      SELECT l.carrefour_id, l.code
      FROM connexion cx
      JOIN voie ve ON ve.id = cx.voie_entree_id
      JOIN branche be ON be.id = ve.branche_id
      JOIN voie vs ON vs.id = cx.voie_sortie_id
      JOIN branche bs ON bs.id = vs.branche_id
      JOIN ligne_feux l ON l.carrefour_id = cx.carrefour_id AND be.code || '>' || bs.code = ANY (l.mouvements)
      JOIN trams t ON t.carrefour_id = cx.carrefour_id
      WHERE ve.type <> 'tram' AND ST_Intersects(ST_MakeLine(ST_StartPoint(ve.geom), ST_StartPoint(vs.geom)), t.geom)
      UNION
      SELECT l.carrefour_id, l.code
      FROM ligne_feux l
      JOIN branche b ON b.carrefour_id = l.carrefour_id AND b.code = l.traverse
      JOIN trams t ON t.carrefour_id = l.carrefour_id
      WHERE b.traversee IS NOT NULL AND ST_Intersects(b.traversee, t.geom)
    `);
    return new Set(rows.map((r) => `${r.carrefour_id}|${r.code}`));
  }

  /** Carrefours programmés de l'emprise, prêts à rejouer : lignes, feux physiques, plans et décalages. */
  async feux([minLon, minLat, maxLon, maxLat]: Bbox): Promise<FeuxTempsReel> {
    const { rows: carrefours } = await this.db.execute<{
      id: string;
      nom: string;
      pres_tram: boolean;
      controleur: Partial<Controleur>;
      lon: number;
      lat: number;
    }>(sql`
      SELECT c.id, c.nom, c.pres_tram, c.controleur, ST_X(c.geom) AS lon, ST_Y(c.geom) AS lat
      FROM carrefour c
      WHERE c.geom && ST_MakeEnvelope(${minLon}, ${minLat}, ${maxLon}, ${maxLat}, 4326)
        AND EXISTS (SELECT 1 FROM plan_feux p WHERE p.carrefour_id = c.id)
      LIMIT 500
    `);
    if (carrefours.length === 0) return { carrefours: [] };
    const ids = carrefours.map((c) => c.id);
    const { rows: lignes } = await this.db.execute<{ carrefour_id: string; code: string; signal: Signal }>(sql`
      SELECT carrefour_id, code, signal FROM ligne_feux WHERE carrefour_id = ANY (${uuids(ids)}) ORDER BY code
    `);
    const positions = await this.positionsDesLignes(ids);
    const coupentLeTram = await this.lignesQuiCoupentLeTram(ids);
    const plans = await this.plans(ids);
    const tops = await this.topsDe(ids);

    return {
      carrefours: carrefours.map((c): CarrefourTempsReel => {
        const sesPlans = plans.filter((p) => p.carrefour_id === c.id);
        const { plans: synchros } = synchroniserPlans(sesPlans, tops.filter((t) => t.carrefour_id === c.id));
        const sesLignes = lignes.filter((l) => l.carrefour_id === c.id);
        const lignesTc = new Set(sesLignes.filter((l) => SIGNAUX_TC.includes(l.signal)).map((l) => l.code));
        return {
          id: c.id,
          nom: c.nom,
          position: [c.lon, c.lat],
          pres_tram: c.pres_tram,
          controleur: { mode: c.controleur.mode ?? 'inconnu', priorite_tc: c.controleur.priorite_tc ?? 'inconnue' },
          lignes: sesLignes.map((l) => ({
            code: l.code,
            pieton: typeLigne(l.signal) === 'pieton',
            tc: lignesTc.has(l.code),
            coupe_tram: !lignesTc.has(l.code) && coupentLeTram.has(`${c.id}|${l.code}`),
            positions: positions.get(`${c.id}|${l.code}`) ?? [],
          })),
          plans: sesPlans.map((p) => ({
            code: p.code,
            mode: p.mode,
            plages: p.plages,
            cycle_s: p.cycle_s,
            jaune_s: p.jaune_s,
            verts: p.lignes,
            etape_tram: p.mode === 'cycle' ? etapeTram(p.etapes, lignesTc) : null,
            synchro: synchros[p.code] ?? null,
          })),
        };
      }),
    };
  }
}
