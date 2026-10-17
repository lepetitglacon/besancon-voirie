import { describe, expect, it } from 'vitest';
import { empriseCarrefour } from './emprise.js';
import { repereLocal, type LonLat } from './geometrie.js';

const centre: LonLat = [6.0258, 47.2428];
const { versLonLat } = repereLocal(centre);
/** Point à (x, y) mètres du centre. */
const a = (x: number, y: number) => versLonLat([x, y]);

describe('emprise d’un carrefour', () => {
  it('cadre les lignes d’arrêt, les passages et les feux, pas les voies en amont, avec la marge', () => {
    const branches = [
      { voies: [{ geom: [a(0, 15), a(0, 120)] as [LonLat, LonLat] }], passages: [[a(-6, 12), a(6, 12)] as [LonLat, LonLat]] },
      { voies: [{ geom: [a(15, 0), a(150, 0)] as [LonLat, LonLat] }] },
    ];
    const [ouest, sud, est, nord] = empriseCarrefour(branches, [a(-10, -10)], 20)!;
    const { versXY } = repereLocal(centre);
    const [xo, ys] = versXY([ouest, sud]);
    const [xe, yn] = versXY([est, nord]);
    expect(xo).toBeCloseTo(-30, 0);
    expect(ys).toBeCloseTo(-30, 0);
    expect(xe).toBeCloseTo(35, 0);
    expect(yn).toBeCloseTo(35, 0);
  });

  it('ne cadre rien sans point', () => {
    expect(empriseCarrefour([], [])).toBeNull();
  });
});
