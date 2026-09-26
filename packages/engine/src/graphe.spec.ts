import { describe, expect, it } from 'vitest';
import { arcsDuGraphe, simulerGraphe, validerGraphe, type ArcGraphe, type Demande } from './graphe.js';
import { calculerProgramme, type EntreeProgramme, type EtapeProgramme } from './programme.js';

// F1 et F2 se croisent ; P1 traverse devant F2 ; le tram T1 coupe F1 et F2.
// É2 (piétons) n'est servie que sur appel du bouton P1 ; É4 (tram) est hors cycle.
const etapes: EtapeProgramme[] = [
  { lignes: ['F1'], duree_s: 20 },
  { lignes: ['F1', 'P1'], duree_s: 10, appel: 'P1' },
  { lignes: ['F2'], duree_s: 20 },
  { lignes: ['T1'], duree_s: 10, hors_cycle: true },
];
// Le tram écourte É1 ou É3 ; après É4, le cycle reprend après l'étape interrompue.
const arcs: ArcGraphe[] = [
  { de: 0, vers: 3, demande: 'T1', anticipe: true },
  { de: 2, vers: 3, demande: 'T1', anticipe: true },
];
const entree: EntreeProgramme = {
  lignes: [
    { code: 'F1', type: 'vehicule' },
    { code: 'F2', type: 'vehicule' },
    { code: 'P1', type: 'pieton' },
    { code: 'T1', type: 'vehicule' },
  ],
  etapes,
  jaune_s: 3,
  conflits: [
    ['F1', 'F2'],
    ['F2', 'P1'],
    ['T1', 'F1'],
    ['T1', 'F2'],
  ],
  degagements: new Map(), // 2 s par défaut
};
const codes = entree.lignes.map((l) => l.code);
const simuler = (demandes: Demande[], duree_s = 100) => simulerGraphe({ ...entree, arcs, demandes, duree_s });

describe('graphe des étapes', () => {
  it('accepte un graphe cohérent', () => {
    expect(validerGraphe(etapes, arcs, codes)).toEqual([]);
  });

  it('refuse un appel hors de l’étape et une demande non servie par l’arc', () => {
    const messages = validerGraphe(
      [etapes[0]!, { ...etapes[1]!, appel: 'F2' }, etapes[2]!, etapes[3]!],
      [{ de: 0, vers: 2, demande: 'T1', anticipe: false }],
      codes,
    ).map((c) => `${c.niveau} ${c.message}`);
    expect(messages).toEqual([
      "erreur É2 : la ligne d'appel F2 doit être au vert dans l'étape",
      'erreur Arc É1 → É3 : T1 doit être au vert dans É3 pour que sa demande soit servie',
      "avertissement É4 : hors cycle et jamais atteinte (aucun arc n'y mène)",
    ]);
  });

  it('liste les arcs : suite du cycle, saut de l’étape sur appel, priorité et reprise', () => {
    const affiches = arcsDuGraphe(entree, arcs).map((a) => `${a.de + 1}>${a.vers + 1} ${a.nature} ${a.condition} ${a.transition_s}s`.trim());
    expect(affiches).toEqual([
      '1>2 saut si P1 0s',
      '1>3 suite sans P1 5s',
      '2>3 suite  5s',
      '3>1 suite  5s',
      '1>4 demande si T1 5s',
      '3>4 demande si T1 5s',
    ]);
  });

  it('calcule le cycle de base sans l’étape hors cycle', () => {
    const r = calculerProgramme(entree);
    expect(r.etapes.map((e) => e.index)).toEqual([0, 1, 2]);
    expect(r.cycle_s).toBe(20 + 0 + 10 + 5 + 20 + 5);
    expect(r.controles).toEqual([]);
  });
});

describe('simulation du graphe', () => {
  it('saute l’étape piétonne sans appel', () => {
    const r = simuler([]);
    expect(r.etapes.map((e) => e.index)).toEqual([0, 2, 0, 2]);
    expect(r.evenements[0]).toEqual({ t: 20, message: "É2 sautée : pas d'appel P1" });
    expect(r.verts.F2).toEqual([
      [25, 45],
      [75, 95],
    ]);
  });

  it('sert l’appel piéton à la fin de l’étape en cours et mesure l’attente', () => {
    const r = simuler([{ ligne: 'P1', t: 5 }]);
    expect(r.etapes.slice(0, 3).map((e) => [e.index, e.debut_s, e.fin_s])).toEqual([
      [0, 0, 20],
      [1, 20, 30],
      [2, 35, 55],
    ]);
    expect(r.attentes).toEqual([{ ligne: 'P1', t: 5, attente_s: 15 }]);
  });

  it('écourte l’étape en cours pour le tram, puis reprend le cycle après l’étape interrompue', () => {
    const r = simuler([{ ligne: 'T1', t: 8 }], 60);
    expect(r.etapes.slice(0, 3).map((e) => [e.index, e.debut_s, e.fin_s])).toEqual([
      [0, 0, 8],
      [3, 13, 23],
      [2, 28, 48],
    ]);
    // Même tram pendant É3 : reprise sur É1, la suite de É3.
    const pendantE3 = simuler([{ ligne: 'T1', t: 30 }], 90);
    expect(pendantE3.etapes.slice(0, 4).map((e) => e.index)).toEqual([0, 2, 3, 0]);
  });

  it('suit un arc sans condition saisi à la sortie de l’étape hors cycle', () => {
    const r = simulerGraphe({ ...entree, arcs: [...arcs, { de: 3, vers: 1, demande: null, anticipe: false }], demandes: [{ ligne: 'T1', t: 8 }], duree_s: 60 });
    expect(r.etapes.slice(0, 3).map((e) => e.index)).toEqual([0, 3, 1]);
  });

  it('garde les événements de la simulation', () => {
    const r = simuler([{ ligne: 'T1', t: 8 }], 60);
    expect(r.evenements).toEqual([
      { t: 8, message: 'Demande T1 : É1 écourtée à 8 s' },
      { t: 8, message: 'Demande T1 : É1 → É4' },
      // Reprise après É1 : É2 n'a pas d'appel, on passe à É3.
      { t: 23, message: "É2 sautée : pas d'appel P1" },
    ]);
    expect(r.attentes).toEqual([{ ligne: 'T1', t: 8, attente_s: 5 }]);
  });

  it('respecte le vert minimal avant d’écourter une étape', () => {
    const r = simuler([{ ligne: 'T1', t: 1 }], 30);
    expect(r.etapes[0]).toMatchObject({ index: 0, fin_s: 6 });
  });

  it('ne simule pas un graphe en erreur', () => {
    const r = simulerGraphe({ ...entree, arcs: [{ de: 0, vers: 3, demande: 'F2', anticipe: false }], demandes: [], duree_s: 60 });
    expect(r.controles.some((c) => c.niveau === 'erreur')).toBe(true);
    expect(r.etapes).toEqual([]);
  });
});
