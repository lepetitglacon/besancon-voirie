import { describe, expect, it } from 'vitest';
import { decouperVoies, vitesseOsm, voiesParSens, type VoieOsm } from './osm.js';

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

  it('compte les voies par sens', () => {
    expect(voiesParSens({ highway: 'primary', lanes: '4' })).toEqual({ avant: 2, arriere: 2 });
    expect(voiesParSens({ highway: 'primary', lanes: '2', oneway: 'yes' })).toEqual({ avant: 2, arriere: 0 });
    expect(voiesParSens({ highway: 'primary', oneway: '-1' })).toEqual({ avant: 0, arriere: 1 });
    expect(voiesParSens({ highway: 'primary', 'lanes:forward': '2', 'lanes:backward': '1', lanes: '3' })).toEqual({ avant: 2, arriere: 1 });
    expect(voiesParSens({ highway: 'residential', junction: 'roundabout' })).toEqual({ avant: 1, arriere: 0 });
  });

  it('lit maxspeed', () => {
    expect(vitesseOsm({ maxspeed: '30' })).toBe(30);
    expect(vitesseOsm({ maxspeed: '20 mph' })).toBe(32);
    expect(vitesseOsm({ maxspeed: 'FR:urban' })).toBeNull();
    expect(vitesseOsm({})).toBeNull();
  });
});
