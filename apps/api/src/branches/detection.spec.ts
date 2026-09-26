import { brancheDepuisPassage, proposerBranches, type Passage } from './detection.js';

const passage = (azimut: number, tags: Record<string, string>, vientDeLInterieur: boolean, osmId = 1): Passage => ({
  osmId,
  tags,
  azimut,
  lon: 6 + azimut / 1000,
  lat: 47,
  vientDeLInterieur,
});

describe('brancheDepuisPassage', () => {
  it('should read forward turn lanes on an approach drawn towards the junction', () => {
    const b = brancheDepuisPassage(
      passage(180, { highway: 'primary', lanes: '3', 'lanes:forward': '2', 'turn:lanes:forward': 'left|through;right' }, false),
    );
    expect(b).toMatchObject({
      entrant: true,
      sortant: true,
      voiesEntrantes: [['gauche'], ['tout_droit', 'droite']],
      voiesSortantes: 1,
      source: 'osm',
    });
  });

  it('should use backward lanes when the way is drawn away from the junction', () => {
    const b = brancheDepuisPassage(passage(0, { highway: 'primary', 'lanes:backward': '2' }, true));
    expect(b.voiesEntrantes).toEqual([['gauche', 'tout_droit'], ['tout_droit', 'droite']]);
    expect(b.source).toBe('defaut');
  });

  it('should respect oneway ways', () => {
    expect(brancheDepuisPassage(passage(90, { highway: 'secondary', oneway: 'yes' }, true))).toMatchObject({
      entrant: false,
      sortant: true,
      voiesEntrantes: [],
    });
    expect(brancheDepuisPassage(passage(90, { highway: 'secondary', oneway: '-1' }, true))).toMatchObject({
      entrant: true,
      sortant: false,
    });
  });
});

describe('proposerBranches', () => {
  it('should merge the two carriageways of a boulevard and name branches by compass point', () => {
    const { branches, sources } = proposerBranches(
      [
        passage(85, { highway: 'primary', oneway: 'yes', name: 'Boulevard Léon Blum', lanes: '2' }, false, 10),
        passage(95, { highway: 'primary', oneway: 'yes', name: 'Boulevard Léon Blum', lanes: '2' }, true, 11),
        passage(270, { highway: 'residential', name: 'Rue A' }, false, 12),
      ],
      [6, 47],
    );
    expect(branches.map((b) => [b.code, b.nom, b.fleches.length, b.sortantes])).toEqual([
      ['E', 'Boulevard Léon Blum', 2, 2],
      ['O', 'Rue A', 1, 1],
    ]);
    expect(branches[0]!.azimut).toBe(90);
    expect(branches[0]!.geom![0]).toEqual([6, 47]);
    expect(sources).toEqual({ E: 'defaut', O: 'defaut' });
  });
});
