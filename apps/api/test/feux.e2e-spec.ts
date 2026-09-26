import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import pg from 'pg';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { chargerOsm, trierElements } from '../scripts/osm.js';
import { ELEMENTS_OSM, FEUX_A } from './fixtures/osm.js';

describe('Placement des feux sur la photo (e2e)', () => {
  let app: INestApplication<Server>;
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  let carrefourA: string;
  let feu101: string;
  const http = () => request(app.getHttpServer());
  /** Nœud 101 dans OSM, au milieu de la chaussée. */
  const OSM_101 = [6.0302, 47.25];
  /** Son mât sur la photo, à environ 4 m au nord-est. */
  const MAT_101 = [6.03024, 47.25003];

  const centreA = async () => {
    const { rows } = await client.query('SELECT ST_X(geom) AS lon, ST_Y(geom) AS lat FROM carrefour WHERE id = $1', [carrefourA]);
    return rows[0] as { lon: number; lat: number };
  };

  beforeAll(async () => {
    await client.connect();
    await client.query('DELETE FROM carrefour');
    await client.query('DELETE FROM feu');
    await chargerOsm(client, trierElements({ elements: ELEMENTS_OSM }));
    const { rows } = await client.query<{ id: string; osm_id: string }>(
      'SELECT id, osm_id FROM feu WHERE osm_id = ANY ($1::bigint[])',
      [FEUX_A],
    );
    feu101 = rows.find((r) => Number(r.osm_id) === 101)!.id;

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

  it('GET /api/feux should give the OSM position of each signal', async () => {
    const { body } = await http().get('/api/feux').query({ bbox: '6.02,47.24,6.04,47.26' }).expect(200);
    const feu = body.features.find((f: { id: string }) => f.id === feu101);
    expect(feu.geometry.coordinates).toEqual(OSM_101);
    expect(feu.properties).toMatchObject({ position_manuelle: false, osm_lon: OSM_101[0], osm_lat: OSM_101[1] });
  });

  it('PUT /api/feux/:id/position should move the signal onto its pole, keep its OSM position and move the centre', async () => {
    const avant = await centreA();
    const { body } = await http().put(`/api/feux/${feu101}/position`).send({ position: MAT_101 }).expect(200);

    expect(body.geometry.coordinates).toEqual(MAT_101);
    expect(body.properties).toMatchObject({ position_manuelle: true, osm_lon: OSM_101[0], osm_lat: OSM_101[1] });
    // Centre des 5 feux : le déplacement d'un seul compte pour un cinquième.
    const apres = await centreA();
    expect(apres.lon - avant.lon).toBeCloseTo((MAT_101[0]! - OSM_101[0]!) / 5, 9);
  });

  it('should keep the placed position on OSM re-import', async () => {
    await chargerOsm(client, trierElements({ elements: ELEMENTS_OSM }));
    const { rows } = await client.query(
      'SELECT ST_X(geom) AS lon, ST_Y(geom) AS lat, position_manuelle FROM feu WHERE id = $1',
      [feu101],
    );
    expect(rows[0]).toEqual({ lon: MAT_101[0], lat: MAT_101[1], position_manuelle: true });
  });

  it('PUT /api/feux/:id/position with null should put the signal back at its OSM position', async () => {
    const { body } = await http().put(`/api/feux/${feu101}/position`).send({ position: null }).expect(200);
    expect(body.geometry.coordinates).toEqual(OSM_101);
    expect(body.properties.position_manuelle).toBe(false);
  });

  it('should reject a position far from OSM, and a return to OSM for a signal added by hand', async () => {
    const loin = await http().put(`/api/feux/${feu101}/position`).send({ position: [6.031, 47.25] }).expect(400);
    expect(loin.body.message).toContain('moins de 50 m');
    await http().put(`/api/feux/${feu101}/position`).send({ position: [6.03] }).expect(400);

    const { rows } = await client.query(`
      INSERT INTO feu (type, geom) VALUES ('vehicule', ST_SetSRID(ST_MakePoint(6.05, 47.25), 4326)) RETURNING id
    `);
    await http().put(`/api/feux/${rows[0].id}/position`).send({ position: [6.0501, 47.25] }).expect(200);
    await http().put(`/api/feux/${rows[0].id}/position`).send({ position: null }).expect(409);
  });

  it('should answer 404 for an unknown signal and 403 when edition is disabled', async () => {
    await http().put('/api/feux/00000000-0000-4000-8000-000000000000/position').send({ position: null }).expect(404);
    process.env.EDITION_LOCALE = 'false';
    try {
      await http().put(`/api/feux/${feu101}/position`).send({ position: MAT_101 }).expect(403);
    } finally {
      process.env.EDITION_LOCALE = 'true';
    }
  });
});
