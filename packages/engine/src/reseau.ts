/**
 * Réseau routier — docs/RESEAU.md : voies d'une rue tout du long, liaisons voie à voie aux nœuds
 * et leurs valeurs par défaut.
 */
import { directionMouvement } from './branches.js';
import { LARGEUR_VOIE_M, LARGEUR_VOIE_VELO_M, repereLocal, type LonLat, type XY } from './geometrie.js';

/** Type d'une voie : générale, réservée aux bus, aux vélos ou au tram. */
export type TypeVoieReseau = 'generale' | 'bus' | 'velo' | 'tram';

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

/** Largeur d'une voie selon son type (m) : les voies vélo sont moins larges. */
export const largeurVoie = (type: TypeVoieReseau) => (type === 'velo' ? LARGEUR_VOIE_VELO_M : LARGEUR_VOIE_M);

/** Voies d'un tronçon, par sens, et leurs types. */
export interface VoiesParSens {
  voies_avant: number;
  voies_arriere: number;
  types_avant?: readonly TypeVoieReseau[] | null;
  types_arriere?: readonly TypeVoieReseau[] | null;
}

/** Largeur de la chaussée d'un tronçon, toutes voies comprises (m). */
export function largeurTroncon(t: VoiesParSens): number {
  const somme = (nombre: number, types: VoiesParSens['types_avant']) => typesVoies(nombre, types).reduce((s, type) => s + largeurVoie(type), 0);
  return somme(t.voies_avant, t.types_avant) + somme(t.voies_arriere, t.types_arriere);
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
 * centré sur l'axe. Chaque voie a la largeur de son type (`types`). Les bouts sont reculés de
 * `retraitDe` et `retraitVers` mètres, pour laisser la place aux liaisons du nœud (au plus 40 %
 * de la longueur chacun).
 */
export function voiesTroncon(
  points: readonly LonLat[],
  avant: number,
  arriere: number,
  retraitDe = 0,
  retraitVers = 0,
  types: { avant?: readonly TypeVoieReseau[] | null; arriere?: readonly TypeVoieReseau[] | null } = {},
): VoiesTroncon {
  const repere = repereLocal(points[0]!);
  const xy = points.map(repere.versXY);
  const longueur = longueurXY(xy);
  const axe = raccourcir(xy, Math.min(retraitDe, longueur * 0.4), Math.min(retraitVers, longueur * 0.4));
  const voie = (d: number) => decaler(axe, d).map(repere.versLonLat);
  /** Décalage (m) du milieu de chaque voie : côte à côte depuis l'axe, ou centrées sur lui. */
  const milieux = (nombre: number, typesSens: readonly TypeVoieReseau[] | null | undefined, centre: boolean) => {
    const largeurs = typesVoies(nombre, typesSens).map(largeurVoie);
    let bord = centre ? -largeurs.reduce((s, l) => s + l, 0) / 2 : 0;
    return largeurs.map((l) => {
      const milieu = bord + l / 2;
      bord += l;
      return milieu;
    });
  };
  return {
    avant: milieux(avant, types.avant, arriere === 0).map(voie),
    arriere: milieux(arriere, types.arriere, avant === 0).map((d) => voie(-d).reverse()),
  };
}

/** Recul (m) des voies au bout d'un tronçon, selon le nœud et la plus large de ses rues (m) : rien à un cul-de-sac. */
export function retraitAuNoeud(degre: number, largeurMax: number): number {
  if (degre <= 1) return 0;
  return degre === 2 ? 3 : 4 + largeurMax * 0.6;
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
  /** Type de chaque voie qui arrive, puis qui repart (rang 0 = la plus à gauche). */
  types_arrivent: TypeVoieReseau[];
  types_repartent: TypeVoieReseau[];
}

/** Liaison d'une voie qui arrive au nœud vers une voie qui en repart (rangs dans chaque sens). */
export interface Liaison {
  de: string;
  voie_de: number;
  vers: string;
  voie_vers: number;
}

/** Types des `nombre` voies d'un sens : ceux saisis, complétés par des voies générales. */
export function typesVoies(nombre: number, types: readonly TypeVoieReseau[] | null | undefined): TypeVoieReseau[] {
  return Array.from({ length: nombre }, (_, rang) => types?.[rang] ?? 'generale');
}

/** Tronçons qui touchent le nœud, avec leurs voies et leur direction (mesurée à 10 m). */
export function boutsAuNoeud(
  noeud: string,
  troncons: ReadonlyArray<{
    id: string;
    noeud_de: string;
    noeud_vers: string;
    points: readonly LonLat[];
    voies_avant: number;
    voies_arriere: number;
    types_avant?: readonly TypeVoieReseau[] | null;
    types_arriere?: readonly TypeVoieReseau[] | null;
  }>,
): BoutAuNoeud[] {
  return troncons.flatMap((t) =>
    (['de', 'vers'] as const)
      .filter((extremite) => (extremite === 'de' ? t.noeud_de : t.noeud_vers) === noeud)
      .map((extremite): BoutAuNoeud => {
        const depuis = extremite === 'de' ? t.points : [...t.points].reverse();
        const repere = repereLocal(depuis[0]!);
        const xy = depuis.map(repere.versXY);
        const loin = raccourcir(xy, Math.min(10, longueurXY(xy) * 0.9), 0)[0]!;
        // Au bout `vers`, les voies du sens du tracé arrivent ; au bout `de`, elles repartent.
        const avant = typesVoies(t.voies_avant, t.types_avant);
        const arriere = typesVoies(t.voies_arriere, t.types_arriere);
        const [arrivent, repartent] = extremite === 'vers' ? [avant, arriere] : [arriere, avant];
        return {
          troncon: t.id,
          extremite,
          azimut: ((Math.atan2(loin[0], loin[1]) * 180) / Math.PI + 360) % 360,
          arrivent: arrivent.length,
          repartent: repartent.length,
          types_arrivent: arrivent,
          types_repartent: repartent,
        };
      }),
  );
}

/** Rangs des voies d'un type (vélo) ou des autres (circulation générale, bus, tram). */
const rangs = (types: readonly TypeVoieReseau[], velo: boolean) =>
  types.flatMap((type, rang) => ((type === 'velo') === velo ? [rang] : []));

/** Paires proposées entre deux groupes de voies, selon la direction du mouvement. */
function paires(sources: readonly number[], cibles: readonly number[], direction: string, prolongement: boolean): Array<[number, number]> {
  if (sources.length === 0 || cibles.length === 0) return [];
  const indices: Array<[number, number]> =
    prolongement || direction === 'tout_droit'
      ? liensParDefaut(sources.length, cibles.length)
      : direction === 'gauche'
        ? [[0, 0]]
        : [[sources.length - 1, cibles.length - 1]];
  return indices.map(([i, j]) => [sources[i]!, cibles[j]!]);
}

/**
 * Liaisons proposées à un nœud, comme les connexions d'un carrefour : tout droit voie à voie,
 * tourne-à-gauche depuis la voie de gauche vers la voie de gauche, tourne-à-droite de droite à
 * droite ; pas de demi-tour (pas même vers l'autre chaussée d'un boulevard). Deux tronçons seuls
 * se prolongent voie à voie. Les voies vélo se
 * relient entre elles ; sans voie vélo en face, un vélo rejoint la voie de droite (de gauche
 * pour tourner à gauche), et une piste cyclable part de la voie de droite d'une rue sans voie
 * vélo. Les voitures ne sont jamais envoyées sur une voie vélo.
 */
export function liaisonsParDefaut(bouts: readonly BoutAuNoeud[]): Liaison[] {
  const liaisons: Liaison[] = [];
  const prolongement = bouts.length === 2;
  for (const a of bouts) {
    if (a.arrivent === 0) continue;
    for (const b of bouts) {
      if (b === a || b.repartent === 0 || b.troncon === a.troncon) continue;
      const direction = directionMouvement(a.azimut, b.azimut);
      if (direction === 'demi_tour' && !prolongement) continue;
      const [motA, motB] = [rangs(a.types_arrivent, false), rangs(b.types_repartent, false)];
      const [veloA, veloB] = [rangs(a.types_arrivent, true), rangs(b.types_repartent, true)];
      const liste = paires(motA, motB, direction, prolongement);
      if (veloA.length > 0 && veloB.length > 0) liste.push(...paires(veloA, veloB, direction, prolongement));
      else if (veloA.length > 0 && motB.length > 0) {
        for (const i of veloA) liste.push([i, direction === 'gauche' ? motB[0]! : motB.at(-1)!]);
      } else if (veloB.length > 0 && motB.length === 0 && motA.length > 0) {
        liste.push([motA.at(-1)!, direction === 'gauche' ? veloB[0]! : veloB.at(-1)!]);
      }
      for (const [i, j] of liste) liaisons.push({ de: a.troncon, voie_de: i, vers: b.troncon, voie_vers: j });
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
