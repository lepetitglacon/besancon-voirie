import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { Server } from 'node:http';
import { AppModule } from '../src/app.module.js';
import { DRIZZLE, type Db } from '../src/db/db.module.js';
import { carrefour } from '../src/db/schema.js';

describe('API (e2e)', () => {
  let app: INestApplication<Server>;
  let db: Db;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    db = app.get<Db>(DRIZZLE);
  });

  beforeEach(async () => {
    await db.delete(carrefour);
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/health should report PostGIS and pgRouting versions', async () => {
    const { body } = await request(app.getHttpServer()).get('/api/health').expect(200);
    expect(body.status).toBe('ok');
    expect(body.db.postgis).toMatch(/^3\./);
    expect(body.db.pgrouting).toMatch(/^\d+\./);
  });

  it('GET /api/carrefours should return only the carrefours inside the bbox', async () => {
    await db.insert(carrefour).values([
      { slug: 'centre', nom: 'Carrefour du centre', geom: { x: 6.0241, y: 47.2378 } },
      { slug: 'loin', nom: 'Carrefour lointain', geom: { x: 5.0, y: 47.0 } },
    ]);

    const { body } = await request(app.getHttpServer())
      .get('/api/carrefours')
      .query({ bbox: '5.95,47.2,6.1,47.3' })
      .expect(200);

    expect(body.type).toBe('FeatureCollection');
    expect(body.features).toHaveLength(1);
    expect(body.features[0].properties).toMatchObject({ slug: 'centre', statut: 'non_releve' });
    expect(body.features[0].geometry).toEqual({ type: 'Point', coordinates: [6.0241, 47.2378] });
  });

  it('GET /api/carrefours should reject an invalid bbox', async () => {
    const { body } = await request(app.getHttpServer())
      .get('/api/carrefours')
      .query({ bbox: '6.1,47.2,5.9,47.3' })
      .expect(400);

    expect(body.message).toBe('Requête invalide');
  });
});
