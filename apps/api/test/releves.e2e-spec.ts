import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import pg from 'pg';
import request from 'supertest';
import type { BrancheLue, MouvementCarrefour, ReleveResume, SaisieReleve } from '@voirie/schema';
import { AppModule } from '../src/app.module.js';
import { chargerOsm, trierElements } from '../scripts/osm.js';
import { ELEMENTS_OSM, FEUX_A } from './fixtures/osm.js';

describe('Relevés terrain (e2e)', () => {
  let app: INestApplication<Server>;
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  let carrefourA: string;
  const http = () => request(app.getHttpServer());

  /** F1 au vert 30 s sur un cycle de 90 s, cinq cycles, finis il y a une heure ; un bus au passage. */
  const debut = Date.now() - 3_600_000 - 5 * 90_000;
  const saisies: SaisieReleve[] = [
    ...Array.from({ length: 5 }, (_, i) => [
      { t: debut + i * 90_000, ligne: 'F1', couleur: 'vert' as const },
      { t: debut + i * 90_000 + 30_000, ligne: 'F1', couleur: 'rouge' as const },
    ]).flat(),
    { t: debut + 10_000, evenement: 'bus' },
  ];

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
    await http()
      .put(`/api/carrefours/${carrefourA}/lignes`)
      .send({
        lignes: [{ code: 'F1', signal: 'R11v', mouvements: mouvements.filter((m) => m.origine === 'S').map((m) => `${m.origine}>${m.destination}`) }],
        conflits_admis: [],
      })
      .expect(200);
  });

  afterAll(async () => {
    await app.close();
    await client.query('DELETE FROM carrefour');
    await client.query('DELETE FROM feu');
    await client.end();
  });

  it('enregistre le relevé en attente, avec la synthèse refaite par l’API', async () => {
    const { body } = await http()
      .post('/api/releves')
      .send({ carrefour_id: carrefourA, pseudo: '  Camille ', saisies: [...saisies].reverse() })
      .expect(202);
    expect(body).toMatchObject({
      pseudo: 'Camille',
      statut: 'en_attente',
      cycles_observes: 4,
      cycle_s: 90,
      ecart_type_cycle_s: 0,
      verts: { F1: 30 },
      evenements: { bus: 1, tram: 0, boucle: 0, pieton: 0 },
      observe_le: new Date(debut).toISOString(),
    });

    const { rows } = await client.query('SELECT brut, statut FROM releve WHERE id = $1', [body.id]);
    expect(rows[0].statut).toBe('en_attente');
    expect(rows[0].brut).toHaveLength(saisies.length);
    const liste: ReleveResume[] = (await http().get(`/api/carrefours/${carrefourA}/releves`).expect(200)).body;
    expect(liste.map((r) => r.id)).toEqual([body.id]);
  });

  it('refuse une ligne inconnue, un relevé sans couleur ou daté de plus d’un mois', async () => {
    await http()
      .post('/api/releves')
      .send({ carrefour_id: carrefourA, saisies: [...saisies, { t: debut, ligne: 'F9', couleur: 'vert' }] })
      .expect(400);
    await http()
      .post('/api/releves')
      .send({ carrefour_id: carrefourA, saisies: [{ t: debut, evenement: 'bus' }, { t: debut + 1, evenement: 'tram' }] })
      .expect(400);
    const vieux = saisies.map((s) => ({ ...s, t: s.t - 40 * 86_400_000 }));
    await http().post('/api/releves').send({ carrefour_id: carrefourA, saisies: vieux }).expect(400);
  });

  it('répond sans rien enregistrer quand le champ piège est rempli', async () => {
    const avant = await client.query('SELECT count(*)::int AS n FROM releve');
    await http().post('/api/releves').send({ carrefour_id: carrefourA, saisies, site_web: 'http://spam.example' }).expect(202);
    const apres = await client.query('SELECT count(*)::int AS n FROM releve');
    expect(apres.rows[0].n).toBe(avant.rows[0].n);
  });
});
