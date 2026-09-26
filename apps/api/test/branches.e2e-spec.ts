import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import pg from 'pg';
import request from 'supertest';
import type { Branche } from '@voirie/schema';
import { AppModule } from '../src/app.module.js';
import { chargerOsm, trierElements } from '../scripts/osm.js';
import { ELEMENTS_OSM, FEUX_A } from './fixtures/osm.js';

describe('Branches et voies (e2e)', () => {
  let app: INestApplication<Server>;
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  let carrefourA: string;

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

    const { body } = await request(app.getHttpServer())
      .post('/api/carrefours')
      .send({ feux: rows.map((r) => r.id) })
      .expect(201);
    carrefourA = body.id;
  });

  afterAll(async () => {
    await app.close();
    await client.query('DELETE FROM carrefour');
    await client.query('DELETE FROM feu');
    await client.end();
  });

  let proposition: Branche[];

  it('GET /branches/detection should propose one branch per road leaving the junction, without saving', async () => {
    const { body } = await request(app.getHttpServer()).get(`/api/carrefours/${carrefourA}/branches/detection`).expect(200);
    proposition = body.branches;

    // Triées par azimut : l'ordre exact dépend du centre, on compare par code.
    expect(Object.fromEntries(body.branches.map((b: Branche) => [b.code, [b.nom, b.sens]]))).toEqual({
      N: ['Avenue B', 'double'],
      E: ['Rue A', 'double'],
      S: ['Avenue B', 'double'],
      O: ['Rue A', 'double'],
    });
    const sud = body.branches.find((b: Branche) => b.code === 'S');
    expect(sud.voies.map((v: { mouvements: string[] }) => v.mouvements)).toEqual([['gauche'], ['tout_droit', 'droite']]);
    expect(sud.voies_sortantes).toBe(1);
    expect(body.sources).toMatchObject({ S: 'osm', N: 'defaut', E: 'defaut' });
    expect(body.mouvements).toEqual(
      expect.arrayContaining([
        { origine: 'S', destination: 'O', direction: 'gauche', voies: [0] },
        { origine: 'S', destination: 'N', direction: 'tout_droit', voies: [1] },
        { origine: 'S', destination: 'E', direction: 'droite', voies: [1] },
      ]),
    );

    const { body: enregistrees } = await request(app.getHttpServer()).get(`/api/carrefours/${carrefourA}/branches`).expect(200);
    expect(enregistrees.branches).toEqual([]);
  });

  it('PUT /branches should save the corrected branches and return the movements', async () => {
    const corrigees = proposition.map((b) => (b.code === 'E' ? { ...b, nom: 'Rue A (est)', sens: 'sortant', voies: [] } : b));
    const { body } = await request(app.getHttpServer())
      .put(`/api/carrefours/${carrefourA}/branches`)
      .send({ branches: corrigees })
      .expect(200);

    expect(body.branches.find((b: Branche) => b.code === 'E')).toMatchObject({ nom: 'Rue A (est)', sens: 'sortant', voies: [] });
    expect(body.branches.find((b: Branche) => b.code === 'S').geom).toHaveLength(2);
    expect(body.mouvements.some((m: { origine: string }) => m.origine === 'E')).toBe(false);

    const { body: relues } = await request(app.getHttpServer()).get(`/api/carrefours/${carrefourA}/branches`).expect(200);
    expect(relues).toEqual(body);
  });

  it('PUT /branches should reject duplicated codes and outgoing branches with lanes', async () => {
    const [premiere] = proposition;
    await request(app.getHttpServer())
      .put(`/api/carrefours/${carrefourA}/branches`)
      .send({ branches: [premiere, premiere] })
      .expect(400);
    await request(app.getHttpServer())
      .put(`/api/carrefours/${carrefourA}/branches`)
      .send({ branches: [{ ...premiere, sens: 'sortant' }] })
      .expect(400);
  });

  it('should answer 404 for an unknown carrefour and 403 when edition is disabled', async () => {
    await request(app.getHttpServer()).get('/api/carrefours/00000000-0000-4000-8000-000000000000/branches').expect(404);
    process.env.EDITION_LOCALE = 'false';
    try {
      await request(app.getHttpServer())
        .put(`/api/carrefours/${carrefourA}/branches`)
        .send({ branches: proposition })
        .expect(403);
    } finally {
      process.env.EDITION_LOCALE = 'true';
    }
  });
});
