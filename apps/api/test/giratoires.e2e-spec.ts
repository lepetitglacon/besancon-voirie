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

  const noeudDe = (code: string) => detection.branches.find((b) => b.code === code)!.noeud!;
  /** Tronçon qui arrive au nœud, et celui qui en repart. */
  const arrivee = (noeud: string) => {
    const i = detection.anneau!.noeuds.findIndex((n) => n.code === noeud);
    const noeuds = detection.anneau!.noeuds;
    return `R${noeuds[(i - 1 + noeuds.length) % noeuds.length]!.code}`;
  };

  it('GET /branches/detection should place a node where each street meets the OSM ring', async () => {
    ({ body: detection } = await http().get(`/api/carrefours/${giratoire}/branches/detection`).expect(200));
    const noeuds = detection.anneau!.noeuds;
    expect(noeuds).toHaveLength(4);
    const repere = repereLocal(CENTRE_GIRATOIRE_D);
    for (const n of noeuds) expect(Math.hypot(...repere.versXY(n.position))).toBeCloseTo(RAYON_OSM_D_M, 0);
    const rues = detection.branches.filter((b) => !b.troncon);
    expect(rues.map((b) => b.code).sort()).toEqual(['E', 'N', 'O', 'S']);
    // Chaque rue a son propre nœud ; chaque nœud a son tronçon d'anneau.
    expect(new Set(rues.map((b) => b.noeud)).size).toBe(4);
    expect(detection.branches.filter((b) => b.troncon).map((b) => b.code).sort()).toEqual(['R1', 'R2', 'R3', 'R4']);
    // À chaque nœud : continuer, sortir, s'insérer.
    expect(detection.connexions).toHaveLength(12);
    const e = noeudDe('E');
    expect(detection.connexions).toContainEqual({ de: `${arrivee(e)}:e0`, vers: `R${e}:s0` });
    expect(detection.connexions).toContainEqual({ de: 'E:e0', vers: `R${e}:s0` });
    expect(detection.connexions).toContainEqual({ de: `${arrivee(e)}:e0`, vers: 'E:s0' });
  });

  it('PUT /branches should save the nodes, the ring sections and the entry priorities', async () => {
    const branches = detection.branches.map(({ sens: _sens, ...b }: BrancheLue) => ({
      ...b,
      priorite_entree: b.code === 'O' ? 'stop' : null,
    }));
    const { body } = await http()
      .put(`/api/carrefours/${giratoire}/branches`)
      .send({ branches, connexions: detection.connexions, anneau: detection.anneau })
      .expect(200);
    expect(body.anneau).toEqual(detection.anneau);
    expect(body.branches.find((b: BrancheLue) => b.code === 'O')).toMatchObject({ priorite_entree: 'stop', noeud: noeudDe('O'), troncon: false });
    expect(body.branches.find((b: BrancheLue) => b.code === 'R1')).toMatchObject({ troncon: true, noeud: '1' });
    mouvements = body.mouvements;
    // L'anneau continue tout droit à chaque nœud ; on y entre et on en sort à droite.
    const e = noeudDe('E');
    const direction = (o: string, d: string) => mouvements.find((m) => m.origine === o && m.destination === d)?.direction;
    expect(direction(arrivee(e), `R${e}`)).toBe('tout_droit');
    expect(direction('E', `R${e}`)).toBe('droite');
    expect(direction(arrivee(e), 'E')).toBe('droite');
  });

  it('PUT /branches should refuse a link between two different nodes', async () => {
    const branches = detection.branches.map(({ sens: _sens, ...b }: BrancheLue) => b);
    const { body } = await http()
      .put(`/api/carrefours/${giratoire}/branches`)
      .send({ branches, connexions: [...detection.connexions, { de: 'S:e0', vers: `R${noeudDe('E')}:s0` }], anneau: detection.anneau })
      .expect(400);
    expect(body.erreurs).toEqual([`S:e0 → R${noeudDe('E')}:s0 : les deux voies ne sont pas au même nœud`]);
  });

  it('GET /lignes should not list yield entries and free ring flow as movements without signals', async () => {
    const { body } = await http().get(`/api/carrefours/${giratoire}/lignes`).expect(200);
    expect(body.non_commandes).toEqual([]);
  });

  it('PUT /lignes should treat a ring light as an ordinary line and find the insertion it protects', async () => {
    const e = noeudDe('E');
    const { body } = await http()
      .put(`/api/carrefours/${giratoire}/lignes`)
      .send({
        lignes: [
          { code: 'A1', signal: 'R11v', mouvements: [`${arrivee(e)}>R${e}`] },
          { code: 'F1', signal: 'R11v', mouvements: [`E>R${e}`] },
        ],
      })
      .expect(200);
    const conflit: ConflitLignes = body.conflits.find((c: ConflitLignes) => [c.a, c.b].sort().join() === 'A1,F1');
    expect(conflit).toMatchObject({ nature: 'insertion', admis: false });
    // L'anneau a un feu à ce nœud : sa sortie vers E, sans feu, est signalée.
    expect(body.non_commandes).toEqual([`${arrivee(e)}>E`]);
  });
});
