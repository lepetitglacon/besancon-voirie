import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import pg from 'pg';
import request from 'supertest';
import type { ReseauGeoJson, TronconResume } from '@voirie/schema';
import { AppModule } from '../src/app.module.js';
import { chargerOsm, trierElements } from '../scripts/osm.js';
import { ELEMENTS_OSM, FEUX_A } from './fixtures/osm.js';

const BBOX = '6.0,47.2,6.1,47.3';

describe('Réseau routier et export SUMO (e2e)', () => {
  let app: INestApplication<Server>;
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  let carrefourA: string;
  const http = () => request(app.getHttpServer());

  const troncons = async () => ((await http().get(`/api/reseau?bbox=${BBOX}`).expect(200)).body as ReseauGeoJson).troncons.features;
  const compter = async () => Number((await client.query('SELECT count(*) FROM troncon WHERE NOT supprime')).rows[0].count);

  beforeAll(async () => {
    await client.connect();
    await client.query('DELETE FROM troncon');
    await client.query('DELETE FROM noeud');
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
    await client.query('DELETE FROM troncon');
    await client.query('DELETE FROM noeud');
    await client.query('DELETE FROM carrefour');
    await client.query('DELETE FROM feu');
    await client.end();
  });

  it('POST /reseau/generer should cut the OSM roads into sections between nodes', async () => {
    const { body } = await http().post('/api/reseau/generer').expect(200);
    // Rue A, Avenue B, les deux graphies de Foch et Rue C : aucune ne partage de nœud.
    expect(body).toMatchObject({ voies_osm: 5, troncons: 5, conserves: 0 });
    const avenueB = (await troncons()).find((t) => t.properties.nom === 'Avenue B')!;
    // lanes=3, lanes:forward=2 : deux voies vers le nord, une vers le sud.
    expect(avenueB.properties).toMatchObject({ voies_avant: 2, voies_arriere: 1, source: 'osm', highway: 'primary' });
  });

  let manuel: string;
  it('POST /reseau/troncons should draw a section, cutting the section it is hooked on', async () => {
    const rueC = (await troncons()).find((t) => t.properties.nom === 'Rue C')!;
    const { body } = await http()
      .post('/api/reseau/troncons')
      .send({
        points: [
          [6.08, 47.268],
          [6.08, 47.26999],
        ],
        de: { type: 'libre' },
        vers: { type: 'troncon', id: rueC.id },
        nom: 'Impasse D',
        voies_avant: 1,
        voies_arriere: 1,
        vitesse_kmh: 30,
      })
      .expect(201);
    manuel = body.id;
    expect(body.properties).toMatchObject({ source: 'manuel', nom: 'Impasse D', vitesse_kmh: 30 });
    // Le bout accroché est ramené sur Rue C, coupée en deux à cet endroit.
    expect(body.geometry.coordinates.at(-1)).toEqual([expect.closeTo(6.08, 6), expect.closeTo(47.27, 6)]);
    const moities = (await troncons()).filter((t) => t.properties.nom === 'Rue C');
    expect(moities).toHaveLength(2);
    expect(moities.every((t) => t.properties.modifie)).toBe(true);
    expect(new Set(moities.flatMap((t) => [t.properties.noeud_de, t.properties.noeud_vers]))).toContain(body.properties.noeud_vers);
  });

  it('PUT /reseau/noeuds/:id/liaisons should save lane links at an ordinary node, and refuse impossible ones', async () => {
    const { body: reseau }: { body: ReseauGeoJson } = await http().get(`/api/reseau?bbox=${BBOX}`).expect(200);
    const impasse = reseau.troncons.features.find((t) => t.id === manuel)!;
    const noeud = impasse.properties.noeud_vers;
    expect(reseau.noeuds.features.find((n) => n.id === noeud)?.properties).toMatchObject({ degre: 3, liaisons: null });
    const rueC = reseau.troncons.features.filter((t) => t.properties.nom === 'Rue C');
    const liaisons = [{ de: manuel, voie_de: 0, vers: rueC[0]!.id, voie_vers: 0 }];

    await http().put(`/api/reseau/noeuds/${noeud}/liaisons`).send({ liaisons }).expect(200);
    const { body: apres }: { body: ReseauGeoJson } = await http().get(`/api/reseau?bbox=${BBOX}`).expect(200);
    expect(apres.noeuds.features.find((n) => n.id === noeud)?.properties.liaisons).toEqual(liaisons);

    await http()
      .put(`/api/reseau/noeuds/${noeud}/liaisons`)
      .send({ liaisons: [{ ...liaisons[0], voie_de: 3 }] })
      .expect(400);
  });

  it('PATCH /reseau/troncons/:id should change lanes, reverse, and refuse a section without lanes', async () => {
    const { body } = await http().patch(`/api/reseau/troncons/${manuel}`).send({ voies_avant: 2, voies_arriere: 0 }).expect(200);
    expect(body.properties).toMatchObject({ voies_avant: 2, voies_arriere: 0 });
    const inverse: { properties: TronconResume } = (await http().patch(`/api/reseau/troncons/${manuel}`).send({ inverser: true }).expect(200)).body;
    expect(inverse.properties).toMatchObject({
      voies_avant: 0,
      voies_arriere: 2,
      noeud_de: body.properties.noeud_vers,
      noeud_vers: body.properties.noeud_de,
    });
    await http().patch(`/api/reseau/troncons/${manuel}`).send({ voies_avant: 0, voies_arriere: 0 }).expect(400);
    await http().patch(`/api/reseau/troncons/${manuel}`).send({ voies_arriere: 0 }).expect(400);
  });

  it('POST /reseau/generer should keep hand-made and corrected sections, and not bring back deleted ones', async () => {
    const foch = (await troncons()).find((t) => t.properties.nom === 'Avenue du Maréchal Foch')!;
    await http().delete(`/api/reseau/troncons/${foch.id}`).expect(204);
    const avant = await compter();

    const { body } = await http().post('/api/reseau/generer').expect(200);
    // Rue C (deux moitiés corrigées) et Foch (supprimé) sont gardés.
    expect(body).toMatchObject({ conserves: 2 });
    expect(await compter()).toBe(avant);
    expect((await troncons()).some((t) => t.properties.nom === 'Avenue du Maréchal Foch')).toBe(false);
    expect((await troncons()).find((t) => t.id === manuel)?.properties.source).toBe('manuel');
  });

  it('GET /reseau/sumo/* should export plain XML for netconvert', async () => {
    const nod = (await http().get('/api/reseau/sumo/reseau.nod.xml').expect(200).expect('Content-Type', /xml/)).text;
    const edg = (await http().get('/api/reseau/sumo/reseau.edg.xml').expect(200)).text;
    const con = (await http().get(`/api/reseau/sumo/reseau.con.xml?bbox=${BBOX}`).expect(200)).text;
    const cfg = (await http().get('/api/reseau/sumo/reseau.netccfg').expect(200)).text;

    expect(nod).toContain('type="priority"');
    // Le tronçon tracé à la main (sens unique, 2 voies).
    expect(edg).toMatch(new RegExp(`<edge id="-t${manuel}" [^>]*numLanes="2"`));
    expect(edg).not.toContain(`id="t${manuel}"`);
    expect(con.match(/<connection /g)!.length).toBeGreaterThan(0);
    expect(cfg).toContain('<connection-files value="reseau.con.xml"/>');
    // Liaison saisie au nœud de l'impasse (le tronçon a depuis été inversé : il arrive par son arête inverse).
    expect(con).toContain(`<connection from="-t${manuel}"`);
    await http().get('/api/reseau/sumo/autre.xml').expect(400);
  });
});
