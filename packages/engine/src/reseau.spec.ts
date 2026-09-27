import { describe, expect, it } from 'vitest';
import { repereLocal, type LonLat } from './geometrie.js';
import { boutsAuNoeud, horsDuCercle, liaisonsParDefaut, liaisonsRetenues, liensParDefaut, voiesTroncon } from './reseau.js';

const centre: LonLat = [6.03, 47.25];
const { versLonLat, versXY } = repereLocal(centre);
const m = (x: number, y: number) => versLonLat([x, y]);
const distance = (p: LonLat) => Math.hypot(...versXY(p));

describe('découpe au cercle d’un carrefour', () => {
  it('coupe un tronçon qui arrive au centre', () => {
    const [morceau, ...reste] = horsDuCercle([m(0, 100), m(0, 50), m(0, 0)], centre, 30);
    expect(reste).toEqual([]);
    expect(morceau!.debutSurCercle).toBe(false);
    expect(morceau!.finSurCercle).toBe(true);
    expect(morceau!.points).toHaveLength(3);
    expect(distance(morceau!.points[2]!)).toBeCloseTo(30, 6);
  });

  it('coupe en deux un tronçon qui traverse le carrefour', () => {
    const morceaux = horsDuCercle([m(-100, 5), m(100, 5)], centre, 30);
    expect(morceaux.map((p) => [p.debutSurCercle, p.finSurCercle])).toEqual([
      [false, true],
      [true, false],
    ]);
    expect(versXY(morceaux[0]!.points[1]!)[0]).toBeCloseTo(-Math.sqrt(30 ** 2 - 25), 6);
  });

  it('ne garde rien d’un tronçon entièrement dedans, et tout d’un tronçon dehors', () => {
    expect(horsDuCercle([m(-10, 0), m(10, 0)], centre, 30)).toEqual([]);
    const dehors = [m(-100, 50), m(100, 50)];
    expect(horsDuCercle(dehors, centre, 30)).toEqual([{ points: dehors, debutSurCercle: false, finSurCercle: false }]);
  });
});

describe('liens proposés entre voies', () => {
  it('relie voie à voie à nombre égal', () => {
    expect(liensParDefaut(2, 2)).toEqual([
      [0, 0],
      [1, 1],
    ]);
  });

  it('élargit une voie en trois, et en rejoint trois en une', () => {
    expect(liensParDefaut(1, 3)).toEqual([
      [0, 0],
      [0, 1],
      [0, 2],
    ]);
    expect(liensParDefaut(3, 1)).toEqual([
      [0, 0],
      [1, 0],
      [2, 0],
    ]);
  });

  it('ne relie rien sans voie', () => {
    expect(liensParDefaut(0, 2)).toEqual([]);
  });
});

describe('voies d’une rue tout du long', () => {
  const x = (p: LonLat) => versXY(p)[0];
  const y = (p: LonLat) => versXY(p)[1];

  it('met le sens du tracé à droite de l’axe, rang 0 contre l’axe', () => {
    // Rue tracée vers le nord : à droite, c'est l'est.
    const { avant, arriere } = voiesTroncon([m(0, 0), m(0, 100)], 2, 1);
    expect(avant.map((v) => x(v[0]!))).toEqual([expect.closeTo(1.625, 3), expect.closeTo(4.875, 3)]);
    expect(x(arriere[0]![0]!)).toBeCloseTo(-1.625, 3);
    // Les voies inverses sont orientées dans leur sens de circulation : du nord vers le sud.
    expect(y(arriere[0]![0]!)).toBeCloseTo(100, 3);
    expect(y(arriere[0]!.at(-1)!)).toBeCloseTo(0, 3);
  });

  it('centre un sens unique et recule les bouts', () => {
    const { avant, arriere } = voiesTroncon([m(0, 0), m(0, 100)], 2, 0, 10, 5);
    expect(arriere).toEqual([]);
    expect(avant.map((v) => x(v[0]!))).toEqual([expect.closeTo(-1.625, 3), expect.closeTo(1.625, 3)]);
    expect(y(avant[0]![0]!)).toBeCloseTo(10, 3);
    expect(y(avant[0]!.at(-1)!)).toBeCloseTo(95, 3);
  });

  it('suit les coudes de l’axe', () => {
    const { avant } = voiesTroncon([m(0, 0), m(0, 50), m(50, 50)], 1, 0);
    expect(versXY(avant[0]![1]!)).toEqual([expect.closeTo(0, 6), expect.closeTo(50, 6)]);
    expect(avant[0]).toHaveLength(3);
  });
});

describe('liaisons voie à voie à un nœud', () => {
  // Carrefour en T au nœud « n » : rue ouest-est qui le traverse (deux tronçons), rue au nord.
  const troncons = [
    { id: 'ouest', noeud_de: 'a', noeud_vers: 'n', points: [m(-100, 0), m(0, 0)], voies_avant: 2, voies_arriere: 1 },
    { id: 'est', noeud_de: 'n', noeud_vers: 'b', points: [m(0, 0), m(100, 0)], voies_avant: 1, voies_arriere: 1 },
    { id: 'nord', noeud_de: 'c', noeud_vers: 'n', points: [m(0, 100), m(0, 0)], voies_avant: 1, voies_arriere: 1 },
  ];

  it('décrit les tronçons vus du nœud', () => {
    const bouts = boutsAuNoeud('n', troncons);
    expect(bouts.map((b) => [b.troncon, b.extremite, Math.round(b.azimut), b.arrivent, b.repartent])).toEqual([
      ['ouest', 'vers', 270, 2, 1],
      ['est', 'de', 90, 1, 1],
      ['nord', 'vers', 0, 1, 1],
    ]);
  });

  it('propose tout droit voie à voie, et les tourne-à-gauche et à droite depuis les voies du bord', () => {
    const liaisons = liaisonsParDefaut(boutsAuNoeud('n', troncons));
    const depuisOuest = liaisons.filter((l) => l.de === 'ouest').map((l) => [l.voie_de, l.vers, l.voie_vers]);
    // Venant de l'ouest (vers l'est) : tout droit vers « est » (2 → 1), à gauche vers le nord.
    expect(depuisOuest).toEqual([
      [0, 'est', 0],
      [1, 'est', 0],
      [0, 'nord', 0],
    ]);
    // Venant du nord (vers le sud) : l'est est à gauche, l'ouest à droite.
    expect(liaisons.filter((l) => l.de === 'nord').map((l) => [l.vers, l.voie_vers])).toEqual([
      ['ouest', 0],
      ['est', 0],
    ]);
  });

  it('garde les liaisons saisies encore possibles', () => {
    const bouts = boutsAuNoeud('n', troncons);
    const saisies = [
      { de: 'ouest', voie_de: 1, vers: 'nord', voie_vers: 0 },
      { de: 'ouest', voie_de: 5, vers: 'nord', voie_vers: 0 },
    ];
    expect(liaisonsRetenues(bouts, saisies)).toEqual({ liaisons: [saisies[0]], auto: false });
    expect(liaisonsRetenues(bouts, null).auto).toBe(true);
  });
});
