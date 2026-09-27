import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import pg from 'pg';
import request from 'supertest';
import { repereLocal } from '@voirie/engine';
import type { BrancheLue, ConflitLignes, DetectionBranches, MouvementCarrefour } from '@voirie/schema';
import { AppModule } from '../src/app.module.js';
import { chargerOsm, trierElements } from '../scripts/osm.js';
import { CENTRE_GIRATOIRE_D, ELEMENTS_GIRATOIRE, ELEMENTS_OSM, FEUX_D, RAYON_OSM_D_M } from './fixtures/osm.js';

describe('Giratoires (e2e)', () => {
  let app: INestApplication<Server>;
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  let giratoire: string;
  let detection: DetectionBranches;
  let mouvements: MouvementCarrefour[];
  const http = () => request(app.getHttpServer());
  const depuis = (origine: string) => mouvements.filter((m) => m.origine === origine).map((m) => `${m.origine}>${m.destination}`);

  beforeAll(async () => {
    await client.connect();
    await client.query('DELETE FROM carrefour');
    await client.query('DELETE FROM feu');
    await chargerOsm(client, trierElements({ elements: [...ELEMENTS_OSM, ...ELEMENTS_GIRATOIRE] }));
    const { rows } = await client.query<{ id: string }>('SELECT id FROM feu WHERE osm_id = ANY($1::bigint[])', [FEUX_D]);

    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();

    const cree = await http()
      .post('/api/carrefours')
      .send({ feux: rows.map((r) => r.id), nature: 'giratoire' })
      .expect(201);
    giratoire = cree.body.id;
    expect(cree.body).toMatchObject({ nature: 'giratoire' });
    expect(cree.body.nom).toMatch(/^Giratoire /);
  });

  afterAll(async () => {
    await app.close();
    await client.query('DELETE FROM carrefour');
    await client.query('DELETE FROM feu');
    await client.end();
  });

  it('GET /branches/detection should take the ring from OSM and propose branches around it', async () => {
    ({ body: detection } = await http().get(`/api/carrefours/${giratoire}/branches/detection`).expect(200));
    const anneau = detection.anneau!;
    const [est, nord] = repereLocal(CENTRE_GIRATOIRE_D).versXY(anneau.centre);
    expect(Math.hypot(est, nord)).toBeLessThan(1);
    // Tracé OSM au milieu de la chaussée + une demi-voie, à l'approximation du polygone près.
    expect(anneau.rayon_m).toBeGreaterThan(RAYON_OSM_D_M);
    expect(anneau.rayon_m).toBeLessThan(RAYON_OSM_D_M + 2.5);
    expect(anneau.voies).toBe(1);
    // L'anneau n'est pas une branche : seulement les quatre rues.
    expect(detection.branches.map((b) => b.code).sort()).toEqual(['E', 'N', 'O', 'S']);
    // Toutes les entrées mènent à toutes les sorties, demi-tour compris.
    expect(detection.connexions).toHaveLength(16);
    expect(Object.values(detection.sources)).toEqual(['defaut', 'defaut', 'defaut', 'defaut']);
  });

  it('PUT /branches should save the ring and the entry priorities', async () => {
    const branches = detection.branches.map(({ sens: _sens, ...b }: BrancheLue) => ({
      ...b,
      priorite_entree: b.code === 'O' ? 'stop' : null,
    }));
    const { body } = await http()
      .put(`/api/carrefours/${giratoire}/branches`)
      .send({ branches, connexions: detection.connexions, anneau: detection.anneau })
      .expect(200);
    expect(body.anneau).toEqual(detection.anneau);
    expect(body.branches.find((b: BrancheLue) => b.code === 'O').priorite_entree).toBe('stop');
    expect(body.branches.find((b: BrancheLue) => b.code === 'N').priorite_entree).toBeNull();
    mouvements = body.mouvements;
  });

  it('GET /lignes should not list the yield entries as movements without signals', async () => {
    const { body } = await http().get(`/api/carrefours/${giratoire}/lignes`).expect(200);
    expect(body.non_commandes).toEqual([]);
  });

  it('PUT /lignes should accept a ring light and find the insertion conflict it protects', async () => {
    const { body } = await http()
      .put(`/api/carrefours/${giratoire}/lignes`)
      .send({
        lignes: [
          { code: 'A1', signal: 'R11v', anneau: 'E' },
          { code: 'F1', signal: 'R11v', mouvements: depuis('E').slice(0, 2) },
        ],
      })
      .expect(200);
    expect(body.lignes.find((l: { code: string }) => l.code === 'A1')).toMatchObject({ anneau: 'E', mouvements: [] });
    const conflit: ConflitLignes = body.conflits.find((c: ConflitLignes) => [c.a, c.b].sort().join() === 'A1,F1');
    expect(conflit).toMatchObject({ nature: 'insertion', admis: false });
    // L'entrée E a des feux : ses mouvements sans ligne sont signalés, les autres entrées cèdent le passage.
    expect(body.non_commandes).toEqual(depuis('E').slice(2));
  });

  it('PUT /lignes should refuse a ring light on an unknown branch', async () => {
    const { body } = await http()
      .put(`/api/carrefours/${giratoire}/lignes`)
      .send({ lignes: [{ code: 'A1', signal: 'R11v', anneau: 'X' }] })
      .expect(400);
    expect(body.erreurs).toEqual(["A1 : pas de branche X pour placer le feu d'anneau"]);
  });

  it('PUT /lignes should refuse a ring light that also commands movements', async () => {
    await http()
      .put(`/api/carrefours/${giratoire}/lignes`)
      .send({ lignes: [{ code: 'A1', signal: 'R11v', anneau: 'E', mouvements: depuis('E') }] })
      .expect(400);
  });
});
