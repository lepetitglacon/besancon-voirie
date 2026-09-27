import { describe, expect, it } from 'vitest';
import { decouperVoies, traverseePieton, vitesseOsm, voiesParSens, type VoieOsm } from './osm.js';

const voie = (osm_id: number, nodes: number[], tags: Record<string, string> = {}): VoieOsm => ({
  osm_id,
  tags: { highway: 'residential', ...tags },
  nodes,
  coords: nodes.map((n) => [6 + n / 1000, 47]),
});

describe('réseau depuis OSM', () => {
  it('coupe les voies aux nœuds partagés', () => {
    // 1-2-3-4 croise 10-3-11 au nœud 3.
    const { noeuds, troncons } = decouperVoies([voie(1, [1, 2, 3, 4], { name: 'Rue A' }), voie(2, [10, 3, 11])]);
    expect(troncons.map((t) => [t.osm_way_id, t.de, t.vers, t.points.length])).toEqual([
      [1, 1, 3, 3],
      [1, 3, 4, 2],
      [2, 10, 3, 2],
      [2, 3, 11, 2],
    ]);
    expect([...noeuds.keys()].sort((a, b) => a - b)).toEqual([1, 3, 4, 10, 11]);
    expect(troncons[0]!.nom).toBe('Rue A');
  });

  it('coupe une boucle au nœud où elle se referme', () => {
    const { troncons } = decouperVoies([voie(1, [1, 2, 3, 1]), voie(2, [1, 9])]);
    expect(troncons.map((t) => [t.de, t.vers])).toEqual([
      [1, 2],
      [2, 1],
      [1, 9],
    ]);
  });

  it('coupe aussi les voies aux feux et aux passages piétons', () => {
    const { troncons } = decouperVoies([voie(1, [1, 2, 3, 4, 5])], new Set([2, 4]));
    expect(troncons.map((t) => [t.de, t.vers])).toEqual([
      [1, 2],
      [2, 4],
      [4, 5],
    ]);
    expect(troncons[0]!.tags.highway).toBe('residential');
  });

  it('compte les voies par sens', () => {
    const sans = { types_avant: null, types_arriere: null };
    expect(voiesParSens({ highway: 'primary', lanes: '4' })).toEqual({ avant: 2, arriere: 2, ...sans });
    expect(voiesParSens({ highway: 'primary', lanes: '2', oneway: 'yes' })).toEqual({ avant: 2, arriere: 0, ...sans });
    expect(voiesParSens({ highway: 'primary', oneway: '-1' })).toEqual({ avant: 0, arriere: 1, ...sans });
    expect(voiesParSens({ highway: 'primary', 'lanes:forward': '2', 'lanes:backward': '1', lanes: '3' })).toEqual({ avant: 2, arriere: 1, ...sans });
    expect(voiesParSens({ highway: 'residential', junction: 'roundabout' })).toEqual({ avant: 1, arriere: 0, ...sans });
  });

  it('ajoute les voies vélo le long de la chaussée, à droite de leur sens', () => {
    // Double sens, bandes cyclables des deux côtés : la dernière voie de chaque sens.
    expect(voiesParSens({ highway: 'secondary', lanes: '2', cycleway: 'lane' })).toEqual({
      avant: 2,
      arriere: 2,
      types_avant: ['generale', 'velo'],
      types_arriere: ['generale', 'velo'],
    });
    expect(voiesParSens({ highway: 'secondary', lanes: '2', 'cycleway:right': 'track' })).toMatchObject({ types_avant: ['generale', 'velo'], types_arriere: null });
    // Sens unique avec contresens cyclable.
    expect(voiesParSens({ highway: 'residential', oneway: 'yes', cycleway: 'opposite_lane' })).toEqual({
      avant: 1,
      arriere: 1,
      types_avant: null,
      types_arriere: ['velo'],
    });
    // Sens unique, bande à gauche du conducteur : la première voie.
    expect(voiesParSens({ highway: 'residential', oneway: 'yes', lanes: '2', 'cycleway:left': 'lane' })).toMatchObject({
      types_avant: ['velo', 'generale', 'generale'],
    });
  });

  it('donne une ou deux voies vélo à une piste cyclable, et des voies bus à un site propre', () => {
    expect(voiesParSens({ highway: 'cycleway' })).toEqual({ avant: 1, arriere: 1, types_avant: ['velo'], types_arriere: ['velo'] });
    expect(voiesParSens({ highway: 'cycleway', oneway: 'yes' })).toEqual({ avant: 1, arriere: 0, types_avant: ['velo'], types_arriere: null });
    expect(voiesParSens({ highway: 'path', bicycle: 'designated', 'oneway:bicycle': '-1' })).toMatchObject({ avant: 0, arriere: 1 });
    expect(voiesParSens({ highway: 'busway', oneway: 'yes' })).toMatchObject({ types_avant: ['bus'] });
  });

  it('lit le type de passage piéton', () => {
    expect(traverseePieton({ highway: 'crossing', crossing: 'traffic_signals' })).toBe('feux');
    expect(traverseePieton({ highway: 'crossing', crossing: 'unmarked' })).toBe('non_marquee');
    expect(traverseePieton({ highway: 'crossing', crossing: 'zebra' })).toBe('marquee');
  });

  it('lit maxspeed', () => {
    expect(vitesseOsm({ maxspeed: '30' })).toBe(30);
    expect(vitesseOsm({ maxspeed: '20 mph' })).toBe(32);
    expect(vitesseOsm({ maxspeed: 'FR:urban' })).toBeNull();
    expect(vitesseOsm({})).toBeNull();
  });
});
