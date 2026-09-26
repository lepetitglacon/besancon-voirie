import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import pg from 'pg';
import request from 'supertest';
import type { BrancheLue, Connexion, DetectionBranches } from '@voirie/schema';
import { AppModule } from '../src/app.module.js';
import { chargerOsm, trierElements } from '../scripts/osm.js';
import { ELEMENTS_OSM, FEUX_A } from './fixtures/osm.js';

describe('Branches, voies et connexions (e2e)', () => {
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

  let proposition: DetectionBranches;
  const sans = <T extends object>(objet: T, ...cles: Array<keyof T>) =>
    Object.fromEntries(Object.entries(objet).filter(([cle]) => !cles.includes(cle as keyof T)));

  it('GET /branches/detection should propose lanes, crossings and connections, without saving', async () => {
    const { body } = await http().get(`/api/carrefours/${carrefourA}/branches/detection`).expect(200);
    proposition = body;

    const parCode = Object.fromEntries(body.branches.map((b: BrancheLue) => [b.code, b]));
    expect(Object.keys(parCode).sort()).toEqual(['E', 'N', 'O', 'S']);
    // Arrivée par le sud : deux voies entrantes (flèches OSM), une sortante, un passage piéton.
    const sud: BrancheLue = parCode.S;
    expect(sud).toMatchObject({ nom: 'Avenue B', sens: 'double' });
    expect(sud.voies.map((v) => `${v.sens}${v.rang}`)).toEqual(['entrante0', 'entrante1', 'sortante0']);
    expect(sud.voies[0]!.geom).toHaveLength(2);
    expect(sud.traversee).toHaveLength(2);

    expect(body.connexions).toEqual(
      expect.arrayContaining([
        { de: 'S:e0', vers: 'O:s0' },
        { de: 'S:e1', vers: 'N:s0' },
        { de: 'S:e1', vers: 'E:s0' },
      ]),
    );
    expect(body.fleches).toMatchObject({ 'S:e0': ['gauche'], 'S:e1': ['tout_droit', 'droite'] });
    expect(body.mouvements).toEqual(
      expect.arrayContaining([
        { origine: 'S', destination: 'O', direction: 'gauche', voies: [0] },
        { origine: 'S', destination: 'N', direction: 'tout_droit', voies: [1] },
        { origine: 'S', destination: 'E', direction: 'droite', voies: [1] },
      ]),
    );
    expect(body.sources).toMatchObject({ S: 'osm', N: 'defaut' });

    const { body: enregistrees } = await http().get(`/api/carrefours/${carrefourA}/branches`).expect(200);
    expect(enregistrees.branches).toEqual([]);
  });

  it('PUT /branches should save lanes moved on the photo and the chosen connections', async () => {
    const branches = proposition.branches.map((b) => sans(b, 'sens'));
    // Voie 1 du sud recalée d'un mètre vers l'est ; le tourne-à-gauche du sud est retiré.
    const sud = branches.find((b) => b.code === 'S') as BrancheLue;
    const [[lon, lat], bout] = sud.voies[1]!.geom;
    sud.voies[1]!.geom = [[lon + 0.000013, lat], bout];
    const connexions = proposition.connexions.filter((c: Connexion) => !(c.de === 'S:e0' && c.vers === 'O:s0'));

    const { body } = await http().put(`/api/carrefours/${carrefourA}/branches`).send({ branches, connexions }).expect(200);

    const relue = body.branches.find((b: BrancheLue) => b.code === 'S');
    expect(relue.voies[1].geom[0][0]).toBeCloseTo(lon + 0.000013, 9);
    expect(body.connexions).toHaveLength(connexions.length);
    expect(body.mouvements.some((m: { origine: string; destination: string }) => m.origine === 'S' && m.destination === 'O')).toBe(false);
    expect(body.alertes).toContain('S, voie entrante 1 : aucune connexion');

    const { body: relues } = await http().get(`/api/carrefours/${carrefourA}/branches`).expect(200);
    expect(relues).toEqual(body);
  });

  it('PUT /branches should reject invalid connections and lane ranks', async () => {
    const branches = proposition.branches.map((b) => sans(b, 'sens'));
    const envoyer = (corps: object) => http().put(`/api/carrefours/${carrefourA}/branches`).send(corps);

    const sortanteEnDepart = await envoyer({ branches, connexions: [{ de: 'S:s0', vers: 'N:s0' }] }).expect(400);
    expect(JSON.stringify(sortanteEnDepart.body.issues)).toContain("S:s0 n'est pas une voie entrante");
    await envoyer({ branches, connexions: [{ de: 'S:e0', vers: 'X:s0' }] }).expect(400);
    await envoyer({ branches: [branches[0], branches[0]], connexions: [] }).expect(400);

    const trou = branches.map((b) =>
      b.code === 'S' ? { ...b, voies: (b as BrancheLue).voies.filter((v) => !(v.sens === 'entrante' && v.rang === 0)) } : b,
    );
    await envoyer({ branches: trou, connexions: [] }).expect(400);
  });

  it('should answer 404 for an unknown carrefour and 403 when edition is disabled', async () => {
    await http().get('/api/carrefours/00000000-0000-4000-8000-000000000000/branches').expect(404);
    process.env.EDITION_LOCALE = 'false';
    try {
      await http()
        .put(`/api/carrefours/${carrefourA}/branches`)
        .send({ branches: proposition.branches.map((b) => sans(b, 'sens')), connexions: [] })
        .expect(403);
    } finally {
      process.env.EDITION_LOCALE = 'true';
    }
  });
});
