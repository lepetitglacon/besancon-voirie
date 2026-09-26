import { describe, expect, it } from 'vitest';
import { cleVoie, type Connexion } from './connexions.js';
import {
  lireCleMouvement,
  matriceConflits,
  mouvementsNonCommandes,
  proposerLignes,
  type GeometrieCarrefour,
  type LigneConflits,
} from './conflits.js';
import { genererVoies, type LonLat, type Segment } from './geometrie.js';

// Carrefour en croix, une voie entrante et une sortante par branche, circulation à droite.
const centre: LonLat = [6.03, 47.25];
const branches = [
  { code: 'N', azimut: 0 },
  { code: 'E', azimut: 90 },
  { code: 'S', azimut: 180 },
  { code: 'O', azimut: 270 },
];
const voies = new Map<string, Segment>();
const traversees = new Map<string, Segment>();
for (const b of branches) {
  const g = genererVoies(centre, b.azimut, 1, 1);
  voies.set(cleVoie(b.code, 'entrante', 0), g.entrantes[0]!);
  voies.set(cleVoie(b.code, 'sortante', 0), g.sortantes[0]!);
  traversees.set(b.code, g.traversee);
}
// Toutes les connexions possibles (sans demi-tour).
const connexions: Connexion[] = branches.flatMap((o) =>
  branches.filter((d) => d.code !== o.code).map((d) => ({ de: `${o.code}:e0`, vers: `${d.code}:s0` })),
);
const geometrie: GeometrieCarrefour = { centre, voies, connexions, traversees };

const vehicules = (code: string, ...mouvements: string[]): LigneConflits => ({ code, type: 'vehicule', mouvements });
const conflit = (a: string, b: string) =>
  matriceConflits([vehicules('A', a), vehicules('B', b)], geometrie)[0]?.nature ?? null;

describe('conflits entre trajectoires', () => {
  it('laisse passer les tout-droit opposés et les tourne-à-gauche opposés', () => {
    expect(conflit('S>N', 'N>S')).toBeNull();
    expect(conflit('S>O', 'N>E')).toBeNull();
  });

  it('détecte le tourne-à-gauche qui coupe le tout-droit d’en face, et les tout-droit perpendiculaires', () => {
    expect(conflit('S>O', 'N>S')).toBe('croisement');
    expect(conflit('S>N', 'E>O')).toBe('croisement');
  });

  it('détecte deux trajectoires qui visent la même voie de sortie', () => {
    expect(conflit('S>E', 'N>E')).toBe('convergence');
  });

  it('laisse le tourne-à-droite libre face au tout-droit d’en face', () => {
    expect(conflit('S>E', 'N>S')).toBeNull();
  });

  it('ignore deux trajectoires issues de la même voie', () => {
    expect(conflit('S>N', 'S>O')).toBeNull();
  });
});

describe('matriceConflits', () => {
  const lignes: LigneConflits[] = [
    vehicules('F1', 'S>N', 'S>E'),
    vehicules('F2', 'N>S', 'N>O'),
    vehicules('F3', 'E>O', 'E>N'),
    { code: 'P1', type: 'pieton', mouvements: [], traverse: 'E' },
    { code: 'P2', type: 'pieton', mouvements: [], traverse: 'N' },
  ];

  it('calcule les conflits paire par paire, piétons compris', () => {
    const resume = matriceConflits(lignes, geometrie).map((c) => `${c.a}-${c.b}:${c.nature}`);
    expect(resume).toEqual([
      'F1-F3:croisement',
      'F1-P1:pieton', // le tourne-à-droite S>E coupe le passage piéton est
      'F1-P2:pieton', // le tout droit S>N coupe le passage piéton nord
      'F2-F3:croisement',
      'F2-P2:pieton',
      'F3-P1:pieton',
      'F3-P2:pieton',
    ]);
  });

  it('marque les conflits admis à la main', () => {
    const conflits = matriceConflits(lignes, geometrie, [['P1', 'F1']]);
    expect(conflits.find((c) => c.a === 'F1' && c.b === 'P1')).toMatchObject({
      admis: true,
      cause: ['S:e0>E:s0', 'traversée E'],
    });
  });

  it('liste les mouvements qu’aucune ligne ne commande', () => {
    expect(mouvementsNonCommandes([lireCleMouvement('S>N')!, lireCleMouvement('O>E')!], lignes)).toEqual(['O>E']);
  });
});

describe('proposerLignes', () => {
  it('propose une ligne par branche d’arrivée', () => {
    const m = (cle: string) => lireCleMouvement(cle)!;
    expect(proposerLignes([m('S>N'), m('S>E'), m('N>S'), m('S>O')])).toEqual([
      { code: 'F1', mouvements: ['S>N', 'S>E', 'S>O'] },
      { code: 'F2', mouvements: ['N>S'] },
    ]);
  });
});
