import type { OverpassElement } from '../../scripts/osm.js';

// Jeu OSM synthétique : une commune carrée (6,00–6,10 E × 47,20–47,30 N), trois groupes de
// feux et un feu hors commune.
const noeud = (id: number, lon: number, lat: number, tags: Record<string, string>): OverpassElement => ({
  type: 'node',
  id,
  lon,
  lat,
  tags,
});
const voie = (id: number, tags: Record<string, string>, coords: Array<[number, number]>): OverpassElement => ({
  type: 'way',
  id,
  nodes: coords.map((_, i) => id * 100 + i),
  tags,
  geometry: coords.map(([lon, lat]) => ({ lon, lat })),
});

const FEU = { highway: 'traffic_signals' };
const FEU_PIETON = { highway: 'crossing', crossing: 'traffic_signals' };
const FEU_PIETON_SANS_HIGHWAY = { crossing: 'traffic_signals' };

export const COMMUNE: OverpassElement = {
  type: 'relation',
  id: 1,
  tags: { 'ref:INSEE': '25056', name: 'Besançon' },
  members: [
    { type: 'way', ref: 10, role: 'outer', geometry: [{ lon: 6, lat: 47.2 }, { lon: 6.1, lat: 47.2 }, { lon: 6.1, lat: 47.3 }] },
    { type: 'way', ref: 11, role: 'outer', geometry: [{ lon: 6.1, lat: 47.3 }, { lon: 6, lat: 47.3 }, { lon: 6, lat: 47.2 }] },
  ],
};

/** Feux du carrefour A (trois véhicules, deux piétons dont un sans balise highway). */
export const FEUX_A = [101, 102, 103, 104, 105];
export const FEUX_B = [201];
export const FEUX_TRAVERSEE_C = [301, 302];

export const ELEMENTS_OSM: OverpassElement[] = [
  COMMUNE,
  noeud(101, 6.0302, 47.25, FEU),
  noeud(102, 6.0298, 47.25, FEU),
  noeud(103, 6.03, 47.2502, FEU),
  noeud(104, 6.03, 47.2498, FEU_PIETON),
  noeud(105, 6.0303, 47.2503, FEU_PIETON_SANS_HIGHWAY),
  voie(1001, { highway: 'residential', name: 'Rue A' }, [[6.028, 47.25], [6.032, 47.25]]),
  // Tracée du sud vers le nord : les flèches « forward » concernent l'arrivée par le sud.
  voie(
    1002,
    { highway: 'primary', name: 'Avenue B', lanes: '3', 'lanes:forward': '2', 'turn:lanes:forward': 'left|through;right' },
    [[6.03, 47.248], [6.03, 47.252]],
  ),
  // B : deux graphies de la même avenue et une voie de tram
  noeud(201, 6.06, 47.25, FEU),
  voie(2001, { highway: 'secondary', name: 'Avenue du Maréchal Foch' }, [[6.058, 47.25], [6.06, 47.25]]),
  voie(2002, { highway: 'secondary', name: 'Avenue Maréchal Foch' }, [[6.06, 47.25], [6.062, 47.25]]),
  voie(2003, { railway: 'tram' }, [[6.0601, 47.249], [6.0601, 47.251]]),
  // C : traversée piétonne isolée
  noeud(301, 6.08, 47.27, FEU_PIETON),
  noeud(302, 6.08005, 47.27, FEU_PIETON_SANS_HIGHWAY),
  voie(3001, { highway: 'tertiary', name: 'Rue C' }, [[6.079, 47.27], [6.081, 47.27]]),
  // Hors commune : ignoré
  noeud(401, 6.2, 47.25, FEU),
];
