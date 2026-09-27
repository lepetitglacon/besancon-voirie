/**
 * Réseau routier — docs/RESEAU.md : découpe des tronçons au cercle d'un carrefour configuré,
 * voies d'une rue tout du long, liaisons voie à voie aux nœuds et à leurs valeurs par défaut.
 */
import { directionMouvement } from './branches.js';
import { LARGEUR_VOIE_M, repereLocal, type LonLat, type XY } from './geometrie.js';

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

// ── Voies d'une rue, tout du long ──

const longueurXY = (points: readonly XY[]) =>
  points.reduce((total, p, i) => (i === 0 ? 0 : total + Math.hypot(p[0] - points[i - 1]![0], p[1] - points[i - 1]![1])), 0);

/** Retire `debut` mètres au début de la polyligne et `fin` mètres à la fin. */
function raccourcir(points: readonly XY[], debut: number, fin: number): XY[] {
  const couper = (liste: readonly XY[], distance: number): XY[] => {
    let reste = distance;
    for (let i = 0; i < liste.length - 1; i++) {
      const [a, b] = [liste[i]!, liste[i + 1]!];
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (reste < l) {
        const t = reste / l;
        return [[a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], ...liste.slice(i + 1)];
      }
      reste -= l;
    }
    return [liste.at(-1)!, liste.at(-1)!];
  };
  return couper(couper(points, debut).reverse(), fin).reverse();
}

/** Polyligne décalée de `d` mètres sur sa droite (d < 0 : sur sa gauche), angles en onglet borné. */
function decaler(points: readonly XY[], d: number): XY[] {
  const normales = points.slice(0, -1).map((a, i) => {
    const b = points[i + 1]!;
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [(b[1] - a[1]) / l, -(b[0] - a[0]) / l] as XY; // à droite du sens de parcours
  });
  return points.map((p, i) => {
    const avant = normales[Math.max(0, i - 1)]!;
    const apres = normales[Math.min(normales.length - 1, i)]!;
    const somme: XY = [avant[0] + apres[0], avant[1] + apres[1]];
    const n = Math.hypot(somme[0], somme[1]);
    if (n < 1e-9) return [p[0] + avant[0] * d, p[1] + avant[1] * d];
    const moyenne: XY = [somme[0] / n, somme[1] / n];
    const cos = Math.max(0.5, moyenne[0] * apres[0] + moyenne[1] * apres[1]);
    return [p[0] + (moyenne[0] * d) / cos, p[1] + (moyenne[1] * d) / cos];
  });
}

export interface VoiesTroncon {
  /** Voies dans le sens du tracé, de `de` vers `vers` ; rang 0 = la plus à gauche du conducteur. */
  avant: LonLat[][];
  /** Voies dans l'autre sens, orientées de `vers` vers `de`. */
  arriere: LonLat[][];
}

/**
 * Voies d'une rue le long de son axe, circulation à droite : un double sens a ses voies `avant`
 * à droite de l'axe et `arriere` à gauche, la voie de rang 0 contre l'axe ; un sens unique est
 * centré sur l'axe. Les bouts sont reculés de `retraitDe` et `retraitVers` mètres, pour laisser
 * la place aux liaisons du nœud (au plus 40 % de la longueur chacun).
 */
export function voiesTroncon(points: readonly LonLat[], avant: number, arriere: number, retraitDe = 0, retraitVers = 0): VoiesTroncon {
  const repere = repereLocal(points[0]!);
  const xy = points.map(repere.versXY);
  const longueur = longueurXY(xy);
  const axe = raccourcir(xy, Math.min(retraitDe, longueur * 0.4), Math.min(retraitVers, longueur * 0.4));
  const w = LARGEUR_VOIE_M;
  const voie = (d: number) => decaler(axe, d).map(repere.versLonLat);
  return {
    avant: Array.from({ length: avant }, (_, k) => voie(arriere > 0 ? (k + 0.5) * w : (k - (avant - 1) / 2) * w)),
    arriere: Array.from({ length: arriere }, (_, k) => voie(avant > 0 ? -(k + 0.5) * w : -(k - (arriere - 1) / 2) * w).reverse()),
  };
}

/** Recul (m) des voies au bout d'un tronçon, selon le nœud : rien à un cul-de-sac. */
export function retraitAuNoeud(degre: number, voiesMax: number): number {
  if (degre <= 1) return 0;
  return degre === 2 ? 3 : 4 + voiesMax * LARGEUR_VOIE_M * 0.6;
}

// ── Liaisons voie à voie à un nœud ──

/** Tronçon vu depuis un nœud : ses voies qui y arrivent et qui en repartent, sa direction. */
export interface BoutAuNoeud {
  troncon: string;
  extremite: 'de' | 'vers';
  /** Degrés depuis le nord, du nœud vers le tronçon. */
  azimut: number;
  arrivent: number;
  repartent: number;
}

/** Liaison d'une voie qui arrive au nœud vers une voie qui en repart (rangs dans chaque sens). */
export interface Liaison {
  de: string;
  voie_de: number;
  vers: string;
  voie_vers: number;
}

/** Tronçons qui touchent le nœud, avec leurs voies et leur direction (mesurée à 10 m). */
export function boutsAuNoeud(
  noeud: string,
  troncons: ReadonlyArray<{ id: string; noeud_de: string; noeud_vers: string; points: readonly LonLat[]; voies_avant: number; voies_arriere: number }>,
): BoutAuNoeud[] {
  return troncons.flatMap((t) =>
    (['de', 'vers'] as const)
      .filter((extremite) => (extremite === 'de' ? t.noeud_de : t.noeud_vers) === noeud)
      .map((extremite): BoutAuNoeud => {
        const depuis = extremite === 'de' ? t.points : [...t.points].reverse();
        const repere = repereLocal(depuis[0]!);
        const xy = depuis.map(repere.versXY);
        const loin = raccourcir(xy, Math.min(10, longueurXY(xy) * 0.9), 0)[0]!;
        return {
          troncon: t.id,
          extremite,
          azimut: ((Math.atan2(loin[0], loin[1]) * 180) / Math.PI + 360) % 360,
          arrivent: extremite === 'vers' ? t.voies_avant : t.voies_arriere,
          repartent: extremite === 'vers' ? t.voies_arriere : t.voies_avant,
        };
      }),
  );
}

/**
 * Liaisons proposées à un nœud, comme les connexions d'un carrefour : tout droit voie à voie,
 * tourne-à-gauche depuis la voie de gauche vers la voie de gauche, tourne-à-droite de droite à
 * droite ; pas de demi-tour. Deux tronçons seuls se prolongent voie à voie.
 */
export function liaisonsParDefaut(bouts: readonly BoutAuNoeud[]): Liaison[] {
  const liaisons: Liaison[] = [];
  const prolongement = bouts.length === 2;
  for (const a of bouts) {
    if (a.arrivent === 0) continue;
    for (const b of bouts) {
      if (b === a || b.repartent === 0 || b.troncon === a.troncon) continue;
      const direction = directionMouvement(a.azimut, b.azimut);
      const paires: Array<[number, number]> =
        prolongement || direction === 'tout_droit'
          ? liensParDefaut(a.arrivent, b.repartent)
          : direction === 'gauche'
            ? [[0, 0]]
            : [[a.arrivent - 1, b.repartent - 1]];
      for (const [i, j] of paires) liaisons.push({ de: a.troncon, voie_de: i, vers: b.troncon, voie_vers: j });
    }
  }
  return liaisons;
}

/** Liaisons saisies encore possibles (tronçons et voies existants), ou à défaut celles proposées. */
export function liaisonsRetenues(bouts: readonly BoutAuNoeud[], saisies: readonly Liaison[] | null): { liaisons: Liaison[]; auto: boolean } {
  if (saisies === null) return { liaisons: liaisonsParDefaut(bouts), auto: true };
  const valide = (l: Liaison) => {
    const a = bouts.find((b) => b.troncon === l.de && b.arrivent > l.voie_de);
    const b = bouts.find((x) => x.troncon === l.vers && x.repartent > l.voie_vers);
    return a !== undefined && b !== undefined;
  };
  return { liaisons: saisies.filter(valide), auto: false };
}
