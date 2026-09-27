/**
 * Géométrie locale d'un carrefour : repère plan en mètres, voies générées depuis une
 * branche, courbes des connexions, intersections — docs/CONFIGURATION.md §3.
 */

export type LonLat = [number, number];
export type XY = [number, number];
/** Segment orienté : [bout côté carrefour, bout éloigné]. */
export type Segment = [LonLat, LonLat];

const RAYON_TERRE_M = 6_371_008.8;
const RAD = Math.PI / 180;

export interface Repere {
  versXY: (p: LonLat) => XY;
  versLonLat: (p: XY) => LonLat;
}

/** Repère plan (équirectangulaire) centré sur le carrefour : x vers l'est, y vers le nord, en mètres. */
export function repereLocal([lon0, lat0]: LonLat): Repere {
  const kx = RAYON_TERRE_M * RAD * Math.cos(lat0 * RAD);
  const ky = RAYON_TERRE_M * RAD;
  return {
    versXY: ([lon, lat]) => [(lon - lon0) * kx, (lat - lat0) * ky],
    versLonLat: ([x, y]) => [lon0 + x / kx, lat0 + y / ky],
  };
}

/** Largeur d'une voie de circulation (m). */
export const LARGEUR_VOIE_M = 3.25;
/** Largeur d'une voie cyclable (m) : bande, ou piste dans un sens. */
export const LARGEUR_VOIE_VELO_M = 1.5;
/** Distance entre le centre du carrefour et la ligne d'arrêt proposée (m). */
export const DISTANCE_ARRET_M = 15;
/** Longueur des voies dessinées en amont de la ligne d'arrêt (m). */
export const LONGUEUR_VOIE_M = 25;
/** Recul du passage piéton par rapport à la ligne d'arrêt, vers le centre (m). */
const RECUL_TRAVERSEE_M = 3;
/** Largeur de trottoir ajoutée de chaque côté du passage piéton (m). */
const DEBORD_TRAVERSEE_M = 1.5;

export interface VoiesGenerees {
  /** Rang 0 = voie la plus à gauche en arrivant. */
  entrantes: Segment[];
  /** Rang 0 = voie la plus à gauche en repartant. */
  sortantes: Segment[];
  /** Passage piéton en travers de la branche, d'un trottoir à l'autre. */
  traversee: Segment;
}

/**
 * Voies proposées pour une branche, parallèles à son axe. Circulation à droite : vues du
 * centre vers la branche, les voies entrantes sont à gauche de l'axe, les sortantes à droite ;
 * dans chaque sens, la voie la plus à gauche du conducteur est la plus proche de l'axe.
 */
export function genererVoies(
  centre: LonLat,
  azimut: number,
  entrantes: number,
  sortantes: number,
  distanceArret = DISTANCE_ARRET_M,
): VoiesGenerees {
  const repere = repereLocal(centre);
  const u: XY = [Math.sin(azimut * RAD), Math.cos(azimut * RAD)]; // du centre vers la branche
  const gauche: XY = [-u[1], u[0]]; // à gauche de u
  const point = (distance: number, decalage: number): LonLat =>
    repere.versLonLat([u[0] * distance + gauche[0] * decalage, u[1] * distance + gauche[1] * decalage]);
  const voie = (decalage: number): Segment => [point(distanceArret, decalage), point(distanceArret + LONGUEUR_VOIE_M, decalage)];

  const recul = distanceArret - RECUL_TRAVERSEE_M;
  return {
    entrantes: Array.from({ length: entrantes }, (_, rang) => voie((rang + 0.5) * LARGEUR_VOIE_M)),
    sortantes: Array.from({ length: sortantes }, (_, rang) => voie(-(rang + 0.5) * LARGEUR_VOIE_M)),
    traversee: [
      point(recul, entrantes * LARGEUR_VOIE_M + DEBORD_TRAVERSEE_M),
      point(recul, -(sortantes * LARGEUR_VOIE_M + DEBORD_TRAVERSEE_M)),
    ],
  };
}

const moins = (a: XY, b: XY): XY => [a[0] - b[0], a[1] - b[1]];
const norme = (a: XY) => Math.hypot(a[0], a[1]);
const unitaire = (a: XY): XY => {
  const n = norme(a) || 1;
  return [a[0] / n, a[1] / n];
};

/**
 * Trajectoire d'une connexion, du bout de la voie entrante au bout de la voie sortante :
 * courbe de Bézier cubique tangente aux deux voies, échantillonnée en `points` points (XY).
 */
export function courbeConnexionXY(entree: Segment, sortie: Segment, repere: Repere, points = 16): XY[] {
  const p0 = repere.versXY(entree[0]);
  const p3 = repere.versXY(sortie[0]);
  const directionEntree = unitaire(moins(p0, repere.versXY(entree[1]))); // vers le carrefour
  const directionSortie = unitaire(moins(repere.versXY(sortie[1]), p3)); // en quittant le carrefour
  const k = 0.4 * norme(moins(p3, p0));
  const p1: XY = [p0[0] + directionEntree[0] * k, p0[1] + directionEntree[1] * k];
  const p2: XY = [p3[0] - directionSortie[0] * k, p3[1] - directionSortie[1] * k];
  return Array.from({ length: points }, (_, i) => {
    const t = i / (points - 1);
    const a = (1 - t) ** 3;
    const b = 3 * (1 - t) ** 2 * t;
    const c = 3 * (1 - t) * t ** 2;
    const d = t ** 3;
    return [a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]];
  });
}

export function courbeConnexion(entree: Segment, sortie: Segment, points = 16): LonLat[] {
  const repere = repereLocal(entree[0]);
  return courbeConnexionXY(entree, sortie, repere, points).map(repere.versLonLat);
}

const orientation = (a: XY, b: XY, c: XY) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

/** Vrai si les segments [a1, a2] et [b1, b2] se coupent strictement (hors extrémités communes). */
export function segmentsSeCoupent(a1: XY, a2: XY, b1: XY, b2: XY): boolean {
  const d1 = orientation(b1, b2, a1);
  const d2 = orientation(b1, b2, a2);
  const d3 = orientation(a1, a2, b1);
  const d4 = orientation(a1, a2, b2);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

export function polylignesSeCoupent(a: readonly XY[], b: readonly XY[]): boolean {
  for (let i = 0; i < a.length - 1; i++) {
    for (let j = 0; j < b.length - 1; j++) {
      if (segmentsSeCoupent(a[i]!, a[i + 1]!, b[j]!, b[j + 1]!)) return true;
    }
  }
  return false;
}

/** Longueur d'une polyligne (m). */
export function longueurPolyligne(points: readonly XY[]): number {
  let longueur = 0;
  for (let i = 0; i < points.length - 1; i++) longueur += norme(moins(points[i + 1]!, points[i]!));
  return longueur;
}

/**
 * Points où deux polylignes se coupent, repérés par la distance parcourue depuis le début
 * de chacune (m) : `da` le long de `a`, `db` le long de `b`.
 */
export function intersectionsPolylignes(a: readonly XY[], b: readonly XY[]): Array<{ da: number; db: number; point: XY }> {
  const resultats: Array<{ da: number; db: number; point: XY }> = [];
  let debutA = 0;
  for (let i = 0; i < a.length - 1; i++) {
    const a1 = a[i]!;
    const a2 = a[i + 1]!;
    const longueurA = norme(moins(a2, a1));
    let debutB = 0;
    for (let j = 0; j < b.length - 1; j++) {
      const b1 = b[j]!;
      const b2 = b[j + 1]!;
      const longueurB = norme(moins(b2, b1));
      if (segmentsSeCoupent(a1, a2, b1, b2)) {
        // a1 + t (a2 − a1) = b1 + u (b2 − b1)
        const r = moins(a2, a1);
        const s = moins(b2, b1);
        const q = moins(b1, a1);
        const denominateur = r[0] * s[1] - r[1] * s[0];
        const t = (q[0] * s[1] - q[1] * s[0]) / denominateur;
        const u = (q[0] * r[1] - q[1] * r[0]) / denominateur;
        resultats.push({ da: debutA + t * longueurA, db: debutB + u * longueurB, point: [a1[0] + t * r[0], a1[1] + t * r[1]] });
      }
      debutB += longueurB;
    }
    debutA += longueurA;
  }
  return resultats;
}

/**
 * Voie parallèle à `segment`, décalée d'une largeur de voie sur sa gauche ou sa droite
 * (côtés vus en regardant du bout côté carrefour vers le bout éloigné).
 */
export function voieAdjacente(segment: Segment, cote: 'gauche' | 'droite', distance = LARGEUR_VOIE_M): Segment {
  const repere = repereLocal(segment[0]);
  const a = repere.versXY(segment[0]);
  const b = repere.versXY(segment[1]);
  const u = unitaire(moins(b, a));
  const signe = cote === 'gauche' ? 1 : -1;
  const decalage: XY = [-u[1] * distance * signe, u[0] * distance * signe];
  return [
    repere.versLonLat([a[0] + decalage[0], a[1] + decalage[1]]),
    repere.versLonLat([b[0] + decalage[0], b[1] + decalage[1]]),
  ];
}
