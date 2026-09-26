import { describe, expect, it } from 'vitest';
import { PlanFeux } from './feux.js';
import { BboxQuery } from './carrefour.js';

describe('PlanFeux', () => {
  const planValide = {
    code: 'jour',
    mode: 'cycle',
    plages: [{ jours: ['lun', 'mar', 'mer', 'jeu', 'ven'], de: '06:30', a: '20:30' }],
    cycle_s: 80,
    reference: { ligne: 'F1', t0: '2026-10-07T08:02:17.400+02:00' },
    lignes: { F1: [[0, 34]], F3: [[40, 74]], P1: [[0, 20]] },
  };

  it('accepte un plan à cycle cohérent et applique le jaune par défaut', () => {
    const plan = PlanFeux.parse(planValide);
    expect(plan.mode === 'cycle' && plan.jaune_s).toBe(3);
  });

  it('refuse un vert qui dépasse le cycle', () => {
    const resultat = PlanFeux.safeParse({ ...planValide, lignes: { F1: [[40, 90]] } });
    expect(resultat.success).toBe(false);
  });

  it('refuse un intervalle inversé', () => {
    const resultat = PlanFeux.safeParse({ ...planValide, lignes: { F1: [[30, 10]] } });
    expect(resultat.success).toBe(false);
  });

  it('accepte un plan de nuit en jaune clignotant sans cycle', () => {
    const plan = PlanFeux.parse({
      code: 'nuit',
      mode: 'jaune_clignotant',
      plages: [{ jours: 'tous', de: '22:00', a: '06:00' }],
    });
    expect(plan.mode).toBe('jaune_clignotant');
  });
});

describe('BboxQuery', () => {
  it('découpe et valide une emprise', () => {
    expect(BboxQuery.parse('5.9,47.2,6.1,47.3')).toEqual([5.9, 47.2, 6.1, 47.3]);
  });

  it('refuse une emprise inversée ou incomplète', () => {
    expect(BboxQuery.safeParse('6.1,47.2,5.9,47.3').success).toBe(false);
    expect(BboxQuery.safeParse('5.9,47.2').success).toBe(false);
  });
});
