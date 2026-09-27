import { describe, expect, it } from 'vitest';
import { cleVoie, type Connexion } from './connexions.js';
import type { GeometrieCarrefour, LigneConflits } from './conflits.js';
import { cleDegagement, degagementsCalcules } from './degagement.js';
import { genererVoies, type LonLat, type Segment } from './geometrie.js';
import {
  calculerProgramme,
  dureesDeVert,
  etapesDepuisDiagramme,
  etatLigne,
  proposerEtapes,
  type EntreeProgramme,
  type LigneProgramme,
} from './programme.js';

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
const connexions: Connexion[] = branches.flatMap((o) =>
  branches.filter((d) => d.code !== o.code).map((d) => ({ de: `${o.code}:e0`, vers: `${d.code}:s0` })),
);
const geometrie: GeometrieCarrefour = { centre, voies, connexions, traversees };

// Axe nord-sud (F1), axe est-ouest (F2), piétons qui traversent les branches E et O (P1),
// compatibles avec F1 hors tourne-à-droite et tourne-à-gauche.
const lignesConflits: LigneConflits[] = [
  { code: 'F1', type: 'vehicule', mouvements: ['N>S', 'S>N'] },
  { code: 'F2', type: 'vehicule', mouvements: ['E>O', 'O>E'] },
  { code: 'P1', type: 'pieton', mouvements: [], traverse: 'E' },
];

describe('rouges de dégagement', () => {
  const degagements = degagementsCalcules(lignesConflits, geometrie);
  const rouge = (de: string, vers: string) => degagements.find((d) => d.de === de && d.vers === vers)?.rouge_s;

  it('calcule les deux sens de chaque conflit, et rien pour les lignes compatibles', () => {
    expect(degagements.map((d) => cleDegagement(d.de, d.vers)).sort()).toEqual(['F1>F2', 'F2>F1', 'F2>P1', 'P1>F2']);
  });

  it('applique la formule (d_sortant + longueur) / v − d_entrant / v', () => {
    const d = degagements.find((x) => x.de === 'F1' && x.vers === 'F2')!;
    const attendu = Math.ceil((d.distances!.sortant + 6) / 10 - d.distances!.entrant / 10);
    expect(d.rouge_s).toBe(Math.max(0, attendu));
  });

  it('laisse plus de temps au piéton qui dégage qu’au véhicule qui le précède', () => {
    // Traversée d'environ 9,5 m à 1 m/s contre un véhicule à 10 m/s.
    expect(rouge('P1', 'F2')).toBeGreaterThanOrEqual(5);
    expect(rouge('F2', 'P1')).toBeLessThan(rouge('P1', 'F2')!);
  });

  it('ignore un conflit admis', () => {
    expect(degagementsCalcules(lignesConflits, geometrie, [['F1', 'F2']]).some((d) => d.de === 'F1' && d.vers === 'F2')).toBe(false);
  });
});

const lignes: LigneProgramme[] = [
  { code: 'F1', type: 'vehicule' },
  { code: 'F2', type: 'vehicule' },
  { code: 'P1', type: 'pieton' },
];
const conflits: Array<[string, string]> = [
  ['F1', 'F2'],
  ['F2', 'P1'],
];
const entree = (surcharge: Partial<EntreeProgramme> = {}): EntreeProgramme => ({
  lignes,
  etapes: [
    { lignes: ['F1', 'P1'], duree_s: 30 },
    { lignes: ['F2'], duree_s: 20 },
  ],
  jaune_s: 3,
  conflits,
  degagements: new Map([
    ['F1>F2', 2],
    ['F2>F1', 2],
    ['P1>F2', 8],
    ['F2>P1', 1],
  ]),
  ...surcharge,
});

describe('calcul du programme par étapes', () => {
  it('insère jaune et rouge de dégagement entre les étapes, fixés par le couple le plus exigeant', () => {
    const r = calculerProgramme(entree());
    // Étape 1 → 2 : F2 attend max(jaune F1 3 + 2, piéton 0 + 8) = 8 s. Étape 2 → 1 : F1 attend 3 + 2, P1 attend 3 + 1.
    expect(r.transitions.map((t) => t.duree_s)).toEqual([8, 5]);
    expect(r.transitions[0]!.contrainte).toMatchObject({ de: 'P1', vers: 'F2' });
    expect(r.transitions[1]!.demarrages).toEqual({ F1: 5, P1: 4 });
    expect(r.cycle_s).toBe(30 + 8 + 20 + 5);
    expect(r.controles).toEqual([]);
  });

  it('produit le diagramme de feux, avec les démarrages anticipés recollés sur le début du cycle', () => {
    const r = calculerProgramme(entree());
    expect(r.verts.F1).toEqual([[0, 30]]);
    expect(r.verts.F2).toEqual([[38, 58]]);
    // P1 démarre 1 s avant F1, pendant la transition 2 → 1.
    expect(r.verts.P1).toEqual([
      [0, 30],
      [62, 63],
    ]);
    expect(r.jaunes.F1).toEqual([[30, 33]]);
    expect(r.jaunes.F2).toEqual([[58, 61]]);
    expect(r.jaunes.P1).toEqual([]);
    expect(dureesDeVert(r.verts.P1!, r.cycle_s)).toEqual([31]);
    expect(etatLigne(r, 'F1', 31)).toBe('jaune');
    expect(etatLigne(r, 'F2', 40)).toBe('vert');
    expect(etatLigne(r, 'P1', 62.5)).toBe('vert');
    expect(etatLigne(r, 'F1', 62.5)).toBe('rouge');
  });

  it('garde au vert une ligne présente dans deux étapes de suite', () => {
    const r = calculerProgramme(
      entree({
        etapes: [
          { lignes: ['F1', 'P1'], duree_s: 20 },
          { lignes: ['F1'], duree_s: 10 },
          { lignes: ['F2'], duree_s: 20 },
        ],
      }),
    );
    // P1 s'arrête sans que personne ne l'attende : transition 1 → 2 nulle.
    expect(r.transitions[0]!.duree_s).toBe(0);
    expect(dureesDeVert(r.verts.F1!, r.cycle_s)).toEqual([30]);
  });

  it('refuse deux lignes en conflit dans la même étape et signale les verts trop courts', () => {
    const r = calculerProgramme(
      entree({
        etapes: [
          { lignes: ['F1', 'F2'], duree_s: 4 },
          { lignes: ['P1'], duree_s: 20 },
        ],
        longueursTraversees: new Map([['P1', 30]]),
      }),
    );
    expect(r.controles.filter((c) => c.niveau === 'erreur').map((c) => c.message)).toEqual(['Étape 1 : F1 et F2 sont en conflit']);
    const avertissements = r.controles.filter((c) => c.niveau === 'avertissement').map((c) => c.message);
    expect(avertissements.some((m) => m.startsWith('Étape 1 : 4 s'))).toBe(true);
    expect(avertissements.some((m) => m.startsWith('P1 : vert piéton'))).toBe(true);
  });

  it('signale une ligne jamais au vert et un cycle trop long', () => {
    const r = calculerProgramme(entree({ etapes: [{ lignes: ['F1'], duree_s: 130 }] }));
    const messages = r.controles.map((c) => c.message);
    expect(messages).toContain("F2 n'est jamais au vert");
    expect(messages.some((m) => m.startsWith('Cycle de 130 s'))).toBe(true);
    expect(r.verts.F1).toEqual([[0, 130]]);
  });
});

describe('proposition et reconstruction des étapes', () => {
  it('propose des étapes qui servent chaque ligne sans conflit', () => {
    expect(proposerEtapes(lignes, conflits)).toEqual([
      { lignes: ['F1', 'P1'], duree_s: 20 },
      { lignes: ['F2'], duree_s: 20 },
    ]);
  });

  it('retrouve les étapes et leurs durées à partir du diagramme de feux', () => {
    const r = calculerProgramme(entree());
    expect(etapesDepuisDiagramme(r.verts, r.cycle_s)).toEqual([
      { lignes: ['F1', 'P1'], duree_s: 30 },
      { lignes: ['F2'], duree_s: 20 },
    ]);
  });
});
