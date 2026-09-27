import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import pg from 'pg';
import request from 'supertest';
import type { AnalyseIa } from '@voirie/schema';
import { AppModule } from '../src/app.module.js';
import { chargerOsm, trierElements } from '../scripts/osm.js';
import { ELEMENTS_OSM, FEUX_A } from './fixtures/osm.js';

// IA_PARALLELE=0 (vitest.config.e2e.ts) : aucune analyse n'est lancée, la file reste en attente.
describe('File des propositions OSM + IA (e2e)', () => {
  let app: INestApplication<Server>;
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  let carrefourA: string;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    await client.connect();
    await client.query('DELETE FROM carrefour');
    await client.query('DELETE FROM feu');
    await chargerOsm(client, trierElements({ elements: ELEMENTS_OSM }));
    const { rows } = await client.query<{ id: string }>('SELECT id FROM feu WHERE osm_id = ANY ($1::bigint[])', [FEUX_A]);

    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();

    carrefourA = (await http().post('/api/carrefours').send({ feux: rows.map((r) => r.id) }).expect(201)).body.id;
  });

  afterAll(async () => {
    await app.close();
    await client.query('DELETE FROM carrefour');
    await client.query('DELETE FROM feu');
    await client.end();
  });

  let analyse: AnalyseIa;

  it('POST /branches/detection-ia should queue the junction and answer at once', async () => {
    const { body } = await http().post(`/api/carrefours/${carrefourA}/branches/detection-ia`).expect(202);
    analyse = body;
    expect(body).toMatchObject({ statut: 'en_attente', rang: 1, erreur: null, consultee_le: null });
    expect(body.carrefour).toMatchObject({ id: carrefourA, nb_feux: FEUX_A.length });
    expect(body.position).toHaveLength(2);
  });

  it('should not queue the same junction twice', async () => {
    const { body } = await http().post(`/api/carrefours/${carrefourA}/branches/detection-ia`).expect(202);
    expect(body.id).toBe(analyse.id);
    const { body: liste } = await http().get('/api/analyses-ia').expect(200);
    expect(liste.map((a: AnalyseIa) => a.id)).toEqual([analyse.id]);
  });

  it('GET /analyses-ia/:id should return the analysis, without proposal while pending', async () => {
    const { body } = await http().get(`/api/analyses-ia/${analyse.id}`).expect(200);
    expect(body).toMatchObject({ id: analyse.id, statut: 'en_attente', resultat: null });
  });

  it('should list a finished analysis until it is consulted', async () => {
    await client.query(
      `UPDATE analyse_ia SET statut = 'terminee', resultat = '{"branches":[]}', finie_le = now() - interval '2 hours' WHERE id = $1`,
      [analyse.id],
    );
    const { body: detail } = await http().get(`/api/analyses-ia/${analyse.id}`).expect(200);
    expect(detail).toMatchObject({ statut: 'terminee', rang: null, resultat: { branches: [] } });

    const { body: consultee } = await http().put(`/api/analyses-ia/${analyse.id}/consultee`).expect(200);
    expect(consultee.consultee_le).not.toBeNull();
    expect((await http().get('/api/analyses-ia').expect(200)).body).toEqual([]);
  });

  it('DELETE /analyses-ia/:id should remove it, but not while running', async () => {
    await client.query(`UPDATE analyse_ia SET statut = 'en_cours' WHERE id = $1`, [analyse.id]);
    await http().delete(`/api/analyses-ia/${analyse.id}`).expect(409);
    await client.query(`UPDATE analyse_ia SET statut = 'echec' WHERE id = $1`, [analyse.id]);
    await http().delete(`/api/analyses-ia/${analyse.id}`).expect(204);
    await http().get(`/api/analyses-ia/${analyse.id}`).expect(404);
  });

  it('should answer 404 for an unknown junction', async () => {
    await http().post('/api/carrefours/00000000-0000-4000-8000-000000000000/branches/detection-ia').expect(404);
  });
});
