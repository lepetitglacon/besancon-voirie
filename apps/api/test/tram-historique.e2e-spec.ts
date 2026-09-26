import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { Server } from 'node:http';
import { AppModule } from '../src/app.module.js';
import { DRIZZLE, type Db } from '../src/db/db.module.js';
import { tramPassage } from '../src/db/schema.js';
import { debutJourService } from '../src/tram/collecte.js';
import { HistoriqueTramService } from '../src/tram/historique.service.js';

/** Les 5 derniers jours de semaine (lundi-vendredi) avant aujourd'hui, `AAAA-MM-JJ`. */
function joursDeSemaine(): string[] {
  const jours: string[] = [];
  for (let recul = 1; jours.length < 5; recul++) {
    const date = new Date(Date.now() - recul * 86_400_000);
    const jourSemaine = date.getUTCDay();
    if (jourSemaine !== 0 && jourSemaine !== 6) jours.push(date.toISOString().slice(0, 10));
  }
  return jours;
}

/** Course A → B → C partant à `heure` (heure de Paris), avec une durée A→B donnée. */
function course(jour: string, heure: number, dureeAB: number) {
  const depart = debutJourService(jour) + heure * 3600 + 600;
  const arrets = [
    { sequence: 2, arret: 'A', arretPrecedent: null, t: depart },
    { sequence: 3, arret: 'B', arretPrecedent: 'A', t: depart + dureeAB },
    { sequence: 4, arret: 'C', arretPrecedent: 'B', t: depart + dureeAB + 100 },
  ];
  return arrets.map(({ t, ...arret }) => ({
    ...arret,
    jour,
    course: `C${heure}`,
    vehicule: '7',
    parcours: '101-0',
    heurePrevue: new Date(t * 1000),
    detecteA: new Date((t + 8) * 1000),
    // Prévision faite 30 s avant, fausse de 6 s.
    previsions: { 30: t + 6 },
  }));
}

describe('Historique tram (e2e)', () => {
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

    await db.delete(tramPassage);
    // A→B : 60, 70, 80, 90 puis 200 s (un jour de blocage) à 8 h ; toujours 50 s à 14 h.
    const jours = joursDeSemaine();
    await db
      .insert(tramPassage)
      .values(jours.flatMap((jour, i) => [...course(jour, 8, [60, 70, 80, 90, 200][i]!), ...course(jour, 14, 50)]));
  });

  afterAll(async () => {
    await db.delete(tramPassage);
    await app.close();
  });

  it('GET /api/tram/historique/troncons donne les centiles du créneau et la référence', async () => {
    const { body } = await request(app.getHttpServer())
      .get('/api/tram/historique/troncons')
      .query({ typeJour: 'semaine', heure: 8 })
      .expect(200);

    expect(body).toMatchObject({ typeJour: 'semaine', heure: 8, jours: 28 });
    const ab = body.troncons.find((t: { depart: string }) => t.depart === 'A');
    expect(ab).toMatchObject({ parcours: '101-0', arrivee: 'B', n: 5, p50: 80 });
    expect(ab.p10).toBeCloseTo(64); // 60 + 0,4 × 10
    expect(ab.p90).toBeCloseTo(156); // 90 + 0,6 × 110
    // Référence : p10 toutes heures confondues, tirée par les 50 s de 14 h.
    expect(ab.reference).toBeCloseTo(50);
    const bc = body.troncons.find((t: { depart: string }) => t.depart === 'B');
    expect(bc).toMatchObject({ n: 5, p10: 100, p50: 100, p90: 100 });
  });

  it('GET /api/tram/historique/troncons sans heure couvre toute la journée', async () => {
    const { body } = await request(app.getHttpServer())
      .get('/api/tram/historique/troncons')
      .query({ typeJour: 'semaine' })
      .expect(200);
    expect(body.heure).toBeNull();
    expect(body.troncons.find((t: { depart: string }) => t.depart === 'A').n).toBe(10);
  });

  it('GET /api/tram/historique/troncons refuse une heure invalide', async () => {
    await request(app.getHttpServer()).get('/api/tram/historique/troncons').query({ heure: 25 }).expect(400);
  });

  it('calibre l’erreur des prévisions par horizon', async () => {
    // 30 passages avec une prévision à 30 s fausse de 6 s.
    expect(await app.get(HistoriqueTramService).calibration(28)).toEqual([[30, 6]]);
  });

  it('GET /api/tram/historique/etat donne le volume et l’état de la collecte', async () => {
    const { body } = await request(app.getHttpServer()).get('/api/tram/historique/etat').expect(200);
    expect(body).toMatchObject({ collecteActive: false, passages: 30 });
  });
});
