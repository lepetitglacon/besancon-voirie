/**
 * Giratoires — docs/CONFIGURATION.md §7.
 *
 * Comme dans TM:PE, un giratoire est une boucle de nœuds posés sur la photo, dans l'ordre de
 * circulation (sens antihoraire vu du ciel). Chaque nœud est un mini-carrefour : on y relie
 * à la main les voies de l'anneau et celles des rues qui s'y raccordent. Entre deux nœuds, un
 * tronçon d'anneau suit une courbe lissée qui passe par les nœuds ; ses voies sont des voies
 * sortantes au nœud de départ et entrantes au nœud d'arrivée, comme celles d'une branche.
 */
import { azimutSegment, cleVoie } from './connexions.js';
import { LARGEUR_VOIE_M, longueurPolyligne, repereLocal, type LonLat, type Segment, type XY } from './geometrie.js';

export interface Noeud {
  /** « 1 », « 2 »… */
  code: string;
  position: LonLat;
}

/** Anneau d'un giratoire : ses nœuds dans l'ordre de circulation. */
export interface Anneau {
  noeuds: readonly Noeud[];
}

/** En dessous, pas d'anneau ; à partir de 4, la courbe suit bien un anneau réel. */
export const NOEUDS_MIN = 3;
export const NOEUDS_CONSEILLES = 4;

/** Code du tronçon d'anneau qui part d'un nœud : R1 part du nœud 1. */
export const codeTroncon = (noeud: string) => `R${noeud}`;

/** Longueur laissée libre de chaque côté d'un nœud, où se dessinent ses liaisons (m). */
export const ECART_NOEUD_M = 4;
/** Longueur des bouts de voie d'un tronçon, de chaque côté (m). */
const LONGUEUR_BOUT_M = 8;
/** Recul de la ligne d'arrêt d'une rue par rapport à l'anneau (m). */
const RECUL_ENTREE_M = 2;
const POINTS_PAR_TRONCON = 24;

const moins = (a: XY, b: XY): XY => [a[0] - b[0], a[1] - b[1]];
const distance = (a: XY, b: XY) => Math.hypot(...moins(a, b));

/** Élément qui suit `index` dans l'ordre de circulation (le dernier est suivi du premier). */
export const suivant = <T>(liste: readonly T[], index: number) => liste[(index + 1) % liste.length]!;

/**
 * Courbe fermée qui passe par tous les points (Catmull-Rom centripète : ni boucle ni
 * rebroussement entre deux nœuds rapprochés), en coordonnées planes. Une polyligne par
 * tronçon : du point `i` au point suivant.
 */
export function tronconsXY(points: readonly XY[], parTroncon = POINTS_PAR_TRONCON): XY[][] {
  const n = points.length;
  if (n < 2) return [];
  const p = (i: number) => points[((i % n) + n) % n]!;
  const pas = (a: XY, b: XY) => Math.max(Math.sqrt(distance(a, b)), 1e-6);
  const lerp = (a: XY, b: XY, ta: number, tb: number, t: number): XY => {
    const k = (t - ta) / (tb - ta);
    return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
  };
  return points.map((_, i) => {
    const [p0, p1, p2, p3] = [p(i - 1), p(i), p(i + 1), p(i + 2)];
    const t0 = 0;
    const t1 = t0 + pas(p0, p1);
    const t2 = t1 + pas(p1, p2);
    const t3 = t2 + pas(p2, p3);
    return Array.from({ length: parTroncon + 1 }, (_, k) => {
      const t = t1 + ((t2 - t1) * k) / parTroncon;
      const a1 = lerp(p0, p1, t0, t1, t);
      const a2 = lerp(p1, p2, t1, t2, t);
      const a3 = lerp(p2, p3, t2, t3, t);
      const b1 = lerp(a1, a2, t0, t2, t);
      const b2 = lerp(a2, a3, t1, t3, t);
      return lerp(b1, b2, t1, t2, t);
    });
  });
}

/** Point à `d` mètres du début d'une polyligne, et direction unitaire à cet endroit. */
function pointA(polyligne: readonly XY[], d: number): { point: XY; direction: XY } {
  let reste = Math.max(d, 0);
  for (let i = 0; i < polyligne.length - 1; i++) {
    const a = polyligne[i]!;
    const b = polyligne[i + 1]!;
    const l = distance(a, b);
    if (reste <= l || i === polyligne.length - 2) {
      const k = l === 0 ? 0 : Math.min(reste / l, 1);
      const u: XY = l === 0 ? [1, 0] : [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
      return { point: [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k], direction: u };
    }
    reste -= l;
  }
  return { point: polyligne[0]!, direction: [1, 0] };
}

export interface GeometrieTroncon {
  /** Code du tronçon (branche générée) : R + code du nœud de départ. */
  code: string;
  /** Nœud de départ et nœud d'arrivée. */
  de: string;
  vers: string;
  /** Tracé du tronçon, du nœud de départ au nœud d'arrivée. */
  trace: LonLat[];
  /** Voies au départ (sortantes du nœud de départ), rang 0 = la plus à gauche, côté îlot. */
  sortantes: Segment[];
  /** Mêmes voies à l'arrivée (entrantes au nœud d'arrivée), rang 0 = côté îlot. */
  entrantes: Segment[];
}

/**
 * Géométrie des tronçons d'anneau : tracé, et bouts de voies de part et d'autre des nœuds.
 * `voies` : nombre de voies de chaque tronçon (par code de tronçon), 1 par défaut.
 */
export function geometrieAnneau(anneau: Anneau, voies: ReadonlyMap<string, number> = new Map()): GeometrieTroncon[] {
  const { noeuds } = anneau;
  if (noeuds.length < NOEUDS_MIN) return [];
  const repere = repereLocal(noeuds[0]!.position);
  const traces = tronconsXY(noeuds.map((n) => repere.versXY(n.position)));
  return noeuds.map((noeud, i) => {
    const code = codeTroncon(noeud.code);
    const trace = traces[i]!;
    const longueur = longueurPolyligne(trace);
    const ecart = Math.min(ECART_NOEUD_M, longueur / 4);
    const bout = Math.max(Math.min(LONGUEUR_BOUT_M, longueur / 2 - ecart - 0.5), 0.5);
    const nombre = Math.max(voies.get(code) ?? 1, 1);
    // Circulation antihoraire : la gauche du conducteur est côté îlot.
    const decale = (d: number, rang: number): LonLat => {
      const { point, direction } = pointA(trace, d);
      const gauche: XY = [-direction[1], direction[0]];
      const k = ((nombre - 1) / 2 - rang) * LARGEUR_VOIE_M;
      return repere.versLonLat([point[0] + gauche[0] * k, point[1] + gauche[1] * k]);
    };
    const rangs = Array.from({ length: nombre }, (_, r) => r);
    return {
      code,
      de: noeud.code,
      vers: suivant(noeuds, i).code,
      trace: trace.map(repere.versLonLat),
      sortantes: rangs.map((r): Segment => [decale(ecart, r), decale(ecart + bout, r)]),
      entrantes: rangs.map((r): Segment => [decale(longueur - ecart, r), decale(longueur - ecart - bout, r)]),
    };
  });
}

/** Distance entre un nœud et la ligne d'arrêt proposée des rues qui s'y raccordent (m). */
export const distanceArretNoeud = (voiesAnneau: number) => (voiesAnneau * LARGEUR_VOIE_M) / 2 + RECUL_ENTREE_M;

/**
 * Ajoute un nœud là où il allonge le moins la boucle. Tant qu'il y a moins de trois nœuds,
 * on les classe dans le sens de circulation (antihoraire) autour de leur centre.
 */
export function insererNoeud(anneau: Anneau, noeud: Noeud): Anneau {
  const { noeuds } = anneau;
  if (noeuds.length < NOEUDS_MIN) {
    const tous = [...noeuds, noeud];
    const repere = repereLocal(tous[0]!.position);
    const xy = tous.map((n) => repere.versXY(n.position));
    const centre: XY = [xy.reduce((s, p) => s + p[0], 0) / xy.length, xy.reduce((s, p) => s + p[1], 0) / xy.length];
    const angle = (p: XY) => Math.atan2(p[1] - centre[1], p[0] - centre[0]);
    return { noeuds: tous.map((n, i) => ({ n, a: angle(xy[i]!) })).sort((x, y) => x.a - y.a).map((o) => o.n) };
  }
  const repere = repereLocal(noeuds[0]!.position);
  const p = repere.versXY(noeud.position);
  let meilleur = { index: 0, cout: Infinity };
  noeuds.forEach((n, i) => {
    const a = repere.versXY(n.position);
    const b = repere.versXY(suivant(noeuds, i).position);
    const cout = distance(a, p) + distance(p, b) - distance(a, b);
    if (cout < meilleur.cout) meilleur = { index: i, cout };
  });
  return { noeuds: [...noeuds.slice(0, meilleur.index + 1), noeud, ...noeuds.slice(meilleur.index + 1)] };
}

/** Premier code de nœud libre : 1, 2, 3… */
export function codeNoeudLibre(anneau: Anneau | null): string {
  const pris = new Set(anneau?.noeuds.map((n) => n.code));
  let n = 1;
  while (pris.has(String(n))) n++;
  return String(n);
}

/** Voie générée d'un tronçon, au format des voies de branche. */
interface VoieTroncon {
  sens: 'entrante' | 'sortante';
  rang: number;
  type: 'generale';
  geom: Segment;
}

/**
 * Tronçons d'anneau sous forme de branches générées (R1, R2…), à enregistrer avec les rues :
 * leurs voies se relient aux nœuds comme celles d'une branche. `voies` : nombre de voies par
 * tronçon, 1 par défaut.
 */
export function branchesTroncons(anneau: Anneau, voies: ReadonlyMap<string, number> = new Map()) {
  const troncons = geometrieAnneau(anneau, voies);
  const repere = repereLocal(anneau.noeuds[0]?.position ?? [0, 0]);
  const xy = anneau.noeuds.map((n) => repere.versXY(n.position));
  const centre: XY = [xy.reduce((s, p) => s + p[0], 0) / (xy.length || 1), xy.reduce((s, p) => s + p[1], 0) / (xy.length || 1)];
  return troncons.map((t) => {
    const [x, y] = repere.versXY(t.trace[Math.floor(t.trace.length / 2)]!);
    return {
      code: t.code,
      nom: null,
      azimut: Math.round((((Math.atan2(x - centre[0], y - centre[1]) * 180) / Math.PI + 360) % 360) * 10) / 10,
      osm_way_id: null,
      geom: t.trace,
      voies: [
        ...t.sortantes.map((geom, rang): VoieTroncon => ({ sens: 'sortante', rang, type: 'generale', geom })),
        ...t.entrantes.map((geom, rang): VoieTroncon => ({ sens: 'entrante', rang, type: 'generale', geom })),
      ],
      traversee: null,
      priorite_entree: null,
      noeud: t.de,
      troncon: true,
    };
  });
}

/** Branche vue par les fonctions de nœud : ses voies, son nœud, tronçon d'anneau ou rue. */
interface BrancheNoeud {
  code: string;
  noeud?: string | null;
  troncon?: boolean;
  voies: ReadonlyArray<{ sens: 'entrante' | 'sortante'; rang: number }>;
}

/**
 * Nœud où se trouve une voie : celui de sa rue ; pour un tronçon, son nœud de départ côté
 * voies sortantes, son nœud d'arrivée côté voies entrantes. null hors anneau (tram qui
 * traverse l'îlot, par exemple).
 */
export function noeudDeVoie(cle: string, branches: readonly BrancheNoeud[], anneau: Anneau): string | null {
  const [code, voie] = cle.split(':');
  const branche = branches.find((b) => b.code === code);
  if (!branche?.noeud) return null;
  if (!branche.troncon || voie?.startsWith('s')) return branche.noeud;
  const index = anneau.noeuds.findIndex((n) => n.code === branche.noeud);
  return index < 0 ? null : suivant(anneau.noeuds, index).code;
}

/** Liaisons qui relient deux nœuds différents, ou un nœud et une voie hors anneau. */
export function liaisonsHorsNoeud(
  branches: readonly BrancheNoeud[],
  connexions: ReadonlyArray<{ de: string; vers: string }>,
  anneau: Anneau,
): string[] {
  return connexions
    .filter((c) => noeudDeVoie(c.de, branches, anneau) !== noeudDeVoie(c.vers, branches, anneau))
    .map((c) => `${c.de}>${c.vers}`);
}

/**
 * Liaisons proposées à chaque nœud, voies alignées à droite : l'anneau continue voie par voie,
 * on sort par les voies extérieures de l'anneau, on s'insère sur ses voies extérieures.
 * Point de départ à corriger à la main avec l'outil Liaison.
 */
export function proposerLiaisonsNoeuds(branches: readonly BrancheNoeud[], anneau: Anneau): Array<{ de: string; vers: string }> {
  const nombre = (b: BrancheNoeud | undefined, sens: 'entrante' | 'sortante') => b?.voies.filter((v) => v.sens === sens).length ?? 0;
  const aligne = (rang: number, depuis: number, vers: number) => Math.min(Math.max(rang + vers - depuis, 0), vers - 1);
  const liaisons: Array<{ de: string; vers: string }> = [];
  anneau.noeuds.forEach((noeud, i) => {
    const precedent = anneau.noeuds[(i - 1 + anneau.noeuds.length) % anneau.noeuds.length]!;
    const arrivee = branches.find((b) => b.troncon && b.noeud === precedent.code);
    const depart = branches.find((b) => b.troncon && b.noeud === noeud.code);
    const rues = branches.filter((b) => !b.troncon && b.noeud === noeud.code);
    const nArrivee = nombre(arrivee, 'entrante');
    const nDepart = nombre(depart, 'sortante');
    for (let r = 0; r < nArrivee && depart; r++) {
      liaisons.push({ de: `${arrivee!.code}:e${r}`, vers: `${depart.code}:s${aligne(r, nArrivee, nDepart)}` });
    }
    for (const rue of rues) {
      const sorties = nombre(rue, 'sortante');
      const entrees = nombre(rue, 'entrante');
      for (let s = 0; s < sorties && arrivee; s++) {
        liaisons.push({ de: `${arrivee.code}:e${aligne(s, sorties, nArrivee)}`, vers: `${rue.code}:s${s}` });
      }
      for (let e = 0; e < entrees && depart; e++) {
        liaisons.push({ de: `${rue.code}:e${e}`, vers: `${depart.code}:s${aligne(e, entrees, nDepart)}` });
      }
    }
  });
  return liaisons;
}

/**
 * Azimut de chaque voie d'un giratoire (clé de voie → °), pour lire le sens des mouvements à
 * un nœud. Rues : de leur bout côté anneau vers leur bout éloigné. Tronçons : la tangente de
 * l'anneau au nœud, vers l'amont pour le tronçon qui arrive, vers l'aval pour celui qui part
 * (continuer sur l'anneau est un tout-droit).
 */
export function azimutsVoiesGiratoire(
  branches: ReadonlyArray<{
    code: string;
    noeud?: string | null;
    troncon?: boolean;
    voies: ReadonlyArray<{ sens: 'entrante' | 'sortante'; rang: number; geom: Segment }>;
  }>,
  anneau: Anneau | null,
): Map<string, number> {
  const azimuts = new Map<string, number>();
  if (!anneau) return azimuts;
  for (const b of branches) {
    if (!b.noeud || b.troncon) continue;
    for (const v of b.voies) azimuts.set(cleVoie(b.code, v.sens, v.rang), azimutSegment(v.geom));
  }
  anneau.noeuds.forEach((noeud, i) => {
    const precedent = anneau.noeuds[(i - 1 + anneau.noeuds.length) % anneau.noeuds.length]!;
    const arrivee = branches.find((b) => b.troncon && b.noeud === precedent.code);
    const depart = branches.find((b) => b.troncon && b.noeud === noeud.code);
    const avant = arrivee?.voies.find((v) => v.sens === 'entrante');
    const apres = depart?.voies.find((v) => v.sens === 'sortante');
    if (!avant || !apres) return;
    const tangente = azimutSegment([avant.geom[0], apres.geom[0]]);
    for (const v of arrivee!.voies) if (v.sens === 'entrante') azimuts.set(cleVoie(arrivee!.code, v.sens, v.rang), (tangente + 180) % 360);
    for (const v of depart!.voies) if (v.sens === 'sortante') azimuts.set(cleVoie(depart!.code, v.sens, v.rang), tangente);
  });
  return azimuts;
}
