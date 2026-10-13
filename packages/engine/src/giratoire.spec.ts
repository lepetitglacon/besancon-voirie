import { describe, expect, it } from 'vitest';
import { cleVoie, mouvementsDepuisConnexions } from './connexions.js';
import { matriceConflits, type GeometrieCarrefour, type LigneConflits } from './conflits.js';
import { genererVoies, repereLocal, type LonLat, type Segment } from './geometrie.js';
import {
  azimutsVoiesGiratoire,
  branchesTroncons,
  codeNoeudLibre,
  distanceArretNoeud,
  geometrieAnneau,
  insererNoeud,
  liaisonsHorsNoeud,
  noeudDeVoie,
  normaliserNoeuds,
  proposerLiaisonsNoeuds,
  tronconsXY,
  type Anneau,
} from './giratoire.js';

// Giratoire de 15 m de rayon : un nœud au droit de chaque rue (N, E, S, O).
const centre: LonLat = [6.03, 47.25];
const repere = repereLocal(centre);
const point = (azimut: number, rayon: number): LonLat =>
  repere.versLonLat([rayon * Math.sin((azimut * Math.PI) / 180), rayon * Math.cos((azimut * Math.PI) / 180)]);
const RUES = [
  { code: 'N', azimut: 0 },
  { code: 'E', azimut: 90 },
  { code: 'S', azimut: 180 },
  { code: 'O', azimut: 270 },
];

let anneau: Anneau = { noeuds: [] };
for (const rue of RUES) anneau = insererNoeud(anneau, { code: codeNoeudLibre(anneau), position: point(rue.azimut, 15) });
const noeudDe = (rue: string) => String(RUES.findIndex((r) => r.code === rue) + 1);

const rues = RUES.map((r) => {
  const g = genererVoies(point(r.azimut, 15), r.azimut, 1, 1, distanceArretNoeud(1));
  return {
    code: r.code,
    azimut: r.azimut,
    noeud: noeudDe(r.code),
    troncon: false,
    voies: [
      { sens: 'entrante' as const, rang: 0, geom: g.entrantes[0]! },
      { sens: 'sortante' as const, rang: 0, geom: g.sortantes[0]! },
    ],
    passages: [g.traversee],
  };
});
const troncons = branchesTroncons(anneau);
const branches = [...rues, ...troncons];
const connexions = proposerLiaisonsNoeuds(branches, anneau);

function geometrie(extra: { branches?: typeof branches; connexions?: typeof connexions } = {}): GeometrieCarrefour {
  const toutes = [...branches, ...(extra.branches ?? [])];
  return {
    centre,
    voies: new Map(toutes.flatMap((b) => b.voies.map((v) => [cleVoie(b.code, v.sens, v.rang), v.geom as Segment] as const))),
    connexions: [...connexions, ...(extra.connexions ?? [])],
    traversees: new Map(),
    troncons: new Set(troncons.map((t) => t.code)),
  };
}
const ligne = (code: string, ...mouvements: string[]): LigneConflits => ({ code, type: 'vehicule', mouvements });
const nature = (lignes: LigneConflits[], a: string, b: string, g = geometrie()) =>
  matriceConflits(lignes, g).find((c) => [c.a, c.b].sort().join() === [a, b].sort().join())?.nature ?? null;
/** Tronçon qui arrive au nœud de la rue, et celui qui en repart. */
const arrivee = (rue: string) => troncons.find((t) => noeudDeVoie(`${t.code}:e0`, branches, anneau) === noeudDe(rue))!.code;
const depart = (rue: string) => `R${noeudDe(rue)}`;

describe('anneau par nœuds', () => {
  it('classe les premiers nœuds dans le sens de circulation, puis insère au plus court', () => {
    // Antihoraire vu du ciel : est, nord, ouest, sud (le point de départ du tour importe peu).
    const tour = anneau.noeuds.map((n) => RUES[Number(n.code) - 1]!.code)
      .join('');
    expect(`${tour}${tour}`).toContain('ENOS');
    const avecNordEst = insererNoeud(anneau, { code: '5', position: point(45, 15) }).noeuds.map((n) => n.code).join('');
    expect(`${avecNordEst}${avecNordEst}`).toContain('2514');
  });

  it('trace une courbe qui passe par les nœuds, proche du cercle entre eux', () => {
    const xy = anneau.noeuds.map((n) => repere.versXY(n.position));
    const traces = tronconsXY(xy);
    traces.forEach((trace, i) => {
      expect(trace[0]![0]).toBeCloseTo(xy[i]![0], 9);
      expect(trace.at(-1)![1]).toBeCloseTo(xy[(i + 1) % xy.length]![1], 9);
      // Quatre nœuds seulement : à mi-chemin, la courbe s'écarte du cercle d'un dixième du rayon.
      for (const [x, y] of trace) expect(Math.abs(Math.hypot(x, y) - 15)).toBeLessThan(2);
    });
  });

  it('met la voie de rang 0 d’un tronçon côté îlot', () => {
    const t = geometrieAnneau(anneau, new Map([['R2', 2]])).find((g) => g.code === 'R2');
    const distanceCentre = (p: LonLat) => Math.hypot(...repere.versXY(p));
    expect(distanceCentre(t!.sortantes[0]![0])).toBeLessThan(distanceCentre(t!.sortantes[1]![0]));
    expect(distanceCentre(t!.entrantes[0]![0])).toBeLessThan(distanceCentre(t!.entrantes[1]![0]));
  });

  it('situe chaque voie à son nœud et refuse une liaison entre deux nœuds', () => {
    expect(noeudDeVoie(`${depart('E')}:s0`, branches, anneau)).toBe(noeudDe('E'));
    expect(noeudDeVoie(`${arrivee('E')}:e0`, branches, anneau)).toBe(noeudDe('E'));
    expect(liaisonsHorsNoeud(branches, connexions, anneau)).toEqual([]);
    expect(liaisonsHorsNoeud(branches, [{ de: 'S:e0', vers: `${depart('E')}:s0` }], anneau)).toEqual([`S:e0>${depart('E')}:s0`]);
  });

  it('propose à chaque nœud : continuer, sortir, s’insérer', () => {
    expect(connexions).toHaveLength(RUES.length * 3);
    expect(connexions).toContainEqual({ de: `${arrivee('E')}:e0`, vers: `${depart('E')}:s0` });
    expect(connexions).toContainEqual({ de: `${arrivee('E')}:e0`, vers: 'E:s0' });
    expect(connexions).toContainEqual({ de: 'E:e0', vers: `${depart('E')}:s0` });
  });

  it('lit le sens des mouvements sur les voies : l’anneau continue tout droit, on entre et on sort à droite', () => {
    const mouvements = mouvementsDepuisConnexions(branches, connexions, azimutsVoiesGiratoire(branches, anneau));
    const direction = (o: string, d: string) => mouvements.find((m) => m.origine === o && m.destination === d)?.direction;
    expect(direction(arrivee('E'), depart('E'))).toBe('tout_droit');
    expect(direction(arrivee('E'), 'E')).toBe('droite');
    expect(direction('E', depart('E'))).toBe('droite');
  });
});

describe('conflits d’un giratoire par nœuds', () => {
  it('met en conflit d’insertion le feu d’anneau et l’entrée du même nœud, pas ceux d’autres nœuds', () => {
    const lignes = [ligne('A1', `${arrivee('E')}>${depart('E')}`), ligne('F1', `E>${depart('E')}`), ligne('F2', `S>${depart('S')}`)];
    expect(nature(lignes, 'A1', 'F1')).toBe('insertion');
    expect(nature(lignes, 'A1', 'F2')).toBeNull();
  });

  it('détecte le tram qui traverse l’îlot sur la liaison de l’anneau à son nœud', () => {
    // Tram nord-est ↔ sud-ouest, hors nœud, qui coupe l'anneau là où l'on a posé deux nœuds.
    let avecTram = anneau;
    avecTram = insererNoeud(avecTram, { code: '5', position: point(45, 15) });
    avecTram = insererNoeud(avecTram, { code: '6', position: point(225, 15) });
    const tronconsTram = branchesTroncons(avecTram);
    const tram = ['T', 'T2'].map((code, i) => {
      const g = genererVoies(centre, i === 0 ? 45 : 225, 1, 1, 22);
      return {
        code,
        azimut: i === 0 ? 45 : 225,
        noeud: null,
        troncon: false,
        voies: [
          { sens: 'entrante' as const, rang: 0, geom: g.entrantes[0]! },
          { sens: 'sortante' as const, rang: 0, geom: g.sortantes[0]! },
        ],
        passages: [g.traversee],
      };
    });
    const toutes = [...rues, ...tronconsTram, ...tram];
    const liaisons = [...proposerLiaisonsNoeuds(toutes, avecTram), { de: 'T:e0', vers: 'T2:s0' }];
    expect(liaisonsHorsNoeud(toutes, liaisons, avecTram)).toEqual([]);
    const g: GeometrieCarrefour = {
      centre,
      voies: new Map(toutes.flatMap((b) => b.voies.map((v) => [cleVoie(b.code, v.sens, v.rang), v.geom as Segment] as const))),
      connexions: liaisons,
      traversees: new Map(),
      troncons: new Set(tronconsTram.map((t) => t.code)),
    };
    // Au nœud 5 (nord-est), l'anneau arrive par le tronçon du nœud E et repart par R5.
    const anneauNordEst = ligne('A1', `${tronconsTram.find((t) => t.noeud === noeudDe('E'))!.code}>R5`);
    expect(nature([ligne('T1', 'T>T2'), anneauNordEst], 'T1', 'A1', g)).toBe('croisement');
  });
});

describe('nœuds proposés', () => {
  it('fusionne les nœuds proches, remet la boucle dans le sens de circulation et la complète jusqu’à quatre', () => {
    // Est, sud, ouest (sens horaire), plus un doublon de l'est à 2 m.
    const positions = [point(90, 15), point(180, 15), point(270, 15), point(95, 15)];
    const resultat = normaliserNoeuds(positions)!;
    expect(resultat.anneau.noeuds).toHaveLength(4);
    // Le doublon rejoint le nœud est.
    expect(resultat.codes[3]).toBe(resultat.codes[0]);
    // Sens antihoraire : après l'est vient le nord (le nœud ajouté), puis l'ouest, puis le sud.
    const code = (i: number) => Number(resultat.codes[i]);
    const n = resultat.anneau.noeuds.length;
    expect((code(2) - code(0) + n) % n).toBe(2);
    expect((code(1) - code(2) + n) % n).toBe(1);
  });

  it('renonce sous trois nœuds distincts', () => {
    expect(normaliserNoeuds([point(0, 15), point(2, 15), point(180, 15)])).toBeNull();
  });
});
