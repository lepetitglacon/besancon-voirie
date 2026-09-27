/**
 * Giratoires — docs/CONFIGURATION.md §7.
 *
 * Même modèle qu'OSM, SUMO et TM:PE : l'anneau est une chaussée à sens unique, et chaque
 * branche s'y insère en un point. Circulation à droite : on tourne sur l'anneau dans le sens
 * antihoraire vu du ciel, l'azimut décroît. Une trajectoire d'entrée à sortie rejoint
 * l'anneau, le suit, puis le quitte ; le tram et les bus en site propre traversent l'îlot en
 * ligne droite.
 */
import { LARGEUR_VOIE_M, repereLocal, type LonLat, type Repere, type Segment, type XY } from './geometrie.js';
import { normaliserAngle } from './branches.js';

export interface Anneau {
  /** Centre de l'îlot. */
  centre: LonLat;
  /** Rayon du bord extérieur de la chaussée annulaire (m). */
  rayon_m: number;
  /** Nombre de voies de l'anneau. */
  voies: number;
}

/** Rayon proposé quand OSM ne donne pas l'anneau (m) : giratoire urbain courant. */
export const RAYON_ANNEAU_DEFAUT_M = 15;
/** Distance entre le bord de l'anneau et la ligne de cédez-le-passage proposée (m). */
const RECUL_ENTREE_M = 2;
/** Distance entre un feu d'anneau et le premier point de conflit qu'il protège (m). */
export const RECUL_FEU_ANNEAU_M = 3;
/** Écart maximal (°) entre le bout d'une voie et le point où sa trajectoire rejoint ou quitte l'anneau. */
const RACCORD_MAX_DEG = 45;
/** Pas d'échantillonnage des arcs (°). */
const PAS_ARC_DEG = 3;
const POINTS_RACCORD = 8;
const RAD = Math.PI / 180;
const EPSILON_DEG = 1e-6;

/** Distance entre le centre de l'îlot et la ligne d'arrêt des voies entrantes proposées (m). */
export const distanceArretGiratoire = (anneau: Anneau) => anneau.rayon_m + RECUL_ENTREE_M;

/** Rayon de la trajectoire des véhicules sur l'anneau : le milieu de la chaussée annulaire (m). */
export const rayonCirculation = (anneau: Anneau) => Math.max(anneau.rayon_m - (anneau.voies * LARGEUR_VOIE_M) / 2, 1);

/** Azimut (°) du point `p` vu depuis `centre`, en coordonnées planes. */
export function azimutXY(centre: XY, p: XY): number {
  return ((Math.atan2(p[0] - centre[0], p[1] - centre[1]) / RAD + 360) % 360);
}

/** Degrés parcourus sur l'anneau, dans le sens de circulation, pour aller de l'azimut `de` à l'azimut `a`. */
export const parcours = (de: number, a: number) => (((de - a) % 360) + 360) % 360;

const pointAnneau = (centre: XY, rayon: number, azimut: number): XY => [
  centre[0] + rayon * Math.sin(azimut * RAD),
  centre[1] + rayon * Math.cos(azimut * RAD),
];

/** Direction de circulation sur l'anneau à cet azimut (unitaire). */
const tangente = (azimut: number): XY => [-Math.cos(azimut * RAD), Math.sin(azimut * RAD)];

const moins = (a: XY, b: XY): XY => [a[0] - b[0], a[1] - b[1]];
const unitaire = (a: XY): XY => {
  const n = Math.hypot(a[0], a[1]) || 1;
  return [a[0] / n, a[1] / n];
};

function bezier(p0: XY, p1: XY, p2: XY, p3: XY, points: number): XY[] {
  return Array.from({ length: points }, (_, i) => {
    const t = i / (points - 1);
    const a = (1 - t) ** 3;
    const b = 3 * (1 - t) ** 2 * t;
    const c = 3 * (1 - t) * t ** 2;
    const d = t ** 3;
    return [a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]];
  });
}

/**
 * Trajet d'une voie entrante à une voie sortante par l'anneau : raccord d'entrée, arc parcouru
 * dans le sens de circulation, raccord de sortie (coordonnées planes, en mètres).
 */
export interface TrajetGiratoire {
  /** Du bout de la voie entrante au point où la trajectoire rejoint l'anneau. */
  entree: XY[];
  /** Azimut (°) où la trajectoire rejoint l'anneau. */
  debut: number;
  /** Degrés parcourus sur l'anneau. */
  longueur: number;
  /** Du point où la trajectoire quitte l'anneau au bout de la voie sortante. */
  sortie: XY[];
  centre: XY;
  rayon: number;
}

/** Écart (°) entre le bout d'une voie et son raccord à l'anneau : on rejoint l'anneau en tournant. */
function raccord(distanceAuCentre: number, rayon: number): number {
  return Math.min(Math.max(distanceAuCentre - rayon, 0) / rayon / RAD, RACCORD_MAX_DEG);
}

export function trajetGiratoire(entree: Segment, sortie: Segment, anneau: Anneau, repere: Repere): TrajetGiratoire {
  const centre = repere.versXY(anneau.centre);
  const rayon = rayonCirculation(anneau);
  const p0 = repere.versXY(entree[0]);
  const p3 = repere.versXY(sortie[0]);
  const directionEntree = unitaire(moins(p0, repere.versXY(entree[1]))); // vers l'anneau
  const directionSortie = unitaire(moins(repere.versXY(sortie[1]), p3)); // en quittant l'anneau

  const debut = (azimutXY(centre, p0) - raccord(Math.hypot(...moins(p0, centre)), rayon) + 360) % 360;
  const fin = (azimutXY(centre, p3) + raccord(Math.hypot(...moins(p3, centre)), rayon)) % 360;
  const p1 = pointAnneau(centre, rayon, debut);
  const p2 = pointAnneau(centre, rayon, fin);
  const kEntree = 0.5 * Math.hypot(...moins(p1, p0));
  const kSortie = 0.5 * Math.hypot(...moins(p3, p2));
  const tEntree = tangente(debut);
  const tSortie = tangente(fin);
  return {
    entree: bezier(
      p0,
      [p0[0] + directionEntree[0] * kEntree, p0[1] + directionEntree[1] * kEntree],
      [p1[0] - tEntree[0] * kEntree, p1[1] - tEntree[1] * kEntree],
      p1,
      POINTS_RACCORD,
    ),
    debut,
    // Entrée et sortie au même point : un tour complet (demi-tour sur une branche étroite).
    longueur: parcours(debut, fin) || 360,
    sortie: bezier(
      p2,
      [p2[0] + tSortie[0] * kSortie, p2[1] + tSortie[1] * kSortie],
      [p3[0] - directionSortie[0] * kSortie, p3[1] - directionSortie[1] * kSortie],
      p3,
      POINTS_RACCORD,
    ),
    centre,
    rayon,
  };
}

/**
 * Courbe du trajet entre deux positions sur l'anneau, en degrés parcourus depuis son début :
 * le raccord d'entrée est inclus si l'on part de 0, celui de sortie si l'on va jusqu'au bout.
 */
export function courbeTrajet(trajet: TrajetGiratoire, depuis = 0, jusqua = trajet.longueur): XY[] {
  const etendue = jusqua - depuis;
  const pas = Math.max(1, Math.ceil(etendue / PAS_ARC_DEG));
  const arc = Array.from({ length: pas + 1 }, (_, i) =>
    pointAnneau(trajet.centre, trajet.rayon, trajet.debut - depuis - (etendue * i) / pas),
  );
  return [
    ...(depuis <= EPSILON_DEG ? trajet.entree.slice(0, -1) : []),
    ...arc,
    ...(jusqua >= trajet.longueur - EPSILON_DEG ? trajet.sortie.slice(1) : []),
  ];
}

/** Courbe d'une connexion par l'anneau, en lon/lat (pour le dessin). */
export function courbeGiratoire(entree: Segment, sortie: Segment, anneau: Anneau): LonLat[] {
  const repere = repereLocal(anneau.centre);
  return courbeTrajet(trajetGiratoire(entree, sortie, anneau, repere)).map(repere.versLonLat);
}

/** Contour de l'anneau et de l'îlot, en lon/lat (pour le dessin). */
export function contourAnneau(anneau: Anneau, points = 72): { exterieur: LonLat[]; ilot: LonLat[] } {
  const repere = repereLocal(anneau.centre);
  const cercle = (rayon: number) =>
    Array.from({ length: points + 1 }, (_, i) => repere.versLonLat(pointAnneau([0, 0], rayon, (360 * i) / points)));
  return {
    exterieur: cercle(anneau.rayon_m),
    ilot: cercle(Math.max(anneau.rayon_m - anneau.voies * LARGEUR_VOIE_M, 0.5)),
  };
}

/**
 * Une connexion traverse l'îlot en ligne droite au lieu de suivre l'anneau : tram, ou bus en
 * site propre (voie bus à voie bus).
 */
export const traverseIlot = (typeEntree: string | undefined, typeSortie: string | undefined) =>
  (typeEntree === 'tram' && typeSortie === 'tram') || (typeEntree === 'bus' && typeSortie === 'bus');

/** Azimuts (°) où une polyligne franchit le cercle de rayon `rayon`, dans l'ordre du parcours. */
export function franchissementsCercle(courbe: readonly XY[], centre: XY, rayon: number): number[] {
  const azimuts: number[] = [];
  for (let i = 0; i < courbe.length - 1; i++) {
    const a = courbe[i]!;
    const b = courbe[i + 1]!;
    const da = Math.hypot(...moins(a, centre)) - rayon;
    const db = Math.hypot(...moins(b, centre)) - rayon;
    if (da * db < 0) {
      const t = da / (da - db);
      azimuts.push(azimutXY(centre, [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]));
    }
  }
  return azimuts;
}

/**
 * Position d'un feu d'anneau : juste en amont du point le plus en amont parmi ceux où les
 * trajectoires de la branche touchent l'anneau (insertions de ses voies entrantes,
 * franchissements du tram ou du bus qui en vient ou y va). `points` : ces azimuts.
 */
export function azimutFeuAnneau(points: readonly number[], rayon: number): number | null {
  if (points.length === 0) return null;
  const reference = points[0]!;
  const amont = Math.max(...points.map((p) => normaliserAngle(p - reference)));
  return (((reference + amont + RECUL_FEU_ANNEAU_M / rayon / RAD) % 360) + 360) % 360;
}

/** Passage d'une trajectoire sur l'anneau, pour les conflits d'insertion. */
export interface PassageAnneau {
  /** Azimut (°) où la trajectoire est sur l'anneau au départ de son tronçon d'anneau. */
  debut: number;
  /** Degrés parcourus sur l'anneau. */
  longueur: number;
  /** Distance (m) le long de la courbe jusqu'au début de l'anneau. */
  avant: number;
  rayon: number;
  /** Vrai si la trajectoire s'insère depuis une voie entrante ; faux si elle part d'un feu d'anneau. */
  insertion: boolean;
}

/** Vrai si l'azimut `azimut` est strictement à l'intérieur de l'arc parcouru. */
export const surArc = (passage: PassageAnneau, azimut: number) => {
  const c = parcours(passage.debut, azimut);
  return c > EPSILON_DEG && c < passage.longueur - EPSILON_DEG;
};

/** Distance (m) le long de la trajectoire jusqu'à l'azimut `azimut` de son arc. */
export const distanceSurArc = (passage: PassageAnneau, azimut: number) =>
  passage.avant + passage.rayon * RAD * parcours(passage.debut, azimut);

/**
 * Points d'insertion entre deux trajectoires sur l'anneau : l'une rejoint l'anneau là où
 * l'autre y circule. Distances (m) depuis le début de chacune jusqu'au point d'insertion.
 */
export function insertions(a: PassageAnneau, b: PassageAnneau): Array<{ da: number; db: number }> {
  const points: Array<{ da: number; db: number }> = [];
  if (b.insertion && surArc(a, b.debut)) points.push({ da: distanceSurArc(a, b.debut), db: b.avant });
  if (a.insertion && surArc(b, a.debut)) points.push({ da: a.avant, db: distanceSurArc(b, a.debut) });
  return points;
}
