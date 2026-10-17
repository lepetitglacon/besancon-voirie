import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import pg from 'pg';
import request from 'supertest';
import type { BrancheLue, FicheCarrefour, MouvementCarrefour } from '@voirie/schema';
import { AppModule } from '../src/app.module.js';
import { chargerOsm, trierElements } from '../scripts/osm.js';
import { ELEMENTS_OSM, FEUX_A } from './fixtures/osm.js';

describe('Fiche carrefour (e2e)', () => {
  let app: INestApplication<Server>;
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  let slug: string;
  let feux: string[];
  let cycle: number;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    await client.connect();
    await client.query('DELETE FROM carrefour');
    await client.query('DELETE FROM feu');
    await chargerOsm(client, trierElements({ elements: ELEMENTS_OSM }));
    const { rows } = await client.query<{ osm_id: string; id: string }>('SELECT osm_id, id FROM feu');
    const feu = new Map(rows.map((r) => [Number(r.osm_id), r.id]));
    feux = FEUX_A.map((id) => feu.get(id)!);

    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();

    const cree = (await http().post('/api/carrefours').send({ feux }).expect(201)).body;
    slug = cree.slug;
    const detection = await http().get(`/api/carrefours/${cree.id}/branches/detection`).expect(200);
    const enregistrees = await http()
      .put(`/api/carrefours/${cree.id}/branches`)
      .send({ branches: detection.body.branches.map(({ sens: _sens, ...b }: BrancheLue) => b), connexions: detection.body.connexions })
      .expect(200);
    const mouvements: MouvementCarrefour[] = enregistrees.body.mouvements;
    const depuis = (origine: string) => mouvements.filter((m) => m.origine === origine).map((m) => `${m.origine}>${m.destination}`);
    await http()
      .put(`/api/carrefours/${cree.id}/lignes`)
      .send({
        lignes: [
          { code: 'F1', signal: 'R11v', mouvements: depuis('S'), feux: [feux[0]] },
          { code: 'F2', signal: 'R11v', mouvements: depuis('N') },
          { code: 'P1', signal: 'R12', traverse: 'E' },
        ],
        conflits_admis: [['P1', 'F1']],
      })
      .expect(200);
    const { body } = await http()
      .put(`/api/carrefours/${cree.id}/programme`)
      .send({
        plans: [
          {
            code: 'jour',
            mode: 'cycle',
            plages: [{ jours: 'tous', de: '06:30', a: '20:30' }],
            etapes: [
              { lignes: ['F1', 'P1'], duree_s: 25 },
              { lignes: ['F2'], duree_s: 15, appel: 'F2' },
            ],
          },
          { code: 'nuit', mode: 'jaune_clignotant', plages: [{ jours: 'tous', de: '22:00', a: '06:00' }] },
        ],
      })
      .expect(200);
    cycle = body.plans.find((p: { code: string }) => p.code === 'jour').cycle_s;
  });

  afterAll(async () => {
    await app.close();
    await client.query('DELETE FROM carrefour');
    await client.query('DELETE FROM feu');
    await client.end();
  });

  it('rassemble branches, lignes, plans avec leur diagramme, et relevés', async () => {
    const fiche: FicheCarrefour = (await http().get(`/api/carrefours/${slug}`).expect(200)).body;
    expect(fiche.carrefour).toMatchObject({ slug, nb_feux: feux.length });
    expect(fiche.carrefour.position).toHaveLength(2);
    expect(fiche.branches.length).toBeGreaterThan(0);
    expect(fiche.lignes.map((l) => [l.code, l.feux])).toEqual([['F1', 1], ['F2', 0], ['P1', 0]]);

    const jour = fiche.plans.find((p) => p.code === 'jour')!;
    expect(jour.diagramme?.cycle_s).toBe(cycle);
    expect(jour.diagramme?.etapes).toHaveLength(2);
    expect(Object.keys(jour.diagramme!.verts).sort()).toEqual(['F1', 'F2', 'P1']);
    expect(jour.appels).toEqual(['F2']);
    expect(jour.synchro).toMatchObject({ confiance: 'inconnue' });
    expect(fiche.plans.find((p) => p.code === 'nuit')).toMatchObject({ mode: 'jaune_clignotant', diagramme: null, synchro: null });
    expect(fiche.releves).toEqual([]);
  });

  it('laisse passer la suggestion de nom, et répond 404 pour un slug inconnu', async () => {
    await http().get(`/api/carrefours/suggestion-nom?feux=${feux.join(',')}`).expect(200);
    await http().get('/api/carrefours/carrefour-qui-n-existe-pas').expect(404);
  });
});
