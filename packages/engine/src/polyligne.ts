/** Coordonnées WGS84 : longitude, latitude. */
export type Coordonnees = [number, number];

/** Polyligne avec ses distances cumulées, en mètres depuis le premier point. */
export interface Polyligne {
  coordonnees: Coordonnees[];
  cumul: number[];
  longueur: number;
}

const RAYON_TERRE = 6_371_008.8;
const RADIANS = Math.PI / 180;

/**
 * Distance en mètres entre deux points, par projection équirectangulaire.
 * Largement assez précis à l'échelle d'une ville (écart < 0,1 % sur quelques kilomètres).
 */
export function distanceMetres([lonA, latA]: Coordonnees, [lonB, latB]: Coordonnees): number {
  const x = (lonB - lonA) * RADIANS * Math.cos(((latA + latB) / 2) * RADIANS);
  const y = (latB - latA) * RADIANS;
  return Math.hypot(x, y) * RAYON_TERRE;
}

export function preparerPolyligne(coordonnees: Coordonnees[]): Polyligne {
  if (coordonnees.length < 2) throw new RangeError('Une polyligne demande au moins deux points');
  const cumul = [0];
  for (let i = 1; i < coordonnees.length; i++) {
    cumul.push(cumul[i - 1]! + distanceMetres(coordonnees[i - 1]!, coordonnees[i]!));
  }
  return { coordonnees, cumul, longueur: cumul[cumul.length - 1]! };
}

/** Indice du segment [i, i+1] qui contient la distance (déjà bornée à la longueur). */
function segmentA(ligne: Polyligne, distance: number): number {
  let bas = 0;
  let haut = ligne.cumul.length - 1;
  while (haut - bas > 1) {
    const milieu = (bas + haut) >> 1;
    if (ligne.cumul[milieu]! <= distance) bas = milieu;
    else haut = milieu;
  }
  return bas;
}

function interpoler(ligne: Polyligne, i: number, distance: number): Coordonnees {
  const [lonA, latA] = ligne.coordonnees[i]!;
  const [lonB, latB] = ligne.coordonnees[i + 1]!;
  const longueurSegment = ligne.cumul[i + 1]! - ligne.cumul[i]!;
  const t = longueurSegment > 0 ? (distance - ligne.cumul[i]!) / longueurSegment : 0;
  return [lonA + (lonB - lonA) * t, latA + (latB - latA) * t];
}

/** Point situé à une distance donnée le long de la polyligne (bornée aux extrémités). */
export function pointADistance(ligne: Polyligne, distance: number): Coordonnees {
  const d = Math.min(Math.max(distance, 0), ligne.longueur);
  return interpoler(ligne, segmentA(ligne, d), d);
}

/** Portion de la polyligne comprise entre deux distances (au moins deux points). */
export function extraire(ligne: Polyligne, debut: number, fin: number): Coordonnees[] {
  const d0 = Math.min(Math.max(Math.min(debut, fin), 0), ligne.longueur);
  const d1 = Math.min(Math.max(Math.max(debut, fin), 0), ligne.longueur);
  const i0 = segmentA(ligne, d0);
  const i1 = segmentA(ligne, d1);
  const points = [interpoler(ligne, i0, d0)];
  for (let i = i0 + 1; i <= i1; i++) points.push(ligne.coordonnees[i]!);
  points.push(interpoler(ligne, i1, d1));
  return points;
}

/**
 * Distance le long de la polyligne du point le plus proche de `point`, en ne cherchant
 * qu'au-delà de `aPartirDe`. Permet de projeter les arrêts dans l'ordre sans qu'un arrêt
 * du sens retour, proche d'une autre portion du tracé, ne soit placé en arrière.
 */
export function projeter(ligne: Polyligne, point: Coordonnees, aPartirDe = 0): number {
  const cosLat = Math.cos(point[1] * RADIANS);
  let meilleure = { ecart: Infinity, distance: aPartirDe };
  for (let i = segmentA(ligne, Math.max(aPartirDe, 0)); i < ligne.coordonnees.length - 1; i++) {
    // Projection orthogonale dans un repère local en mètres (équirectangulaire).
    const [lonA, latA] = ligne.coordonnees[i]!;
    const [lonB, latB] = ligne.coordonnees[i + 1]!;
    const ax = (lonA - point[0]) * cosLat;
    const ay = latA - point[1];
    const bx = (lonB - point[0]) * cosLat;
    const by = latB - point[1];
    const dx = bx - ax;
    const dy = by - ay;
    const carre = dx * dx + dy * dy;
    const t = carre > 0 ? Math.min(Math.max(-(ax * dx + ay * dy) / carre, 0), 1) : 0;
    const distance = ligne.cumul[i]! + t * (ligne.cumul[i + 1]! - ligne.cumul[i]!);
    if (distance < aPartirDe) continue;
    const ecart = Math.hypot(ax + t * dx, ay + t * dy);
    if (ecart < meilleure.ecart) meilleure = { ecart, distance };
  }
  return meilleure.distance;
}
