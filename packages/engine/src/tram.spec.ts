import { describe, expect, it } from 'vitest';
import {
  distanceMetres,
  extraire,
  pointADistance,
  preparerPolyligne,
  projeter,
  type Coordonnees,
} from './polyligne.js';
import {
  erreurPrevision,
  estimerPositionTram,
  LISSAGE_TRAM,
  lisserDistance,
  PARAMETRES_TRAM,
} from './tram.js';

// Ligne en L autour de Besançon : ~760 m vers l'est, puis ~555 m vers le nord.
const A: Coordonnees = [6.0, 47.24];
const B: Coordonnees = [6.01, 47.24];
const C: Coordonnees = [6.01, 47.245];

describe('polyligne', () => {
  const ligne = preparerPolyligne([A, B, C]);

  it('mesure les distances en mètres', () => {
    expect(distanceMetres(A, B)).toBeCloseTo(755, 0);
    expect(distanceMetres(B, C)).toBeCloseTo(556, 0);
    expect(ligne.longueur).toBeCloseTo(1311, 0);
  });

  it('place un point le long du tracé, borné aux extrémités', () => {
    const [lon, lat] = pointADistance(ligne, ligne.cumul[1] / 2);
    expect(lon).toBeCloseTo(6.005, 6);
    expect(lat).toBeCloseTo(47.24, 6);
    expect(pointADistance(ligne, -10)).toEqual(A);
    expect(pointADistance(ligne, 1e6)).toEqual(C);
  });

  it('extrait une portion qui garde les sommets intermédiaires', () => {
    const portion = extraire(ligne, 500, 900);
    expect(portion).toHaveLength(3);
    expect(portion[1]).toEqual(B);
  });

  it('projette un point sur le tracé, au-delà d’une distance minimale', () => {
    const d = projeter(ligne, [6.005, 47.2401]);
    expect(d).toBeCloseTo(ligne.cumul[1] / 2, -1);
    expect(projeter(ligne, A, 800)).toBeGreaterThanOrEqual(800);
  });
});

describe('estimerPositionTram', () => {
  // 600 m en 90 s, arrêt en station compris : 24 km/h de vitesse commerciale.
  const troncon = { longueur: 600, duree: 90 };
  const roulage = 90 - PARAMETRES_TRAM.tempsArret;

  it('place la rame à temps restant × vitesse de roulage de l’arrêt suivant', () => {
    const { distance, vitesse } = estimerPositionTram(troncon, 30);
    expect(vitesse).toBeCloseTo(600 / roulage);
    expect(distance).toBeCloseTo(600 - (30 * 600) / roulage);
  });

  it('laisse la rame à quai pendant l’arrêt en station', () => {
    const aQuai = estimerPositionTram(troncon, roulage + 4);
    expect(aQuai.distance).toBe(0);
    expect(aQuai.aQuai).toBe('precedent');
    expect(aQuai.departDans).toBeCloseTo(4);
    const partie = estimerPositionTram(troncon, roulage - 1);
    expect(partie.distance).toBeGreaterThan(0);
    expect(partie.aQuai).toBeUndefined();
  });

  it('signale la rame à quai à l’arrêt suivant une fois l’arrivée passée', () => {
    expect(estimerPositionTram(troncon, -3).aQuai).toBe('suivant');
    expect(estimerPositionTram(troncon, 10).aQuai).toBeUndefined();
  });

  it('encadre la position estimée par la zone d’incertitude', () => {
    const { distance, distanceMin, distanceMax } = estimerPositionTram(troncon, 30);
    expect(distanceMin).toBeLessThan(distance);
    expect(distanceMax).toBeGreaterThan(distance);
  });

  it('élargit la zone quand la donnée vieillit', () => {
    const fraiche = estimerPositionTram(troncon, 45, 0);
    const vieille = estimerPositionTram(troncon, 45, 30);
    expect(vieille.distanceMax - vieille.distanceMin).toBeGreaterThan(
      fraiche.distanceMax - fraiche.distanceMin,
    );
  });

  it('laisse la rame à l’arrêt précédent quand elle est en retard', () => {
    const { distance, distanceMin } = estimerPositionTram(troncon, 200);
    expect(distance).toBe(0);
    expect(distanceMin).toBe(0);
  });

  it('pose la rame à l’arrêt suivant une fois l’heure prévue dépassée', () => {
    const { distance, distanceMax } = estimerPositionTram(troncon, -5);
    expect(distance).toBe(600);
    expect(distanceMax).toBe(600);
  });

  it('borne la zone par les durées observées quand l’historique les donne', () => {
    const repli = estimerPositionTram(troncon, 40);
    const regulier = estimerPositionTram({ ...troncon, dureeRapide: 88, dureeLente: 92 }, 40);
    const irregulier = estimerPositionTram({ ...troncon, dureeRapide: 60, dureeLente: 200 }, 40);
    expect(regulier.distance).toBe(repli.distance);
    const largeur = (p: typeof repli) => p.distanceMax - p.distanceMin;
    expect(largeur(regulier)).toBeLessThan(largeur(repli));
    expect(largeur(irregulier)).toBeGreaterThan(largeur(regulier));
  });

  it('prend l’incertitude sur le temps restant dans la calibration', () => {
    const precise = estimerPositionTram(troncon, 40, 0, [[30, 5], [60, 8]]);
    const floue = estimerPositionTram(troncon, 40, 0, [[30, 40], [60, 60]]);
    expect(floue.distanceMax - floue.distanceMin).toBeGreaterThan(precise.distanceMax - precise.distanceMin);
  });

  it('refuse un tronçon sans durée', () => {
    expect(() => estimerPositionTram({ longueur: 600, duree: 0 }, 10)).toThrow(RangeError);
  });
});

describe('lisserDistance', () => {
  it('place directement une nouvelle rame', () => {
    expect(lisserDistance(undefined, 120, 0.016)).toBe(120);
  });

  it('rejoint progressivement une estimation qui a sauté en avant', () => {
    const apresUneImage = lisserDistance(100, 200, 0.016);
    expect(apresUneImage).toBeGreaterThan(100);
    expect(apresUneImage).toBeLessThan(110);
    let affichee = 100;
    for (let i = 0; i < 5 * 60; i++) affichee = lisserDistance(affichee, 200, 1 / 60);
    expect(affichee).toBeCloseTo(200, 0);
  });

  it('attend sur place plutôt que de reculer un peu', () => {
    expect(lisserDistance(300, 250, 0.016)).toBe(300);
  });

  it('recule vers une estimation très en arrière, et replace une rame trop loin', () => {
    expect(lisserDistance(500, 500 - LISSAGE_TRAM.reculMax - 50, 0.1)).toBeLessThan(500);
    expect(lisserDistance(100, 100 + LISSAGE_TRAM.sautMax + 1, 0.016)).toBe(100 + LISSAGE_TRAM.sautMax + 1);
  });
});

describe('erreurPrevision', () => {
  const calibration: Array<[number, number]> = [
    [30, 6],
    [60, 10],
    [300, 40],
  ];

  it('interpole entre deux horizons et prolonge aux extrémités', () => {
    expect(erreurPrevision(calibration, 45)).toBeCloseTo(8);
    expect(erreurPrevision(calibration, 10)).toBe(6);
    expect(erreurPrevision(calibration, 900)).toBe(40);
  });

  it('refuse une calibration vide', () => {
    expect(() => erreurPrevision([], 30)).toThrow(RangeError);
  });
});
