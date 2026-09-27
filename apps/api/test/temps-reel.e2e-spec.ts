import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import pg from 'pg';
import request from 'supertest';
import type { BrancheLue, FeuxTempsReel, MouvementCarrefour, TopsCarrefour } from '@voirie/schema';
import { AppModule } from '../src/app.module.js';
import { chargerOsm, trierElements } from '../scripts/osm.js';
import { ELEMENTS_OSM, FEUX_A } from './fixtures/osm.js';

describe('Tops et feux en temps réel (e2e)', () => {
  let app: INestApplication<Server>;
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  let carrefourA: string;
  let cycle: number;
  const http = () => request(app.getHttpServer());

  // F1 passe au vert au début du cycle (étape 1). Lundi 28 et mardi 29 septembre 2026.
  const lundi = Date.parse('2026-09-28T07:00:37.000+02:00');
  const JOUR_MS = 86_400_000;
  const iso = (ms: number) => new Date(ms).toISOString();

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
          { code: 'F1', signal: 'R11v', mouvements: depuis('S'), feux: [feu.get(FEUX_A[0]!)] },
          { code: 'F2', signal: 'R11v', mouvements: depuis('N') },
          { code: 'F3', signal: 'R11v', mouvements: depuis('E') },
          { code: 'F4', signal: 'R11v', mouvements: depuis('O') },
          { code: 'P1', signal: 'R12', traverse: 'E' },
        ],
        conflits_admis: [['P1', 'F1']],
      })
      .expect(200);
    const { body } = await http()
      .put(`/api/carrefours/${carrefourA}/programme`)
      .send({
        plans: [
          {
            code: 'jour',
            mode: 'cycle',
            plages: [{ jours: ['lun', 'mar', 'mer', 'jeu', 'ven'], de: '06:30', a: '20:30' }],
            etapes: [
              { lignes: ['F1', 'P1'], duree_s: 25 },
              { lignes: ['F2'], duree_s: 15 },
              { lignes: ['F3'], duree_s: 15 },
              { lignes: ['F4'], duree_s: 15 },
            ],
          },
          { code: 'nuit', mode: 'jaune_clignotant', plages: [{ jours: 'tous', de: '22:00', a: '06:00' }] },
        ],
      })
      .expect(200);
    cycle = body.plans.find((p: { code: string }) => p.code === 'jour').cycle_s;
  });

  afterAll(async () => {
    await app.close();
    await client.query('DELETE FROM carrefour');
    await client.query('DELETE FROM feu');
    await client.end();
  });

  const ajouter = (ligne: string, instants: number[]) =>
    http().post(`/api/carrefours/${carrefourA}/tops`).send({ ligne, instants: instants.map(iso) });

  it('GET /tops should report unknown synchronisation before any top', async () => {
    const { body } = await http().get(`/api/carrefours/${carrefourA}/tops`).expect(200);
    expect(body).toEqual({ tops: [], plans: { jour: { decalage_s: null, confiance: 'inconnue', tops: 0, jours: 0, ecart_s: null } } });
  });

  it('POST /tops should estimate the offset from one day of tops', async () => {
    const { body } = await ajouter('F1', [lundi, lundi + 10 * cycle * 1000]).expect(201);
    const tops = (body as TopsCarrefour).tops;
    expect(tops.map((t) => t.plan)).toEqual(['jour', 'jour']);
    expect(tops[0]!.decalage_s).toBeCloseTo(tops[1]!.decalage_s!, 1);
    expect(body.plans.jour).toMatchObject({ confiance: 'estimee', tops: 2, jours: 1 });
  });

  it('POST /tops should confirm the offset with a top from another day', async () => {
    // Même heure légale le lendemain : même BTS, donc même décalage.
    const { body } = await ajouter('F1', [lundi + JOUR_MS]).expect(201);
    expect(body.plans.jour).toMatchObject({ confiance: 'synchronisee', tops: 3, jours: 2 });
    expect(body.plans.jour.ecart_s).toBeLessThan(0.1);
  });

  it('POST /tops should keep a top outside any cyclic plan without using it', async () => {
    const dimanche = Date.parse('2026-09-27T15:00:00.000+02:00');
    const { body } = await ajouter('F1', [dimanche]).expect(201);
    expect((body as TopsCarrefour).tops.find((t) => t.instant === iso(dimanche))).toMatchObject({ plan: null, decalage_s: null });
    expect(body.plans.jour.tops).toBe(3);
  });

  it('POST /tops should flag diverging tops', async () => {
    const { body } = await ajouter('F1', [lundi + 2 * JOUR_MS + 20_000]).expect(201);
    expect(body.plans.jour.confiance).toBe('incoherente');
    const dernier = (body as TopsCarrefour).tops.at(-1)!;
    const { body: apres } = await http().delete(`/api/carrefours/${carrefourA}/tops/${dernier.id}`).expect(200);
    expect(apres.plans.jour.confiance).toBe('synchronisee');
  });

  it('POST /tops should reject an unknown signal group, and require edition', async () => {
    await ajouter('F9', [lundi]).expect(400);
    await http().post(`/api/carrefours/${carrefourA}/tops`).send({ ligne: 'F1', instants: [] }).expect(400);
    process.env.EDITION_LOCALE = 'false';
    try {
      await ajouter('F1', [lundi]).expect(403);
    } finally {
      process.env.EDITION_LOCALE = 'true';
    }
  });

  it('GET /temps-reel/feux should give what the map needs to replay the signals', async () => {
    const { body } = await http().get('/api/temps-reel/feux').query({ bbox: '5.95,47.2,6.1,47.3' }).expect(200);
    const carrefour = (body as FeuxTempsReel).carrefours.find((c) => c.id === carrefourA)!;
    expect(carrefour.controleur).toEqual({ mode: 'inconnu', priorite_tc: 'inconnue' });
    // F1 : son feu physique ; F2, sans feu rattaché : le bout de ses voies entrantes.
    expect(carrefour.lignes.find((l) => l.code === 'F1')!.positions).toHaveLength(1);
    expect(carrefour.lignes.find((l) => l.code === 'F2')!.positions.length).toBeGreaterThan(0);
    expect(carrefour.lignes.find((l) => l.code === 'P1')).toMatchObject({ pieton: true });
    const jour = carrefour.plans.find((p) => p.code === 'jour')!;
    expect(jour).toMatchObject({ mode: 'cycle', cycle_s: cycle, jaune_s: 3, synchro: { confiance: 'synchronisee' } });
    expect(jour.verts!.F1![0]).toEqual([0, 25]);
    expect(carrefour.plans.find((p) => p.code === 'nuit')).toMatchObject({ mode: 'jaune_clignotant', synchro: null });
    expect(jour.etape_tram).toBeNull(); // pas de ligne R17 ni R18
    expect(carrefour.lignes.every((l) => !l.tc && !l.coupe_tram)).toBe(true); // pas de tram à A
  });

  it('GET /temps-reel/feux should mark the signal groups that cross a tram track', async () => {
    // Voie de tram nord-sud par le centre du carrefour A : les mouvements venus de l'est et de
    // l'ouest la coupent.
    await client.query(`
      INSERT INTO osm_tram (osm_id, tags, nodes, geom)
      SELECT 999001, '{"railway": "tram"}', '{}',
             ST_MakeLine(ST_Translate(geom, 0, -0.001), ST_Translate(geom, 0, 0.001))
      FROM carrefour WHERE id = $1
    `, [carrefourA]);
    try {
      const { body } = await http().get('/api/temps-reel/feux').query({ bbox: '5.95,47.2,6.1,47.3' }).expect(200);
      const carrefour = (body as FeuxTempsReel).carrefours.find((c) => c.id === carrefourA)!;
      const coupe = (code: string) => carrefour.lignes.find((l) => l.code === code)!.coupe_tram;
      expect(coupe('F3')).toBe(true);
      expect(coupe('F4')).toBe(true);
      expect(carrefour.position).toHaveLength(2);
    } finally {
      await client.query('DELETE FROM osm_tram WHERE osm_id = 999001');
    }
  });
});
