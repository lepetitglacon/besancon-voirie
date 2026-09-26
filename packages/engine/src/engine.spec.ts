import { describe, expect, it } from 'vitest';
import { capaciteLigne, cycleWebster } from './capacite.js';
import { cyclesCompatibles, decalage, modulo } from './decalage.js';

describe('capaciteLigne', () => {
  it('applique 1 800 UVP/h par voie au prorata du vert', () => {
    expect(capaciteLigne(40, 80)).toBe(900);
    expect(capaciteLigne(40, 80, 2)).toBe(1800);
  });

  it('refuse un vert plus long que le cycle', () => {
    expect(() => capaciteLigne(90, 80)).toThrow(RangeError);
  });
});

describe('cycleWebster', () => {
  it('calcule C₀ = (1,5 L + 5) / (1 − Y)', () => {
    expect(cycleWebster(10, 0.5)).toBe(40);
  });

  it('renvoie null pour un carrefour saturé', () => {
    expect(cycleWebster(10, 1)).toBeNull();
  });
});

describe('decalage', () => {
  const t0A = Date.parse('2026-10-07T08:02:17.400+02:00');

  it('ramène la différence dans le cycle', () => {
    const t0B = t0A + 25_000;
    expect(decalage(t0A, t0B, 80)).toBeCloseTo(25);
  });

  it('fonctionne avec des relevés faits à des heures différentes', () => {
    const t0B = t0A + 10 * 80_000 + 12_500; // relevé 10 cycles plus tard
    expect(decalage(t0A, t0B, 80)).toBeCloseTo(12.5);
  });

  it('reste positif quand B a été relevé avant A', () => {
    const t0B = t0A - 5_000;
    expect(decalage(t0A, t0B, 80)).toBeCloseTo(75);
  });

  it('modulo est toujours positif', () => {
    expect(modulo(-5, 80)).toBe(75);
  });
});

describe('cyclesCompatibles', () => {
  it('accepte des cycles égaux ou doubles, à la tolérance près', () => {
    expect(cyclesCompatibles(80, 80.3)).toBe(true);
    expect(cyclesCompatibles(40, 80)).toBe(true);
    expect(cyclesCompatibles(70, 80)).toBe(false);
  });
});
