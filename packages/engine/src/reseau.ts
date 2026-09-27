/**
 * Réseau routier hors carrefours — docs/RESEAU.md : découpe des tronçons au cercle d'un
 * carrefour configuré, voies d'un bout de tronçon, liens voie à voie proposés par défaut.
 */
import { LARGEUR_VOIE_M, repereLocal, type LonLat, type Segment, type XY } from './geometrie.js';

/** Portion d'une polyligne hors d'un cercle, et si ses bouts ont été coupés sur le cercle. */
export interface MorceauHorsCercle {
  points: LonLat[];
  debutSurCercle: boolean;
  finSurCercle: boolean;
}

/** Paramètres t ∈ ]0, 1[ où le segment [a, b] croise le cercle de centre (0, 0), dans l'ordre. */
function traversees(a: XY, b: XY, rayon: number): number[] {
  const d: XY = [b[0] - a[0], b[1] - a[1]];
  const qa = d[0] ** 2 + d[1] ** 2;
  if (qa === 0) return [];
  const qb = 2 * (a[0] * d[0] + a[1] * d[1]);
  const qc = a[0] ** 2 + a[1] ** 2 - rayon ** 2;
  const discriminant = qb ** 2 - 4 * qa * qc;
  if (discriminant <= 0) return [];
  const racine = Math.sqrt(discriminant);
  return [(-qb - racine) / (2 * qa), (-qb + racine) / (2 * qa)].filter((t) => t > 0 && t < 1);
}

/**
 * Découpe une polyligne au cercle (centre, rayon en mètres) : renvoie les portions à l'extérieur,
 * dans l'ordre. Une polyligne entièrement dedans ne donne rien ; une polyligne qui traverse le
 * cercle en donne deux.
 */
export function horsDuCercle(points: readonly LonLat[], centre: LonLat, rayon: number): MorceauHorsCercle[] {
  const repere = repereLocal(centre);
  const xy = points.map(repere.versXY);
  const dehors = (p: XY) => Math.hypot(p[0], p[1]) > rayon;
  const morceaux: MorceauHorsCercle[] = [];
  let courant: MorceauHorsCercle | null = dehors(xy[0]!) ? { points: [points[0]!], debutSurCercle: false, finSurCercle: false } : null;

  for (let i = 0; i < xy.length - 1; i++) {
    const a = xy[i]!;
    const b = xy[i + 1]!;
    for (const t of traversees(a, b, rayon)) {
      const point = repere.versLonLat([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      if (courant) {
        courant.points.push(point);
        courant.finSurCercle = true;
        morceaux.push(courant);
        courant = null;
      } else {
        courant = { points: [point], debutSurCercle: true, finSurCercle: false };
      }
    }
    if (courant && dehors(b)) courant.points.push(points[i + 1]!);
  }
  if (courant) morceaux.push(courant);
  return morceaux.filter((m) => m.points.length >= 2);
}

/**
 * Liens proposés entre `sources` voies et `cibles` voies (rang 0 = la plus à gauche) : chaque
 * voie source mène à la part des voies cibles qui lui correspond, et chaque cible est servie.
 * 1 → 3 : la voie mène aux trois ; 3 → 1 : les trois se rejoignent.
 */
export function liensParDefaut(sources: number, cibles: number): Array<[number, number]> {
  const liens: Array<[number, number]> = [];
  if (sources === 0 || cibles === 0) return liens;
  for (let i = 0; i < sources; i++) {
    const premiere = Math.floor((i * cibles) / sources);
    const derniere = Math.max(premiere, Math.ceil(((i + 1) * cibles) / sources) - 1);
    for (let j = premiere; j <= derniere; j++) liens.push([i, j]);
  }
  return liens;
}

/** Longueur (m) des voies dessinées au bout d'un tronçon raccordé. */
export const LONGUEUR_VOIE_TRONCON_M = 18;

/**
 * Voies au bout d'un tronçon, parallèles à sa direction : `point` est le bout côté carrefour,
 * `vers` un point du tronçon plus loin. Même convention que les branches : segments [bout côté
 * carrefour, bout éloigné], rang 0 = la plus à gauche du conducteur, circulation à droite. Un
 * sens unique est centré sur l'axe.
 */
export function voiesBoutTroncon(
  point: LonLat,
  vers: LonLat,
  versCarrefour: number,
  depuisCarrefour: number,
  longueur = LONGUEUR_VOIE_TRONCON_M,
): { entrantes: Segment[]; sortantes: Segment[] } {
  const repere = repereLocal(point);
  const [dx, dy] = repere.versXY(vers);
  const n = Math.hypot(dx, dy) || 1;
  const u: XY = [dx / n, dy / n]; // du carrefour vers l'extérieur
  const gauche: XY = [-u[1], u[0]];
  const voie = (decalage: number): Segment => [
    repere.versLonLat([gauche[0] * decalage, gauche[1] * decalage]),
    repere.versLonLat([u[0] * longueur + gauche[0] * decalage, u[1] * longueur + gauche[1] * decalage]),
  ];
  const w = LARGEUR_VOIE_M;
  if (depuisCarrefour === 0) {
    // Sens unique vers le carrefour : le conducteur a sa gauche du côté −gauche.
    return { entrantes: Array.from({ length: versCarrefour }, (_, k) => voie((k - (versCarrefour - 1) / 2) * w)), sortantes: [] };
  }
  if (versCarrefour === 0) {
    return { entrantes: [], sortantes: Array.from({ length: depuisCarrefour }, (_, k) => voie(((depuisCarrefour - 1) / 2 - k) * w)) };
  }
  return {
    entrantes: Array.from({ length: versCarrefour }, (_, k) => voie((k + 0.5) * w)),
    sortantes: Array.from({ length: depuisCarrefour }, (_, k) => voie(-(k + 0.5) * w)),
  };
}
