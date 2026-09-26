import { describe, expect, it } from 'vitest';
import {
  courbeConnexionXY,
  genererVoies,
  polylignesSeCoupent,
  repereLocal,
  segmentsSeCoupent,
  voieAdjacente,
  type LonLat,
} from './geometrie.js';

const centre: LonLat = [6.03, 47.25];
const repere = repereLocal(centre);
const xy = (p: LonLat) => repere.versXY(p).map((v) => Math.round(v * 100) / 100);

describe('repereLocal', () => {
  it('convertit aller-retour en mètres autour du centre', () => {
    const [x, y] = repere.versXY([6.031, 47.251]);
    expect(x).toBeCloseTo(75.5, 0); // ≈ 111 km × cos(47,25°) / 1000
    expect(y).toBeCloseTo(111.2, 0);
    const [lon, lat] = repere.versLonLat([x, y]);
    expect(lon).toBeCloseTo(6.031, 9);
    expect(lat).toBeCloseTo(47.251, 9);
  });
});

describe('genererVoies', () => {
  it('place les voies entrantes à gauche de l’axe et les sortantes à droite (vu du centre)', () => {
    // Branche sud : vue du centre, la gauche est à l'est.
    const { entrantes, sortantes, traversee } = genererVoies(centre, 180, 2, 1);
    expect(entrantes.map((v) => xy(v[0]))).toEqual([
      [1.63, -15],
      [4.87, -15], // 4,875 arrondi par défaut (représentation binaire)
    ]);
    expect(xy(entrantes[0]![1])).toEqual([1.63, -40]);
    expect(sortantes.map((v) => xy(v[0]))).toEqual([[-1.63, -15]]);
    expect(traversee.map(xy)).toEqual([
      [8, -12],
      [-4.75, -12],
    ]);
  });
});

describe('courbes et intersections', () => {
  it('détecte les segments qui se coupent, pas ceux qui se touchent', () => {
    expect(segmentsSeCoupent([0, 0], [2, 2], [0, 2], [2, 0])).toBe(true);
    expect(segmentsSeCoupent([0, 0], [1, 1], [1, 1], [2, 0])).toBe(false);
    expect(polylignesSeCoupent([[0, 0], [1, 0], [2, 2]], [[0, 2], [3, 0]])).toBe(true);
  });

  it('trace une courbe tangente aux deux voies, de la ligne d’arrêt à la voie de sortie', () => {
    const sud = genererVoies(centre, 180, 1, 1);
    const ouest = genererVoies(centre, 270, 1, 1);
    const courbe = courbeConnexionXY(sud.entrantes[0]!, ouest.sortantes[0]!, repere, 16);
    expect(courbe).toHaveLength(16);
    expect(courbe[0]!.map((v) => Math.round(v * 100) / 100)).toEqual([1.63, -15]);
    expect(courbe[15]!.map((v) => Math.round(v * 100) / 100)).toEqual([-15, 1.63]);
    // Départ vers le nord (x constant au début), arrivée vers l'ouest (y constant à la fin).
    expect(courbe[1]![0]).toBeCloseTo(1.63, 0);
    expect(courbe[14]![1]).toBeCloseTo(1.63, 0);
  });
});

describe('voieAdjacente', () => {
  it('ajoute la voie suivante du bon côté', () => {
    const { entrantes, sortantes } = genererVoies(centre, 180, 2, 2);
    // Entrantes : le rang suivant est à gauche de la voie vue du carrefour ; sortantes : à droite.
    expect(voieAdjacente(entrantes[0]!, 'gauche').map(xy)).toEqual(entrantes[1]!.map(xy));
    expect(voieAdjacente(sortantes[0]!, 'droite').map(xy)).toEqual(sortantes[1]!.map(xy));
  });
});
