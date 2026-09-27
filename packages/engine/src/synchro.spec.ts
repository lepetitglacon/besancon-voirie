import { describe, expect, it } from 'vitest';
import {
  bts,
  cycleObserve,
  debutsDeVert,
  decalageDuTop,
  heureLegale,
  jourExploitation,
  moyenneCirculaire,
  planEnVigueur,
  positionCycle,
  synchroniser,
} from './synchro.js';

/** Instant d'une heure légale de Paris (été : UTC+2, hiver : UTC+1). */
const paris = (iso: string) => Date.parse(iso);

describe('heure légale et BTS', () => {
  it('lit l’heure de Paris, heure d’été comme heure d’hiver', () => {
    expect(heureLegale(paris('2026-09-28T07:30:15.250+02:00'))).toEqual({ jour: 'lun', date: '2026-09-28', secondes: 27015.25 });
    expect(heureLegale(paris('2026-12-01T00:00:00+01:00'))).toMatchObject({ jour: 'mar', secondes: 0 });
  });

  it('vaut 0 à 3 h du matin et compte les secondes depuis', () => {
    expect(bts(paris('2026-09-28T03:00:00+02:00'))).toBe(0);
    expect(bts(paris('2026-09-28T07:00:00+02:00'))).toBe(4 * 3600);
    expect(bts(paris('2026-09-29T02:59:59+02:00'))).toBe(86399);
  });

  it('rattache la nuit après minuit au jour d’exploitation de la veille', () => {
    expect(jourExploitation(paris('2026-09-29T01:00:00+02:00'))).toBe('2026-09-28');
    expect(jourExploitation(paris('2026-09-29T03:00:00+02:00'))).toBe('2026-09-29');
  });
});

describe('position dans le cycle', () => {
  it('est la BTS moins le décalage, modulo le cycle', () => {
    // 07:00 = BTS 14 400 s = 160 cycles de 90 s tout ronds.
    expect(positionCycle(paris('2026-09-28T07:00:00+02:00'), 90, 0)).toBe(0);
    expect(positionCycle(paris('2026-09-28T07:00:10+02:00'), 90, 25)).toBe(75);
  });

  it('se retrouve d’un jour à l’autre, même quand le cycle ne divise pas la journée', () => {
    const lundi = positionCycle(paris('2026-09-28T08:15:00+02:00'), 70, 12);
    const mardi = positionCycle(paris('2026-09-29T08:15:00+02:00'), 70, 12);
    expect(mardi).toBe(lundi);
  });
});

describe('débuts de vert', () => {
  it('ne prend pas le 0 d’un vert à cheval sur la fin du cycle', () => {
    expect(debutsDeVert([[0, 12], [70, 90]], 90)).toEqual([70]);
    expect(debutsDeVert([[10, 30], [50, 60]], 90)).toEqual([10, 50]);
    expect(debutsDeVert([[0, 90]], 90)).toEqual([0]);
  });
});

describe('synchroniser', () => {
  const cycle = 90;
  // F1 passe au vert à t = 20 s du cycle ; décalage réel 37 s : ses verts tombent à BTS ≡ 57 (mod 90).
  const topA = paris('2026-09-28T03:00:57+02:00');

  it('déduit le décalage d’un top', () => {
    expect(decalageDuTop(topA, 20, cycle)).toBe(37);
  });

  it('est inconnue sans top', () => {
    expect(synchroniser([], cycle)).toEqual({ decalage_s: null, confiance: 'inconnue', tops: 0, jours: 0, ecart_s: null });
  });

  it('est estimée avec les tops d’un seul jour, synchronisée avec plusieurs jours concordants', () => {
    const memeJour = [topA, topA + 90_000 * 40 + 800].map((instant_ms) => ({ instant_ms, debutVert_s: 20 }));
    expect(synchroniser(memeJour, cycle)).toMatchObject({ confiance: 'estimee', jours: 1 });
    const lendemain = { instant_ms: topA + 86_400_000 - 500, debutVert_s: 20 };
    const s = synchroniser([...memeJour, lendemain], cycle);
    expect(s.confiance).toBe('synchronisee');
    expect(s.decalage_s).toBeCloseTo(37.1, 1);
    expect(s.ecart_s).toBeLessThan(1);
  });

  it('est incohérente quand les tops divergent', () => {
    const tops = [topA, topA + 86_400_000 + 20_000].map((instant_ms) => ({ instant_ms, debutVert_s: 20 }));
    expect(synchroniser(tops, cycle).confiance).toBe('incoherente');
  });

  it('moyenne les décalages de part et d’autre du 0 du cycle', () => {
    const { moyenne, ecartMax } = moyenneCirculaire([89, 1], 90);
    expect(Math.min(moyenne, 90 - moyenne)).toBeCloseTo(0, 6);
    expect(ecartMax).toBeCloseTo(1, 6);
  });
});

describe('cycleObserve', () => {
  it('mesure le cycle réel sur une série de tops', () => {
    const debut = paris('2026-09-28T08:00:00+02:00');
    expect(cycleObserve([debut, debut + 5 * 91_000], 90)).toEqual({ cycle_s: 91, cycles: 5 });
    expect(cycleObserve([debut, debut + 90_000], 90)).toBeNull();
  });
});

describe('planEnVigueur', () => {
  const jour = { code: 'jour', plages: [{ jours: ['lun', 'mar', 'mer', 'jeu', 'ven'], de: '06:30', a: '20:30' }] };
  const nuit = { code: 'nuit', plages: [{ jours: 'tous' as const, de: '22:00', a: '06:00' }] };
  const weekend = { code: 'weekend', plages: [{ jours: ['sam', 'dim'], de: '00:00', a: '00:00' }] };
  const plans = [jour, nuit, weekend];

  it('choisit le plan dont une plage couvre l’heure légale', () => {
    expect(planEnVigueur(plans, paris('2026-09-28T07:00:00+02:00'))?.code).toBe('jour');
    expect(planEnVigueur(plans, paris('2026-09-28T21:00:00+02:00'))).toBeNull();
    expect(planEnVigueur(plans, paris('2026-09-26T15:00:00+02:00'))?.code).toBe('weekend');
  });

  it('fait déborder une plage de nuit sur le lendemain', () => {
    expect(planEnVigueur(plans, paris('2026-09-28T23:30:00+02:00'))?.code).toBe('nuit');
    expect(planEnVigueur(plans, paris('2026-09-29T05:59:00+02:00'))?.code).toBe('nuit');
    expect(planEnVigueur(plans, paris('2026-09-29T06:00:00+02:00'))).toBeNull();
  });
});
