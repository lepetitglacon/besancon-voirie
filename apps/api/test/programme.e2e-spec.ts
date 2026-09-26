import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import pg from 'pg';
import request from 'supertest';
import type { BrancheLue, MouvementCarrefour, PlanProgramme, ProgrammeCarrefour } from '@voirie/schema';
import { AppModule } from '../src/app.module.js';
import { chargerOsm, trierElements } from '../scripts/osm.js';
import { ELEMENTS_OSM, FEUX_A } from './fixtures/osm.js';

describe('Programme par étapes (e2e)', () => {
  let app: INestApplication<Server>;
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  let carrefourA: string;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    await client.connect();
    await client.query('DELETE FROM carrefour');
    await client.query('DELETE FROM feu');
    await chargerOsm(client, trierElements({ elements: ELEMENTS_OSM }));
    const { rows } = await client.query<{ osm_id: string; id: string }>('SELECT osm_id, id FROM feu');
    const feu = new Map(rows.map((r) => [Number(r.osm_id), r.id]));

    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();

    carrefourA = (await http().post('/api/carrefours').send({ feux: FEUX_A.map((id) => feu.get(id)) }).expect(201)).body.id;
    const detection = await http().get(`/api/carrefours/${carrefourA}/branches/detection`).expect(200);
    const enregistrees = await http()
      .put(`/api/carrefours/${carrefourA}/branches`)
      .send({ branches: detection.body.branches.map(({ sens: _sens, ...b }: BrancheLue) => b), connexions: detection.body.connexions })
      .expect(200);
    const mouvements: MouvementCarrefour[] = enregistrees.body.mouvements;
    const depuis = (origine: string) => mouvements.filter((m) => m.origine === origine).map((m) => `${m.origine}>${m.destination}`);
    await http()
      .put(`/api/carrefours/${carrefourA}/lignes`)
      .send({
        lignes: [
          { code: 'F1', signal: 'R11v', mouvements: depuis('S') },
          { code: 'F2', signal: 'R11v', mouvements: depuis('N') },
          { code: 'F3', signal: 'R11v', mouvements: depuis('E') },
          { code: 'F4', signal: 'R11v', mouvements: depuis('O') },
          { code: 'P1', signal: 'R12', traverse: 'E' },
        ],
        conflits_admis: [['P1', 'F1']],
      })
      .expect(200);
  });

  afterAll(async () => {
    await app.close();
    await client.query('DELETE FROM carrefour');
    await client.query('DELETE FROM feu');
    await client.end();
  });

  const jour = (surcharge: Record<string, unknown> = {}) => ({
    code: 'jour',
    mode: 'cycle',
    plages: [{ jours: ['lun', 'mar', 'mer', 'jeu', 'ven'], de: '06:30', a: '20:30' }],
    etapes: [
      { lignes: ['F1', 'P1'], duree_s: 25 },
      { lignes: ['F2'], duree_s: 15 },
      { lignes: ['F3'], duree_s: 15 },
      { lignes: ['F4'], duree_s: 15 },
    ],
    ...surcharge,
  });
  const nuit = { code: 'nuit', mode: 'jaune_clignotant', plages: [{ jours: 'tous', de: '22:00', a: '06:00' }] };
  const plan = (body: ProgrammeCarrefour, code: string) => body.plans.find((p: PlanProgramme) => p.code === code)!;

  it('GET /programme should list no plan and the computed clearance times', async () => {
    const { body } = await http().get(`/api/carrefours/${carrefourA}/programme`).expect(200);
    expect(body.plans).toEqual([]);
    const couples = body.degagements.map((d: { de: string; vers: string }) => `${d.de}>${d.vers}`);
    expect(couples).toEqual(expect.arrayContaining(['F1>F2', 'F2>F1', 'P1>F3', 'F3>P1']));
    expect(couples).not.toContain('P1>F1'); // conflit admis
    // Le piéton qui dégage la traversée demande plus de temps que le véhicule qui la coupe.
    const rouge = (de: string, vers: string) => body.degagements.find((d: { de: string; vers: string }) => d.de === de && d.vers === vers).rouge_s;
    expect(rouge('P1', 'F3')).toBeGreaterThan(rouge('F3', 'P1'));
  });

  it('PUT /programme should compute the cycle and store the signal diagram', async () => {
    const { body } = await http().put(`/api/carrefours/${carrefourA}/programme`).send({ plans: [jour(), nuit] }).expect(200);
    expect(body.alertes).toEqual([]);
    const p = plan(body, 'jour');
    expect(p).toMatchObject({ mode: 'cycle', jaune_s: 3, etapes_deduites: false });
    // 70 s de vert d'étapes, plus quatre transitions d'au moins 3 s de jaune.
    expect(p.cycle_s).toBeGreaterThanOrEqual(70 + 4 * 3);
    expect(plan(body, 'nuit')).toMatchObject({ mode: 'jaune_clignotant', cycle_s: null });

    const { rows } = await client.query<{ lignes: Record<string, Array<[number, number]>> }>(
      "SELECT lignes FROM plan_feux WHERE carrefour_id = $1 AND code = 'jour'",
      [carrefourA],
    );
    expect(rows[0]!.lignes.F1![0]).toEqual([0, 25]);
    expect(Object.keys(rows[0]!.lignes).sort()).toEqual(['F1', 'F2', 'F3', 'F4', 'P1']);
  });

  it('PUT /programme should lengthen the cycle with a clearance time entered by hand', async () => {
    const avant = plan((await http().get(`/api/carrefours/${carrefourA}/programme`).expect(200)).body, 'jour').cycle_s!;
    const { body } = await http()
      .put(`/api/carrefours/${carrefourA}/programme`)
      .send({ plans: [jour({ degagements: { 'F1>F2': 20 } }), nuit] })
      .expect(200);
    expect(plan(body, 'jour').cycle_s).toBeGreaterThan(avant);
    expect(plan(body, 'jour')).toMatchObject({ degagements: { 'F1>F2': 20 } });
  });

  it('PUT /programme should reject conflicting signal groups in the same stage', async () => {
    const { body } = await http()
      .put(`/api/carrefours/${carrefourA}/programme`)
      .send({ plans: [jour({ etapes: [{ lignes: ['F1', 'F3'], duree_s: 20 }, { lignes: ['F2', 'F4'], duree_s: 20 }] })] })
      .expect(400);
    expect(body.erreurs).toContain('Plan jour : Étape 1 : F1 et F3 sont en conflit');
  });

  it('PUT /programme should drop missing plans and keep the synchronisation reference of kept ones', async () => {
    await client.query(
      `UPDATE plan_feux SET reference = '{"ligne": "F1", "t0": "2026-10-07T08:02:17.400+02:00"}' WHERE carrefour_id = $1 AND code = 'jour'`,
      [carrefourA],
    );
    await http().put(`/api/carrefours/${carrefourA}/programme`).send({ plans: [jour()] }).expect(200);
    const { rows } = await client.query<{ code: string; reference: unknown }>(
      'SELECT code, reference FROM plan_feux WHERE carrefour_id = $1',
      [carrefourA],
    );
    expect(rows).toEqual([{ code: 'jour', reference: { ligne: 'F1', t0: '2026-10-07T08:02:17.400+02:00' } }]);
  });

  it('PUT /programme should store the stage graph and leave out-of-cycle stages from the base cycle', async () => {
    const graphe = jour({
      etapes: [
        { lignes: ['F1', 'P1'], duree_s: 25 },
        { lignes: ['F2'], duree_s: 15 },
        { lignes: ['F3'], duree_s: 15, appel: 'F3' },
        { lignes: ['F4'], duree_s: 15 },
        { lignes: ['F2'], duree_s: 10, hors_cycle: true },
      ],
      arcs: [
        { de: 0, vers: 4, demande: 'F2', anticipe: true },
        { de: 4, vers: 1 },
      ],
    });
    const sansHorsCycle = jour({ etapes: graphe.etapes.slice(0, 4) });
    const reference = plan((await http().put(`/api/carrefours/${carrefourA}/programme`).send({ plans: [sansHorsCycle] }).expect(200)).body, 'jour');
    const { body } = await http().put(`/api/carrefours/${carrefourA}/programme`).send({ plans: [graphe] }).expect(200);
    const p = plan(body, 'jour');
    expect(p).toMatchObject({ arcs: [{ de: 0, vers: 4, demande: 'F2', anticipe: true }, { de: 4, vers: 1, demande: null, anticipe: false }] });
    expect(p).toMatchObject({ etapes: [{}, {}, { appel: 'F3' }, {}, { hors_cycle: true }] });
    expect(p.cycle_s).toBe(reference.cycle_s);
  });

  it('PUT /programme should reject an arc whose demand the target stage does not serve', async () => {
    const { body } = await http()
      .put(`/api/carrefours/${carrefourA}/programme`)
      .send({
        plans: [
          jour({
            etapes: [...jour().etapes, { lignes: ['F2'], duree_s: 10, hors_cycle: true }],
            arcs: [{ de: 0, vers: 4, demande: 'F3' }],
          }),
        ],
      })
      .expect(400);
    expect(body.erreurs).toContain('Plan jour : Arc É1 → É5 : F3 doit être au vert dans É5 pour que sa demande soit servie');
  });

  it('GET /programme should rebuild the stages of a plan entered as a signal diagram', async () => {
    await client.query(
      `INSERT INTO plan_feux (carrefour_id, code, mode, plages, cycle_s, jaune_s, lignes)
       VALUES ($1, 'releve', 'cycle', '[{"jours": "tous", "de": "07:00", "a": "09:00"}]', 60, 3,
               '{"F1": [[0, 25]], "P1": [[0, 20], [59, 60]], "F2": [[30, 55]]}')`,
      [carrefourA],
    );
    const { body } = await http().get(`/api/carrefours/${carrefourA}/programme`).expect(200);
    expect(plan(body, 'releve')).toMatchObject({
      etapes_deduites: true,
      etapes: [
        { lignes: ['F1', 'P1'], duree_s: 20 },
        { lignes: ['F1'], duree_s: 5 },
        { lignes: ['F2'], duree_s: 25 },
      ],
    });
  });
});
