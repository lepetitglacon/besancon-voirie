import { construireReseauTram, lireCsv, secondesGtfs, type FichiersGtfs } from './gtfs.js';
import type { TronconObserve } from '@voirie/schema';
import {
  choisirTroncons,
  dureesObservees,
  ECHANTILLONS_MIN,
  positionnerTrams,
  type FluxTempsReel,
} from './temps-reel.js';

// Mini-réseau : une ligne de tram A → B → C (vers l'est, ~750 m par tronçon) et un bus.
const GTFS: FichiersGtfs = {
  'routes.txt': [
    'route_id,agency_id,route_short_name,route_long_name,route_type,route_color,route_text_color,continuous_drop_off ',
    '101,1,T1,"A <> C",0,00A5C2,FFFFFF,0',
    '5,1,5,"Bus",3,CCCCCC,000000,0',
  ].join('\n'),
  'trips.txt': [
    'route_id,service_id,trip_id,trip_headsign,direction_id,shape_id',
    '101,S1,C1,"C",0,F1',
    '101,S1,C2,"C",0,F1',
    '5,S1,BUS1,"Ailleurs",0,F9',
  ].join('\n'),
  'stop_times.txt': [
    'trip_id,arrival_time,departure_time,stop_id,stop_sequence',
    'C1,08:00:00,08:00:00,A,2',
    'C1,08:02:00,08:02:00,B,3',
    'C1,08:04:00,08:04:00,C,4',
    'C2,08:20:00,08:20:00,A,2',
    'C2,08:22:00,08:22:00,B,3',
    'C2,08:25:00,08:25:00,C,4',
    'BUS1,08:00:00,08:00:00,A,1',
  ].join('\n'),
  'stops.txt': [
    'stop_id,stop_name,stop_lat,stop_lon',
    'A,"Arrêt A",47.2401,6.00',
    'B,"Arrêt B",47.2401,6.01',
    'C,"Arrêt C, terminus",47.2401,6.02',
  ].join('\n'),
  'shapes.txt': [
    'shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence',
    'F1,47.24,6.02,2',
    'F1,47.24,6.00,0',
    'F1,47.24,6.01,1',
    'F9,47.25,6.00,0',
  ].join('\n'),
  'feed_info.txt': 'feed_publisher_name,feed_start_date\nGinko,20260910',
};

const T0 = Date.parse('2026-09-26T08:00:00+02:00') / 1000;

describe('lireCsv', () => {
  it('gère les guillemets, les virgules dans un champ et les en-têtes à espaces', () => {
    const [ligne] = lireCsv('a,b ,c\n1,"x, ""y""",3');
    expect(ligne).toEqual({ a: '1', b: 'x, "y"', c: '3' });
  });

  it('filtre sur le premier champ', () => {
    expect(lireCsv('id,v\nA,1\nB,2', (id) => id === 'B')).toEqual([{ id: 'B', v: '2' }]);
  });

  it('lit les heures GTFS au-delà de minuit', () => {
    expect(secondesGtfs('25:01:30')).toBe(90_090);
  });
});

describe('construireReseauTram', () => {
  const reseau = construireReseauTram(GTFS);

  it('ne garde que le tram, un parcours par ligne et par sens', () => {
    expect(reseau.public.parcours.map((p) => p.id)).toEqual(['101-0']);
    expect(reseau.courses.has('BUS1')).toBe(false);
    expect(reseau.public.version).toBe('20260910');
  });

  it('projette les arrêts dans l’ordre le long du tracé', () => {
    const [parcours] = reseau.public.parcours;
    expect(parcours!.ligne).toBe('T1');
    expect(parcours!.couleur).toBe('#00A5C2');
    expect(parcours!.arrets.map((a) => a.nom)).toEqual(['Arrêt A', 'Arrêt B', 'Arrêt C, terminus']);
    const [a, b, c] = parcours!.arrets.map((arret) => arret.distance);
    expect(a).toBe(0);
    expect(b).toBeCloseTo(755, -1);
    expect(c).toBeCloseTo(1510, -1);
  });

  it('prend la médiane des horaires théoriques par tronçon', () => {
    expect(reseau.dureesTheoriques.get('101-0|A|B')).toBe(120);
    expect(reseau.dureesTheoriques.get('101-0|B|C')).toBe(150);
  });
});

describe('positionnerTrams', () => {
  const reseau = construireReseauTram(GTFS);
  const flux: FluxTempsReel = {
    horodatage: T0 + 60,
    courses: [
      // Rame 7 entre A et B, puis enchaîne C2 à 08:20.
      {
        course: 'C1',
        vehicule: '7',
        arrets: [
          { sequence: 3, arret: 'B', arrivee: T0 + 100, depart: T0 + 100 },
          { sequence: 4, arret: 'C', arrivee: T0 + 190, depart: T0 + 190 },
        ],
      },
      {
        course: 'C2',
        vehicule: '7',
        arrets: [
          { sequence: 2, arret: 'A', arrivee: T0 + 1200, depart: T0 + 1200 },
          { sequence: 3, arret: 'B', arrivee: T0 + 1300, depart: T0 + 1300 },
        ],
      },
    ],
  };

  it('apprend la durée des tronçons dans les prévisions du flux', () => {
    const durees = dureesObservees(reseau, flux);
    expect(durees.get('101-0|A|B')).toBe(100);
    expect(durees.get('101-0|B|C')).toBe(90);
  });

  it('retient la course en cours de chaque rame et son tronçon', () => {
    const { horodatage, trams } = positionnerTrams(reseau, flux, (T0 + 60) * 1000);
    expect(horodatage).toBe((T0 + 60) * 1000);
    expect(trams).toHaveLength(1);
    expect(trams[0]).toMatchObject({
      vehicule: '7',
      course: 'C1',
      etat: 'en_ligne',
      arretPrecedent: 'Arrêt A',
      arretSuivant: 'Arrêt B',
      debut: 0,
      duree: 100,
      sourceDuree: 'flux',
      arrivee: (T0 + 100) * 1000,
    });
    expect(trams[0]!.fin).toBeCloseTo(755, -1);
  });

  it('pose au terminus une rame dont la prochaine course part bientôt', () => {
    const { trams } = positionnerTrams(reseau, { ...flux, courses: [flux.courses[1]!] }, (T0 + 900) * 1000);
    expect(trams[0]).toMatchObject({ etat: 'au_terminus', arretPrecedent: null, arretSuivant: 'Arrêt A' });
  });

  it('ignore une rame dont le départ est lointain', () => {
    const { trams } = positionnerTrams(reseau, { ...flux, courses: [flux.courses[1]!] }, (T0 - 60) * 1000);
    expect(trams).toEqual([]);
  });
});

describe('historique des tronçons', () => {
  const reseau = construireReseauTram(GTFS);
  const troncon = (n: number, p50: number, autre: Partial<TronconObserve> = {}): TronconObserve => ({
    parcours: '101-0',
    depart: 'A',
    arrivee: 'B',
    n,
    p10: p50 - 10,
    p50,
    p90: p50 + 30,
    reference: p50 - 15,
    ...autre,
  });
  const flux: FluxTempsReel = {
    horodatage: T0 + 60,
    courses: [
      {
        course: 'C1',
        vehicule: '7',
        arrets: [{ sequence: 3, arret: 'B', arrivee: T0 + 100, depart: T0 + 100 }],
      },
    ],
  };

  it('préfère l’heure en cours, puis la journée, si assez de passages', () => {
    const peu = choisirTroncons([troncon(ECHANTILLONS_MIN - 1, 80)], [troncon(40, 95)]);
    expect(peu.get('101-0|A|B')?.p50).toBe(95);
    const assez = choisirTroncons([troncon(ECHANTILLONS_MIN, 80)], [troncon(40, 95)]);
    expect(assez.get('101-0|A|B')?.p50).toBe(80);
    expect(choisirTroncons([], [troncon(2, 95)]).size).toBe(0);
  });

  it('prend la durée médiane observée et sa dispersion, avec la calibration', () => {
    const historique = {
      troncons: choisirTroncons([troncon(12, 110)], []),
      calibration: [[30, 6], [60, 9]] as Array<[number, number]>,
    };
    const { trams, calibration } = positionnerTrams(reseau, flux, (T0 + 60) * 1000, historique);
    expect(calibration).toEqual(historique.calibration);
    expect(trams[0]).toMatchObject({
      sourceDuree: 'historique',
      duree: 110,
      echantillons: 12,
      dureeRapide: 100,
      dureeLente: 140,
    });
  });
});
