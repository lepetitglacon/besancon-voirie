import { describe, expect, it } from 'vitest';
import { analyserReleve, basculerLigne, couleurCourante, ecartsAuPlan, fixerCouleur, vertsDansLeCycle, type SaisieReleve } from './releve.js';

/** Un feu observé : F1 vert 30 s sur un cycle de 90 s, à partir de `debut` (s). */
const cycles = (n: number, cycle_s = 90, vert_s = 30, debut = 0): SaisieReleve[] =>
  Array.from({ length: n }, (_, i) => [
    { t: (debut + i * cycle_s) * 1000, ligne: 'F1', couleur: 'vert' as const },
    { t: (debut + i * cycle_s + vert_s) * 1000, ligne: 'F1', couleur: 'rouge' as const },
  ]).flat();

describe('saisie au carrefour', () => {
  it('passe une ligne au vert, au jaune, au rouge puis au vert, un appui à chaque fois', () => {
    let saisies: SaisieReleve[] = [];
    const vues = [1, 2, 3, 4].map((t) => {
      saisies = basculerLigne(saisies, 'F1', t * 1000);
      return couleurCourante(saisies, 'F1');
    });
    expect(vues).toEqual(['vert', 'jaune', 'rouge', 'vert']);
    expect(couleurCourante(saisies, 'F2')).toBeNull();
  });

  it('passe une ligne piétonne du vert au rouge, sans jaune', () => {
    const vert = basculerLigne([], 'P1', 1000, false);
    expect(couleurCourante(basculerLigne(vert, 'P1', 2000, false), 'P1')).toBe('rouge');
  });

  it('force une couleur, sans doublon si la ligne l’a déjà', () => {
    const vert = basculerLigne([], 'F1', 1000);
    expect(fixerCouleur(vert, 'F1', 'rouge', 2000).at(-1)).toEqual({ t: 2000, ligne: 'F1', couleur: 'rouge' });
    expect(fixerCouleur(vert, 'F1', 'vert', 2000)).toHaveLength(1);
  });
});

describe('synthèse du relevé', () => {
  it('mesure le cycle, le vert et compte les événements', () => {
    const r = analyserReleve([...cycles(5), { t: 5000, evenement: 'bus' }], ['F1', 'F2']);
    expect(r.cycle).toEqual({ cycle_s: 90, ecart_type_s: 0, cycles: 4 });
    expect(r.verts).toEqual({ F1: 30, F2: null });
    expect(r.jaunes).toEqual({ F1: null, F2: null });
    expect(r.tops.F1).toHaveLength(5);
    expect(r.evenements.bus).toBe(1);
    expect(r.evenementsParLigne).toEqual({});
  });

  it('écarte un cycle doublé par un appui oublié', () => {
    const saisies = cycles(5).filter((s) => s.t !== 180_000);
    expect(analyserReleve(saisies, ['F1']).cycle).toMatchObject({ cycle_s: 90, cycles: 2 });
  });

  it('compte les événements rattachés à chaque ligne', () => {
    const r = analyserReleve(
      [
        ...cycles(3),
        { t: 1000, evenement: 'bus', ligne: 'F1' },
        { t: 2000, evenement: 'bus', ligne: 'F1' },
        { t: 3000, evenement: 'boucle', ligne: 'F2' },
        { t: 4000, evenement: 'tram' },
      ],
      ['F1', 'F2'],
    );
    expect(r.evenements).toEqual({ bus: 2, tram: 1, boucle: 1, pieton: 0 });
    expect(r.evenementsParLigne).toEqual({ F1: { bus: 2 }, F2: { boucle: 1 } });
    expect(r.verts.F1).toBe(30);
  });

  it('mesure le vert jusqu’au jaune, et le jaune jusqu’au rouge', () => {
    const avecJaune: SaisieReleve[] = [0, 90, 180].flatMap((d) => [
      { t: d * 1000, ligne: 'F1', couleur: 'vert' as const },
      { t: (d + 27) * 1000, ligne: 'F1', couleur: 'jaune' as const },
      { t: (d + 30) * 1000, ligne: 'F1', couleur: 'rouge' as const },
    ]);
    const r = analyserReleve(avecJaune, ['F1']);
    expect(r.verts.F1).toBe(27);
    expect(r.jaunes.F1).toBe(3);
  });

  it('attend deux cycles avant de donner un cycle mesuré', () => {
    expect(analyserReleve(cycles(2), ['F1']).cycle).toBeNull();
  });
});

describe('écarts avec le programme', () => {
  const releve = analyserReleve(cycles(5, 96, 24), ['F1']);

  it('signale un cycle et un vert qui diffèrent de 2 s ou plus', () => {
    const liste = ecartsAuPlan(releve, { code: 'jour', cycle_s: 90, verts: { F1: [[0, 30]] } });
    expect(liste.map((e) => e.ligne ?? 'cycle')).toEqual(['cycle', 'F1']);
  });

  it('recolle un vert à cheval sur la fin du cycle', () => {
    expect(ecartsAuPlan(releve, { code: 'jour', cycle_s: 96, verts: { F1: [[86, 96], [0, 14]] } })).toEqual([]);
  });

  it('ne compare rien sans plan à cycle', () => {
    expect(ecartsAuPlan(releve, null)).toEqual([]);
  });
});

describe('verts mesurés dans le cycle du programme', () => {
  // F1 vert 30 s, puis F2 vert de 35 s à 80 s, sur un cycle relevé de 90 s.
  const saisies: SaisieReleve[] = [
    ...cycles(4),
    ...Array.from({ length: 4 }, (_, i) => [
      { t: (i * 90 + 35) * 1000, ligne: 'F2', couleur: 'vert' as const },
      { t: (i * 90 + 80) * 1000, ligne: 'F2', couleur: 'rouge' as const },
    ]).flat(),
  ];

  it('cale les verts sur le début de vert de la ligne de référence', () => {
    expect(vertsDansLeCycle(saisies, { ligne: 'F1', debut_s: 0 }, 90)).toEqual({ F1: [[0, 30]], F2: [[35, 80]] });
  });

  it('découpe un vert qui passe la fin du cycle', () => {
    expect(vertsDansLeCycle(saisies, { ligne: 'F1', debut_s: 70 }, 90).F1).toEqual([[70, 90], [0, 10]]);
    expect(vertsDansLeCycle(saisies, { ligne: 'F1', debut_s: 70 }, 90).F2).toEqual([[15, 60]]);
  });

  it('ne place rien sans passage au vert de la ligne de référence', () => {
    expect(vertsDansLeCycle(saisies, { ligne: 'F3', debut_s: 0 }, 90)).toEqual({});
  });
});
