import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import pg from 'pg';
import request from 'supertest';
import type { BrancheLue, ConflitLignes, Connexion, MouvementCarrefour } from '@voirie/schema';
import { AppModule } from '../src/app.module.js';
import { chargerOsm, trierElements } from '../scripts/osm.js';
import { ELEMENTS_OSM, FEUX_A } from './fixtures/osm.js';

describe('Lignes de feux et conflits (e2e)', () => {
  let app: INestApplication<Server>;
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  let carrefourA: string;
  let branches: BrancheLue[];
  let connexions: Connexion[];
  let feu: Map<number, string>;
  const http = () => request(app.getHttpServer());

  /** Toutes les clés de mouvement qui partent d'une branche. */
  let depuis: (origine: string) => string[];

  beforeAll(async () => {
    await client.connect();
    await client.query('DELETE FROM carrefour');
    await client.query('DELETE FROM feu');
    await chargerOsm(client, trierElements({ elements: ELEMENTS_OSM }));
    const { rows } = await client.query<{ osm_id: string; id: string }>('SELECT osm_id, id FROM feu');
    feu = new Map(rows.map((r) => [Number(r.osm_id), r.id]));

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
    branches = enregistrees.body.branches;
    connexions = enregistrees.body.connexions;
    const mouvements: MouvementCarrefour[] = enregistrees.body.mouvements;
    depuis = (origine) => mouvements.filter((m) => m.origine === origine).map((m) => `${m.origine}>${m.destination}`);
  });

  afterAll(async () => {
    await app.close();
    await client.query('DELETE FROM carrefour');
    await client.query('DELETE FROM feu');
    await client.end();
  });

  const lignesA = () => [
    { code: 'F1', signal: 'R11v', mouvements: depuis('S'), feux: [feu.get(101), feu.get(102)] },
    { code: 'F2', signal: 'R11v', mouvements: depuis('N'), feux: [feu.get(103)] },
    { code: 'F3', signal: 'R11v', mouvements: depuis('E') },
    { code: 'F4', signal: 'R11v', mouvements: depuis('O') },
    { code: 'P1', signal: 'R12', traverse: 'E', feux: [feu.get(104), feu.get(105)] },
  ];

  it('GET /lignes should be empty and list every movement as not commanded', async () => {
    const { body } = await http().get(`/api/carrefours/${carrefourA}/lignes`).expect(200);
    expect(body.lignes).toEqual([]);
    expect(body.non_commandes.length).toBe(body.mouvements.length);
  });

  it('PUT /lignes should save the signal groups and compute the conflict matrix', async () => {
    const { body } = await http()
      .put(`/api/carrefours/${carrefourA}/lignes`)
      .send({ lignes: lignesA(), conflits_admis: [['P1', 'F1'], ['F1', 'ZZ9']] })
      .expect(200);

    expect(body.lignes.map((l: { code: string }) => l.code)).toEqual(['F1', 'F2', 'F3', 'F4', 'P1']);
    expect(body.lignes[0].feux.sort()).toEqual([feu.get(101), feu.get(102)].sort());
    expect(body.non_commandes).toEqual([]);
    expect(body.alertes).toEqual([]);
    // La paire désignant une ligne inexistante est écartée.
    expect(body.conflits_admis).toEqual([['P1', 'F1']]);

    const conflit = (a: string, b: string) => body.conflits.find((c: ConflitLignes) => c.a === a && c.b === b);
    expect(conflit('F1', 'F2')).toMatchObject({ nature: 'croisement' }); // tourne-à-gauche S>O contre N>S
    expect(conflit('F1', 'F3')).toMatchObject({ nature: 'croisement' });
    expect(conflit('F3', 'P1')).toMatchObject({ nature: 'pieton' });
    expect(conflit('F1', 'P1')).toMatchObject({ nature: 'pieton', admis: true });
  });

  it('PUT /lignes should reject unknown movements, foreign signals and movements commanded twice', async () => {
    const inconnu = await http()
      .put(`/api/carrefours/${carrefourA}/lignes`)
      .send({ lignes: [{ code: 'F1', signal: 'R11v', mouvements: ['S>X'] }] })
      .expect(400);
    expect(inconnu.body.erreurs).toEqual(['F1 : mouvement S>X inconnu']);

    const etranger = await http()
      .put(`/api/carrefours/${carrefourA}/lignes`)
      .send({ lignes: [{ code: 'F1', signal: 'R11v', mouvements: depuis('S'), feux: [feu.get(201)] }] })
      .expect(400);
    expect(etranger.body.erreurs).toEqual([`feu ${feu.get(201)} hors de ce carrefour`]);

    await http()
      .put(`/api/carrefours/${carrefourA}/lignes`)
      .send({
        lignes: [
          { code: 'F1', signal: 'R11v', mouvements: depuis('S') },
          { code: 'F2', signal: 'R11v', mouvements: depuis('S').slice(0, 1) },
        ],
      })
      .expect(400);
  });

  it('GET /lignes should flag references broken by a later change of branches', async () => {
    const sansOuest = branches.filter((b) => b.code !== 'O').map(({ sens: _sens, ...b }) => b);
    const connexionsRestantes = connexions.filter((c) => !c.de.startsWith('O:') && !c.vers.startsWith('O:'));
    await http()
      .put(`/api/carrefours/${carrefourA}/branches`)
      .send({ branches: sansOuest, connexions: connexionsRestantes })
      .expect(200);

    const { body } = await http().get(`/api/carrefours/${carrefourA}/lignes`).expect(200);
    expect(body.alertes).toEqual(expect.arrayContaining([expect.stringMatching(/^F1 : le mouvement S>O n'existe plus$/)]));
  });
});
