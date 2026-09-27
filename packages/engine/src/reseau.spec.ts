import { describe, expect, it } from 'vitest';
import { repereLocal, type LonLat } from './geometrie.js';
import { horsDuCercle, liensParDefaut, voiesBoutTroncon } from './reseau.js';

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

describe('voies au bout d’un tronçon', () => {
  it('place les voies vers le carrefour à gauche de l’axe, vues du carrefour', () => {
    // Tronçon vers le nord : vues du carrefour, la gauche est à l'ouest.
    const { entrantes, sortantes } = voiesBoutTroncon(m(0, 30), m(0, 60), 2, 1);
    const x = (p: LonLat) => versXY(p)[0];
    expect(entrantes.map((v) => x(v[0]))).toEqual([expect.closeTo(-1.625, 3), expect.closeTo(-4.875, 3)]);
    expect(x(sortantes[0]![0])).toBeCloseTo(1.625, 3);
    expect(versXY(entrantes[0]![1])[1]).toBeCloseTo(48, 3);
  });

  it('centre un sens unique sur l’axe, rang 0 à gauche du conducteur', () => {
    // Vers le carrefour (vers le sud), la gauche du conducteur est à l'est.
    const { entrantes } = voiesBoutTroncon(m(0, 30), m(0, 60), 2, 0);
    expect(entrantes.map((v) => versXY(v[0])[0])).toEqual([expect.closeTo(1.625, 3), expect.closeTo(-1.625, 3)]);
  });
});
