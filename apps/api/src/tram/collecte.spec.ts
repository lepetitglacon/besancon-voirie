import { debutJourService, DetecteurPassages } from './collecte.js';
import type { ReseauTramInterne } from './gtfs.js';
import type { CourseTempsReel, FluxTempsReel } from './temps-reel.js';

// Course C1 : A (08:00) → B (08:02) → C (08:04), jour de service 2026-09-28 (lundi).
const reseau = {
  courses: new Map([
    [
      'C1',
      {
        parcours: '101-0',
        arrets: [
          { sequence: 2, arret: 'A', theorique: 8 * 3600 },
          { sequence: 3, arret: 'B', theorique: 8 * 3600 + 120 },
          { sequence: 4, arret: 'C', theorique: 8 * 3600 + 240 },
        ],
      },
    ],
  ]),
} as unknown as ReseauTramInterne;

const JOUR = '2026-09-28';
const T0 = Date.parse('2026-09-28T08:00:00+02:00') / 1000;

/** Course C1 vue à l'instant `t`, avec les arrêts restants et leur heure prévue. */
function flux(t: number, arrets: Array<[number, string, number]>): FluxTempsReel {
  const course: CourseTempsReel = {
    course: 'C1',
    jour: JOUR,
    vehicule: '7',
    arrets: arrets.map(([sequence, arret, heure]) => ({ sequence, arret, arrivee: heure, depart: heure })),
  };
  return { horodatage: t, courses: arrets.length ? [course] : [] };
}

describe('debutJourService', () => {
  it('compte depuis minuit heure de Paris, été comme hiver', () => {
    expect(debutJourService('2026-09-28')).toBe(Date.parse('2026-09-28T00:00:00+02:00') / 1000);
    expect(debutJourService('2026-12-01')).toBe(Date.parse('2026-12-01T00:00:00+01:00') / 1000);
  });

  it('suit la règle « midi moins 12 h » le jour du passage à l’heure d’hiver', () => {
    // 25/10/2026, retour à l'heure d'hiver à 3 h : midi à Paris = 11:00 UTC, moins 12 h =
    // 23:00 UTC la veille (1 h du matin heure d'été, et non minuit).
    expect(debutJourService('2026-10-25')).toBe(Date.parse('2026-10-24T23:00:00Z') / 1000);
  });
});

describe('DetecteurPassages', () => {
  it('enregistre un arrêt disparu, daté par sa dernière heure prévue', () => {
    const detecteur = new DetecteurPassages();
    expect(detecteur.observer(reseau, flux(T0 + 100, [[3, 'B', T0 + 125], [4, 'C', T0 + 245]]))).toEqual([]);
    expect(detecteur.observer(reseau, flux(T0 + 120, [[3, 'B', T0 + 128], [4, 'C', T0 + 248]]))).toEqual([]);

    const [passage, ...autres] = detecteur.observer(reseau, flux(T0 + 136, [[4, 'C', T0 + 250]]));
    expect(autres).toEqual([]);
    expect(passage).toMatchObject({
      jour: JOUR,
      course: 'C1',
      sequence: 3,
      vehicule: '7',
      parcours: '101-0',
      arret: 'B',
      arretPrecedent: 'A',
      heurePrevue: T0 + 128,
      detecteA: T0 + 136,
      heureTheorique: T0 + 120,
    });
  });

  it('garde la prévision lue à chaque horizon avant le passage', () => {
    const detecteur = new DetecteurPassages();
    // Lectures toutes les 10 s pendant 2 min 30 : la prévision passe de B+140 à B+128.
    for (let t = T0 - 20; t <= T0 + 120; t += 10) {
      detecteur.observer(reseau, flux(t, [[3, 'B', t < T0 + 60 ? T0 + 140 : T0 + 128]]));
    }
    const [passage] = detecteur.observer(reseau, flux(T0 + 130, [[4, 'C', T0 + 250]]));
    // 30 s avant (T0+98) : lecture de T0+90 → 128 ; 120 s avant (T0+8) : lecture de T0 → 140.
    expect(passage!.previsions).toEqual({ 30: T0 + 128, 60: T0 + 128, 120: T0 + 140 });
  });

  it('ignore un arrêt sauté ou retiré bien avant son heure', () => {
    const detecteur = new DetecteurPassages();
    detecteur.observer(reseau, flux(T0, [[3, 'B', T0 + 300], [4, 'C', T0 + 420]]));
    // B disparaît près de 5 min avant son heure prévue : pas desservi normalement.
    expect(detecteur.observer(reseau, flux(T0 + 10, [[4, 'C', T0 + 420]]))).toEqual([]);
  });

  it('enregistre le terminus quand la course disparaît près de son heure', () => {
    const detecteur = new DetecteurPassages();
    detecteur.observer(reseau, flux(T0 + 230, [[4, 'C', T0 + 242]]));
    const [passage] = detecteur.observer(reseau, flux(T0 + 250, []));
    expect(passage).toMatchObject({ arret: 'C', arretPrecedent: 'B', heurePrevue: T0 + 242 });
  });

  it('ne relit pas deux fois le même flux', () => {
    const detecteur = new DetecteurPassages();
    detecteur.observer(reseau, flux(T0 + 120, [[3, 'B', T0 + 128], [4, 'C', T0 + 248]]));
    const suivant = flux(T0 + 136, [[4, 'C', T0 + 250]]);
    expect(detecteur.observer(reseau, suivant)).toHaveLength(1);
    expect(detecteur.observer(reseau, suivant)).toEqual([]);
  });
});
