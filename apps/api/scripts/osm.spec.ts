import { trierElements, type ReponseOverpass } from './osm.js';

describe('trierElements', () => {
  const reponse: ReponseOverpass = {
    osm3s: { timestamp_osm_base: '2026-09-26T10:00:00Z' },
    elements: [
      {
        type: 'relation',
        id: 1,
        tags: { 'ref:INSEE': '25056', name: 'Besançon' },
        members: [
          { type: 'way', ref: 10, role: 'outer', geometry: [{ lat: 47.2, lon: 6 }, { lat: 47.3, lon: 6.1 }] },
          { type: 'node', ref: 11, role: 'admin_centre' },
        ],
      },
      { type: 'node', id: 2, lat: 47.25, lon: 6.03, tags: { highway: 'traffic_signals' } },
      { type: 'node', id: 2, lat: 47.25, lon: 6.03, tags: { highway: 'traffic_signals' } },
      { type: 'node', id: 3, lat: 47.25, lon: 6.03, tags: { crossing: 'traffic_signals' } },
      { type: 'node', id: 4, lat: 47.25, lon: 6.03, tags: { highway: 'stop' } },
      {
        type: 'way',
        id: 5,
        nodes: [2, 3],
        tags: { highway: 'primary', name: 'Avenue B' },
        geometry: [{ lat: 47.25, lon: 6.03 }, { lat: 47.26, lon: 6.03 }],
      },
      {
        type: 'way',
        id: 6,
        nodes: [7, 8],
        tags: { railway: 'tram' },
        geometry: [{ lat: 47.25, lon: 6.06 }, { lat: 47.26, lon: 6.06 }],
      },
    ],
  };

  it('should split the response by kind and drop duplicates', () => {
    const donnees = trierElements(reponse);
    expect(donnees.horodatage).toBe('2026-09-26T10:00:00Z');
    expect(donnees.commune?.contours).toHaveLength(1);
    expect(donnees.signaux.map((s) => s.id)).toEqual([2, 3]);
    expect(donnees.voies.map((v) => v.id)).toEqual([5]);
    expect(donnees.trams.map((t) => t.id)).toEqual([6]);
    expect(donnees.voies[0]!.coords[0]).toEqual([6.03, 47.25]);
  });

  it('should fail when the commune relation is missing', () => {
    expect(() => trierElements({ elements: reponse.elements.slice(1) })).toThrow(/INSEE 25056/);
  });
});
