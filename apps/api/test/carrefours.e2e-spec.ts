import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import pg from 'pg';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { chargerOsm, trierElements } from '../scripts/osm.js';
import { ELEMENTS_OSM, FEUX_A, FEUX_B, FEUX_TRAVERSEE_C } from './fixtures/osm.js';

describe('Composition manuelle des carrefours (e2e)', () => {
  let app: INestApplication<Server>;
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  let idsFeux: Map<number, string>;
  const ids = (osmIds: number[]) => osmIds.map((osmId) => idsFeux.get(osmId)!);

  beforeAll(async () => {
    await client.connect();
    await client.query('DELETE FROM carrefour');
    await client.query('DELETE FROM feu');
    await chargerOsm(client, trierElements({ elements: ELEMENTS_OSM }));
    const { rows } = await client.query<{ osm_id: string; id: string }>('SELECT osm_id, id FROM feu');
    idsFeux = new Map(rows.map((r) => [Number(r.osm_id), r.id]));

    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await client.query('DELETE FROM carrefour');
    await client.query('DELETE FROM feu');
    await client.end();
  });

  it('GET /api/feux should list the signals of the bbox, all free', async () => {
    const { body } = await request(app.getHttpServer()).get('/api/feux').query({ bbox: '6,47.2,6.1,47.3' }).expect(200);
    expect(body.features).toHaveLength(8);
    expect(body.features.every((f: { properties: { carrefour_id: null } }) => f.properties.carrefour_id === null)).toBe(true);
  });

  it('GET /api/carrefours/suggestion-nom should name a group after its streets', async () => {
    const { body } = await request(app.getHttpServer())
      .get('/api/carrefours/suggestion-nom')
      .query({ feux: ids(FEUX_A).join(',') })
      .expect(200);
    expect(body).toEqual({ nom: 'Avenue B × Rue A' });
  });

  let carrefourA: string;
  let carrefourB: string;

  it('POST /api/carrefours should compose a carrefour from free signals', async () => {
    const { body } = await request(app.getHttpServer())
      .post('/api/carrefours')
      .send({ feux: ids(FEUX_A) })
      .expect(201);
    carrefourA = body.id;
    expect(body).toMatchObject({
      slug: 'avenue-b-rue-a',
      nom: 'Avenue B × Rue A',
      nature: 'carrefour',
      statut: 'non_releve',
      pres_tram: false,
      nb_feux: 5,
    });

    const { body: b } = await request(app.getHttpServer()).post('/api/carrefours').send({ feux: ids(FEUX_B) }).expect(201);
    carrefourB = b.id;
    expect(b).toMatchObject({ nom: 'Avenue du Maréchal Foch', pres_tram: true, nb_feux: 1 });

    const { body: c } = await request(app.getHttpServer())
      .post('/api/carrefours')
      .send({ feux: ids(FEUX_TRAVERSEE_C), nature: 'traversee_pietonne' })
      .expect(201);
    expect(c).toMatchObject({ nom: 'Traversée piétonne, Rue C', nature: 'traversee_pietonne', nb_feux: 2 });
  });

  it('POST /api/carrefours should refuse signals that already belong to a carrefour', async () => {
    const { body } = await request(app.getHttpServer())
      .post('/api/carrefours')
      .send({ feux: ids([101]) })
      .expect(409);
    expect(body.feux).toEqual(ids([101]));
  });

  it('PATCH /api/carrefours/:id should rename and recompose, freeing removed signals', async () => {
    const { body } = await request(app.getHttpServer())
      .patch(`/api/carrefours/${carrefourA}`)
      .send({ nom: 'Carrefour A', feux: ids([101, 102, 103, 104]) })
      .expect(200);
    expect(body).toMatchObject({ nom: 'Carrefour A', slug: 'avenue-b-rue-a', nb_feux: 4 });

    const { rows } = await client.query('SELECT carrefour_id FROM feu WHERE osm_id = 105');
    expect(rows[0].carrefour_id).toBeNull();
  });

  it('DELETE /api/carrefours/:id should free its signals, unless it has field data', async () => {
    await request(app.getHttpServer()).delete(`/api/carrefours/${carrefourB}`).expect(204);
    const { rows } = await client.query('SELECT carrefour_id FROM feu WHERE osm_id = 201');
    expect(rows[0].carrefour_id).toBeNull();

    await client.query(
      `INSERT INTO releve (carrefour_id, brut, synthese, cycles_observes, observe_le)
       VALUES ($1, '{}', '{}', 4, now())`,
      [carrefourA],
    );
    await request(app.getHttpServer()).delete(`/api/carrefours/${carrefourA}`).expect(409);
  });

  it('should refuse writes when edition is disabled', async () => {
    process.env.EDITION_LOCALE = 'false';
    try {
      await request(app.getHttpServer()).post('/api/carrefours').send({ feux: ids([201]) }).expect(403);
    } finally {
      process.env.EDITION_LOCALE = 'true';
    }
  });
});
