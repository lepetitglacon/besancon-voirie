import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import pg from 'pg';
import request from 'supertest';
import type { BilanSemis, BranchesCarrefour, ReseauGeoJson } from '@voirie/schema';
import { AppModule } from '../src/app.module.js';
import { chargerOsm, trierElements, type OverpassElement } from '../scripts/osm.js';
import { COMMUNE } from './fixtures/osm.js';

const BBOX = '6.03,47.25,6.05,47.27';

// Croisement « j » de quatre rues, un feu véhicule sur chaque approche à 20 m, un passage piéton
// entre le feu nord et l'intersection, des bandes cyclables sur la rue nord, et une piste cyclable
// qui rejoint le bout de la rue est.
const CENTRE: [number, number] = [6.04, 47.26];
const point = ([est, nord]: [number, number]): { lon: number; lat: number } => ({
  lon: CENTRE[0] + est / (111_195 * Math.cos((CENTRE[1] * Math.PI) / 180)),
  lat: CENTRE[1] + nord / 111_195,
});
const POSITIONS: Record<number, [number, number]> = {
  9000: [0, 0],
  9011: [0, 150],
  9012: [0, 20],
  9013: [0, 12],
  9021: [0, -20],
  9022: [0, -150],
  9031: [20, 0],
  9032: [150, 0],
  9041: [-150, 0],
  9042: [-20, 0],
  9061: [100, 100],
};
const FEU = { highway: 'traffic_signals' };
const noeud = (id: number, tags: Record<string, string>): OverpassElement => ({ type: 'node', id, ...point(POSITIONS[id]!), tags });
const voie = (id: number, nodes: number[], tags: Record<string, string>): OverpassElement => ({
  type: 'way',
  id,
  nodes,
  tags,
  geometry: nodes.map((n) => point(POSITIONS[n]!)),
});
const ELEMENTS_RESEAU: OverpassElement[] = [
  COMMUNE,
  noeud(9012, FEU),
  noeud(9021, FEU),
  noeud(9031, FEU),
  noeud(9042, FEU),
  noeud(9013, { highway: 'crossing', crossing: 'zebra' }),
  voie(9101, [9011, 9012, 9013, 9000], { highway: 'residential', name: 'Rue Nord', cycleway: 'lane' }),
  voie(9102, [9000, 9021, 9022], { highway: 'residential', name: 'Rue Sud' }),
  voie(9103, [9000, 9031, 9032], { highway: 'residential', name: 'Rue Est' }),
  voie(9104, [9041, 9042, 9000], { highway: 'residential', name: 'Rue Ouest' }),
  voie(9105, [9061, 9032], { highway: 'cycleway' }),
];

describe('Réseau routier, carrefours bâtis sur ses nœuds et export SUMO (e2e)', () => {
  let app: INestApplication<Server>;
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  let carrefour: string;
  const http = () => request(app.getHttpServer());

  const reseau = async () => (await http().get(`/api/reseau?bbox=${BBOX}`).expect(200)).body as ReseauGeoJson;
  const branches = async () => (await http().get(`/api/carrefours/${carrefour}/branches`).expect(200)).body as BranchesCarrefour;
  const noeudOsm = async (osm: number) => (await client.query('SELECT id FROM noeud WHERE osm_node_id = $1', [osm])).rows[0].id as string;
  const compter = async () => Number((await client.query('SELECT count(*) FROM troncon WHERE NOT supprime')).rows[0].count);

  beforeAll(async () => {
    await client.connect();
    await client.query('DELETE FROM troncon');
    await client.query('DELETE FROM noeud');
    await client.query('DELETE FROM carrefour');
    await client.query('DELETE FROM feu');
    await chargerOsm(client, trierElements({ elements: ELEMENTS_RESEAU }));

    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await client.query('DELETE FROM troncon');
    await client.query('DELETE FROM noeud');
    await client.query('DELETE FROM carrefour');
    await client.query('DELETE FROM feu');
    await client.end();
  });

  it('POST /reseau/semer should cut the roads at junctions, signals and crossings, once', async () => {
    const { body }: { body: BilanSemis } = await http().post('/api/reseau/semer').send({}).expect(200);
    expect(body).toEqual({ voies_osm: 5, noeuds: 11, troncons: 10, feux: 4, pieton: 1, cyclables: 1, carrefours: 0 });
    await http().post('/api/reseau/semer').send({}).expect(409);

    const { troncons, noeuds } = await reseau();
    // Rue Nord : une voie générale et une bande cyclable dans chaque sens.
    const nord = troncons.features.find((t) => t.properties.nom === 'Rue Nord')!;
    expect(nord.properties).toMatchObject({ voies_avant: 2, voies_arriere: 2, types_avant: ['generale', 'velo'], source: 'osm' });
    expect(troncons.features.find((t) => t.properties.highway === 'cycleway')!.properties.types_avant).toEqual(['velo']);
    expect(noeuds.features.filter((n) => n.properties.feux)).toHaveLength(4);
    expect(noeuds.features.find((n) => n.properties.pieton)!.properties.pieton).toBe('marquee');
  });

  it('POST /carrefours should build the carrefour on the nodes among its lights', async () => {
    const { rows } = await client.query<{ id: string }>('SELECT id FROM feu ORDER BY osm_id');
    carrefour = (await http().post('/api/carrefours').send({ feux: rows.map((r) => r.id) }).expect(201)).body.id;
    const { rows: pris } = await client.query('SELECT osm_node_id FROM noeud WHERE carrefour_id = $1 ORDER BY osm_node_id', [carrefour]);
    // L'intersection, les quatre lignes d'arrêt et le passage piéton ; pas les bouts des rues.
    expect(pris.map((r) => Number(r.osm_node_id))).toEqual([9000, 9012, 9013, 9021, 9031, 9042]);

    const vue = await branches();
    expect(vue.graphe).toBe(true);
    expect(vue.branches.map((b) => b.code).sort()).toEqual(['E', 'N', 'O', 'S']);
    const nord = vue.branches.find((b) => b.code === 'N')!;
    expect(nord.voies.filter((v) => v.sens === 'entrante').map((v) => v.type)).toEqual(['generale', 'velo']);
    expect(nord.traversee).not.toBeNull();
    expect(vue.mouvements.find((m) => m.origine === 'N' && m.destination === 'S')?.direction).toBe('tout_droit');
    expect(vue.mouvements.find((m) => m.origine === 'N' && m.destination === 'E')?.direction).toBe('gauche');
    // Connexions proposées d'après les liaisons des nœuds, d'une voie entrante à une voie sortante.
    expect(vue.connexions).toContainEqual({ de: 'N:e0', vers: 'S:s0' });
    expect(vue.connexions_saisies).toBe(false);
    expect(vue.alertes).toEqual([]);
  });

  it('PUT /branches should save only the connexions of a carrefour built on the network, kept when the network changes', async () => {
    const vue = await branches();
    const connexions = [
      { de: 'N:e0', vers: 'S:s0' },
      { de: 'S:e0', vers: 'N:s0' },
    ];
    const envoi = (liste: typeof connexions) => http().put(`/api/carrefours/${carrefour}/branches`).send({ branches: vue.branches, connexions: liste, anneau: null });
    const { body } = await envoi(connexions).expect(200);
    expect(body).toMatchObject({ graphe: true, connexions_saisies: true, connexions });
    expect(body.mouvements.map((m: { origine: string; destination: string }) => `${m.origine}>${m.destination}`).sort()).toEqual(['N>S', 'S>N']);

    // Le réseau change autour du carrefour : ses branches sont recalculées, ses connexions restent.
    const passage = await noeudOsm(9013);
    await http().patch(`/api/reseau/noeuds/${passage}`).send({ pieton: 'non_marquee' }).expect(200);
    expect((await branches()).connexions).toEqual(connexions);
    await http().patch(`/api/reseau/noeuds/${passage}`).send({ pieton: 'marquee' }).expect(200);

    // Une voie que le carrefour n'a pas est refusée.
    await envoi([{ de: 'N:e7', vers: 'S:s0' }]).expect(400);

    // Retour aux connexions proposées.
    const { body: proposees } = await http().delete(`/api/carrefours/${carrefour}/branches/connexions`).expect(200);
    expect(proposees.connexions_saisies).toBe(false);
    expect(proposees.connexions.length).toBeGreaterThan(8);
  });

  it('PUT /reseau/noeuds/:id/liaisons should change the carrefour movements, and refuse impossible links', async () => {
    const j = await noeudOsm(9000);
    const { troncons } = await reseau();
    const id = (nom: string) => troncons.features.find((t) => t.properties.nom === nom && (t.properties.noeud_de === j || t.properties.noeud_vers === j))!.id;
    // À l'intersection, on ne garde que le tout droit du nord vers le sud.
    const liaisons = [{ de: id('Rue Nord'), voie_de: 0, vers: id('Rue Sud'), voie_vers: 0 }];
    await http().put(`/api/reseau/noeuds/${j}/liaisons`).send({ liaisons }).expect(200);
    const vue = await branches();
    expect(vue.mouvements.map((m) => `${m.origine}>${m.destination}`)).toEqual(['N>S']);
    expect(vue.alertes.length).toBeGreaterThan(0);

    await http()
      .put(`/api/reseau/noeuds/${j}/liaisons`)
      .send({ liaisons: [{ ...liaisons[0], voie_de: 5 }] })
      .expect(400);
    await http().put(`/api/reseau/noeuds/${j}/liaisons`).send({ liaisons: null }).expect(200);
    expect((await branches()).mouvements.length).toBeGreaterThan(8);
  });

  it('PATCH /reseau/noeuds/:id should move a node, change its crossing, and take it out of the carrefour', async () => {
    const passage = await noeudOsm(9013);
    const { body } = await http().patch(`/api/reseau/noeuds/${passage}`).send({ pieton: null }).expect(200);
    expect(body.properties).toMatchObject({ pieton: null, carrefour_id: carrefour });
    expect((await branches()).branches.find((b) => b.code === 'N')!.traversee).toBeNull();

    // Déplacé, le nœud entraîne les bouts de ses deux tronçons.
    const position = [6.04, 47.2601];
    await http().patch(`/api/reseau/noeuds/${passage}`).send({ position }).expect(200);
    const { troncons } = await reseau();
    const bouts = troncons.features.flatMap((t) =>
      [t.properties.noeud_de === passage && t.geometry.coordinates[0], t.properties.noeud_vers === passage && t.geometry.coordinates.at(-1)].filter(Boolean),
    );
    expect(bouts).toHaveLength(2);
    for (const bout of bouts) expect(bout).toEqual([expect.closeTo(6.04, 7), expect.closeTo(47.2601, 7)]);

    // Hors du carrefour, le passage coupe la rue nord en deux entrées : deux branches de plus.
    await http().patch(`/api/reseau/noeuds/${passage}`).send({ carrefour_id: null }).expect(200);
    expect((await branches()).branches.map((b) => b.code).sort()).toEqual(['E', 'N', 'N2', 'O', 'S', 'S2']);
    await http().patch(`/api/reseau/noeuds/${passage}`).send({ carrefour_id: carrefour, pieton: 'marquee' }).expect(200);
    expect((await branches()).branches.map((b) => b.code).sort()).toEqual(['E', 'N', 'O', 'S']);
  });

  it('POST /reseau/troncons/:id/couper should cut a section, and DELETE /reseau/noeuds/:id merge it back', async () => {
    const avant = await compter();
    const { troncons } = await reseau();
    // Le bout de la rue ouest, hors du carrefour.
    const ouest = troncons.features.find((t) => t.properties.nom === 'Rue Ouest' && t.properties.carrefour_de === null)!;
    const milieu = ouest.geometry.coordinates.reduce(([x, y], [a, b]) => [x + a / 2, y + b / 2], [0, 0]);
    const { body: coupe } = await http().post(`/api/reseau/troncons/${ouest.id}/couper`).send({ position: milieu }).expect(201);
    expect(coupe.properties).toMatchObject({ degre: 2, carrefour_id: null });
    expect(await compter()).toBe(avant + 1);
    const moities = (await reseau()).troncons.features.filter((t) => t.properties.nom === 'Rue Ouest' && t.properties.carrefour_de === null);
    expect(moities).toHaveLength(2);
    expect(moities.every((t) => t.properties.modifie)).toBe(true);

    await http().delete(`/api/reseau/noeuds/${coupe.id}`).expect(204);
    expect(await compter()).toBe(avant);
    // Une intersection ne se retire pas.
    await http().delete(`/api/reseau/noeuds/${await noeudOsm(9000)}`).expect(400);
  });

  let manuel: string;
  it('POST /reseau/troncons should draw a section, and PATCH should change its lanes and reverse it', async () => {
    const { body } = await http()
      .post('/api/reseau/troncons')
      .send({
        points: [
          [6.041, 47.2585],
          [6.0405, 47.26],
        ],
        de: { type: 'libre' },
        vers: { type: 'noeud', id: await noeudOsm(9022) },
        nom: 'Impasse D',
        voies_avant: 1,
        voies_arriere: 1,
        vitesse_kmh: 30,
      })
      .expect(201);
    manuel = body.id;
    expect(body.properties).toMatchObject({ source: 'manuel', nom: 'Impasse D', vitesse_kmh: 30 });

    const { body: modifie } = await http().patch(`/api/reseau/troncons/${manuel}`).send({ voies_avant: 2, types_avant: ['bus', 'generale'] }).expect(200);
    expect(modifie.properties).toMatchObject({ voies_avant: 2, types_avant: ['bus', 'generale'] });
    const { body: inverse } = await http().patch(`/api/reseau/troncons/${manuel}`).send({ inverser: true }).expect(200);
    expect(inverse.properties).toMatchObject({ voies_avant: 1, voies_arriere: 2, types_arriere: ['bus', 'generale'], types_avant: null });
    await http().patch(`/api/reseau/troncons/${manuel}`).send({ voies_avant: 0, voies_arriere: 0 }).expect(400);
  });

  it('GET /reseau/sumo/* should export plain XML, the carrefour nodes sharing one traffic light', async () => {
    const nod = (await http().get('/api/reseau/sumo/reseau.nod.xml').expect(200).expect('Content-Type', /xml/)).text;
    const edg = (await http().get('/api/reseau/sumo/reseau.edg.xml').expect(200)).text;
    const con = (await http().get(`/api/reseau/sumo/reseau.con.xml?bbox=${BBOX}`).expect(200)).text;
    const cfg = (await http().get('/api/reseau/sumo/reseau.netccfg').expect(200)).text;

    expect(nod.match(new RegExp(`type="traffic_light" tl="c${carrefour}"`, 'g'))).toHaveLength(6);
    expect(edg).toContain('allow="bicycle"');
    expect(edg).toMatch(new RegExp(`<edge id="-t${manuel}" [^>]*numLanes="2"`));
    expect(con.match(/<connection /g)!.length).toBeGreaterThan(10);
    expect(cfg).toContain('<connection-files value="reseau.con.xml"/>');
    await http().get('/api/reseau/sumo/autre.xml').expect(400);
  });

  it('POST /reseau/semer { reinitialiser } should start again from OSM and find the carrefour nodes again', async () => {
    const { body }: { body: BilanSemis } = await http().post('/api/reseau/semer').send({ reinitialiser: true }).expect(200);
    expect(body).toMatchObject({ troncons: 10, carrefours: 1 });
    expect((await reseau()).troncons.features.some((t) => t.id === manuel)).toBe(false);
    const vue = await branches();
    expect(vue.graphe).toBe(true);
    expect(vue.branches.map((b) => b.code).sort()).toEqual(['E', 'N', 'O', 'S']);
  });
});
