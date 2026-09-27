import { describe, expect, it } from 'vitest';
import { cleVoie, type Connexion } from './connexions.js';
import { feuxAnneau, matriceConflits, trajectoiresDesLignes, type GeometrieCarrefour, type LigneConflits } from './conflits.js';
import { degagementsCalcules } from './degagement.js';
import { genererVoies, repereLocal, type LonLat, type Segment } from './geometrie.js';
import {
  courbeTrajet,
  distanceArretGiratoire,
  parcours,
  rayonCirculation,
  trajetGiratoire,
  traverseIlot,
  type Anneau,
} from './giratoire.js';

// Giratoire à quatre branches, une voie par sens, anneau d'une voie de 15 m de rayon extérieur.
const centre: LonLat = [6.03, 47.25];
const anneau: Anneau = { centre, rayon_m: 15, voies: 1 };
const branches = [
  { code: 'N', azimut: 0 },
  { code: 'E', azimut: 90 },
  { code: 'S', azimut: 180 },
  { code: 'O', azimut: 270 },
];
const voies = new Map<string, Segment>();
const traversees = new Map<string, Segment>();
for (const b of branches) {
  const g = genererVoies(centre, b.azimut, 1, 1, distanceArretGiratoire(anneau));
  voies.set(cleVoie(b.code, 'entrante', 0), g.entrantes[0]!);
  voies.set(cleVoie(b.code, 'sortante', 0), g.sortantes[0]!);
  traversees.set(b.code, g.traversee);
}
// Toutes les connexions, demi-tours compris : on peut faire le tour de l'anneau.
const connexions: Connexion[] = branches.flatMap((o) => branches.map((d) => ({ de: `${o.code}:e0`, vers: `${d.code}:s0` })));
const geometrie: GeometrieCarrefour = { centre, voies, connexions, traversees, anneau };

const vehicules = (code: string, ...mouvements: string[]): LigneConflits => ({ code, type: 'vehicule', mouvements });
const feuAnneau = (code: string, branche: string): LigneConflits => ({ code, type: 'vehicule', mouvements: [], anneau: branche });
const nature = (lignes: LigneConflits[], a: string, b: string, g = geometrie) =>
  matriceConflits(lignes, g).find((c) => (c.a === a && c.b === b) || (c.a === b && c.b === a))?.nature ?? null;
const conflit = (a: string, b: string) => nature([vehicules('A', a), vehicules('B', b)], 'A', 'B');

describe('trajets par l’anneau', () => {
  const repere = repereLocal(centre);
  const trajet = (de: string, vers: string) => trajetGiratoire(voies.get(`${de}:e0`)!, voies.get(`${vers}:s0`)!, anneau, repere);

  it('tourne dans le sens antihoraire : première sortie à droite, demi-tour presque complet', () => {
    const longueurs = ['E', 'N', 'O', 'S'].map((vers) => trajet('S', vers).longueur);
    expect(longueurs).toEqual([...longueurs].sort((a, b) => a - b));
    expect(longueurs[0]).toBeGreaterThan(45);
    expect(longueurs[0]).toBeLessThan(90);
    expect(longueurs[3]).toBeGreaterThan(300);
  });

  it('suit le milieu de la chaussée annulaire entre les raccords', () => {
    const t = trajet('S', 'N');
    const centreXY = repere.versXY(centre);
    const arc = courbeTrajet(t, 10, t.longueur - 10);
    for (const [x, y] of arc) expect(Math.hypot(x - centreXY[0], y - centreXY[1])).toBeCloseTo(rayonCirculation(anneau), 6);
    // Le raccord d'entrée part du bout de la voie entrante.
    const [x0, y0] = courbeTrajet(t)[0]!;
    const bout = repere.versXY(voies.get('S:e0')![0]);
    expect(Math.hypot(x0 - bout[0], y0 - bout[1])).toBeLessThan(1e-9);
  });

  it('fait traverser l’îlot au tram et au bus en site propre seulement', () => {
    expect(traverseIlot('tram', 'tram')).toBe(true);
    expect(traverseIlot('bus', 'bus')).toBe(true);
    expect(traverseIlot('bus', 'generale')).toBe(false);
    expect(traverseIlot('generale', 'generale')).toBe(false);
  });
});

describe('conflits dans un giratoire sans feux d’anneau', () => {
  it('détecte l’insertion d’une entrée devant la circulation qui passe', () => {
    // S vers O passe devant l'entrée E, puis devant N.
    expect(conflit('S>O', 'E>N')).toBe('insertion');
    expect(conflit('S>O', 'N>E')).toBe('insertion');
  });

  it('laisse libre une trajectoire qui sort avant l’entrée suivante', () => {
    expect(conflit('S>E', 'E>N')).toBeNull();
    expect(conflit('S>E', 'N>O')).toBeNull();
  });

  it('garde la convergence pour deux trajectoires vers la même sortie', () => {
    expect(conflit('S>N', 'E>N')).toBe('convergence');
  });
});

describe('feux d’anneau', () => {
  it('place le feu d’anneau entre la sortie et l’entrée de la branche', () => {
    const azimut = feuxAnneau(geometrie, ['E']).get('E')!;
    const repere = repereLocal(centre);
    const versE = trajetGiratoire(voies.get('S:e0')!, voies.get('E:s0')!, anneau, repere);
    const depuisE = trajetGiratoire(voies.get('E:e0')!, voies.get('N:s0')!, anneau, repere);
    const sortieE = versE.debut - versE.longueur;
    // Dans le sens de circulation : on quitte l'anneau vers E, puis le feu, puis l'entrée de E s'insère.
    expect(parcours(sortieE, azimut)).toBeGreaterThan(0);
    expect(parcours(sortieE, azimut)).toBeLessThan(parcours(sortieE, depuisE.debut));
  });

  it('met en conflit le feu d’anneau et l’entrée qu’il protège, pas la circulation qu’il arrête', () => {
    const lignes = [feuAnneau('FA', 'E'), vehicules('FE', 'E>N', 'E>O', 'E>S'), vehicules('FS', 'S>N', 'S>O', 'S>E')];
    expect(nature(lignes, 'FA', 'FE')).toBe('insertion');
    // S vers N ou O s'arrête au feu d'anneau de E : plus de conflit avec l'entrée E.
    expect(nature(lignes, 'FS', 'FE')).toBeNull();
    expect(nature(lignes, 'FS', 'FA')).toBeNull();
  });

  it('coupe les trajectoires au feu d’anneau et fait repartir celles du feu jusqu’à leur sortie', () => {
    const lignes = [feuAnneau('FA', 'E'), vehicules('FS', 'S>N')];
    const parLigne = trajectoiresDesLignes(lignes, geometrie);
    expect(parLigne.get('FS')!.map((t) => t.vers)).toEqual(['anneau:E']);
    const duFeu = parLigne.get('FA')!;
    expect(new Set(duFeu.map((t) => t.de))).toEqual(new Set(['anneau:E']));
    // Devant le feu passent les trajets qui vont au-delà de E : vers N, O et S. Un demi-tour depuis E
    // ressort avant de repasser devant le feu.
    expect(new Set(duFeu.map((t) => t.vers))).toEqual(new Set(['N:s0', 'O:s0', 'S:s0']));
  });

  it('calcule un rouge de dégagement depuis la ligne d’arrêt sur l’anneau', () => {
    const lignes = [feuAnneau('FA', 'E'), vehicules('FE', 'E>N')];
    const degagements = degagementsCalcules(lignes, geometrie);
    const faVersFe = degagements.find((d) => d.de === 'FA' && d.vers === 'FE')!;
    expect(faVersFe.distances).toBeDefined();
    // Le feu d'anneau est à 3 m en amont de l'insertion ; l'entrant a son raccord à parcourir.
    expect(faVersFe.distances!.sortant).toBeCloseTo(3, 0);
    expect(faVersFe.distances!.entrant).toBeGreaterThan(3);
  });
});

describe('tram qui traverse l’îlot', () => {
  // Tram nord-est ↔ sud-ouest, à travers l'îlot, sur deux branches dédiées.
  const voiesTram = new Map(voies);
  const types = new Map<string, string>();
  for (const [code, azimut] of [
    ['T', 45],
    ['T2', 225],
  ] as const) {
    const g = genererVoies(centre, azimut, 1, 1, distanceArretGiratoire(anneau));
    voiesTram.set(`${code}:e0`, g.entrantes[0]!);
    voiesTram.set(`${code}:s0`, g.sortantes[0]!);
    types.set(`${code}:e0`, 'tram').set(`${code}:s0`, 'tram');
  }
  const avecTram: GeometrieCarrefour = {
    ...geometrie,
    voies: voiesTram,
    typesVoies: types,
    connexions: [...connexions, { de: 'T:e0', vers: 'T2:s0' }, { de: 'T2:e0', vers: 'T:s0' }],
  };
  const tram: LigneConflits = { code: 'T1', type: 'vehicule', mouvements: ['T>T2', 'T2>T'] };

  it('croise la circulation de l’anneau', () => {
    expect(nature([tram, vehicules('FS', 'S>N')], 'T1', 'FS', avecTram)).toBe('croisement');
  });

  it('est protégé par les feux d’anneau placés avant ses deux traversées', () => {
    const lignes = [tram, feuAnneau('FA', 'T'), feuAnneau('FB', 'T2'), vehicules('FS', 'S>N')];
    expect(nature(lignes, 'T1', 'FA', avecTram)).toBe('croisement');
    expect(nature(lignes, 'T1', 'FB', avecTram)).toBe('croisement');
    // S vers N s'arrête au feu d'anneau avant la traversée nord-est.
    expect(nature(lignes, 'T1', 'FS', avecTram)).toBeNull();
  });
});

describe('carrefour ordinaire', () => {
  it('garde les trajectoires d’une connexion à l’autre sans anneau', () => {
    const sansAnneau: GeometrieCarrefour = { ...geometrie, anneau: null };
    const parLigne = trajectoiresDesLignes([vehicules('A', 'S>N')], sansAnneau);
    expect(parLigne.get('A')!.map((t) => t.cle)).toEqual(['S:e0>N:s0']);
    expect(parLigne.get('A')![0]!.anneau).toBeUndefined();
  });
});
