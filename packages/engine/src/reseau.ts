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

/**
 * Polyligne décalée de `d` mètres sur sa droite (d < 0 : sur sa gauche), angles en onglet borné ;
 * `d` peut varier d'un sommet à l'autre (un décalage par sommet).
 */
function decaler(points: readonly XY[], d: number | readonly number[]): XY[] {
  const ecart = (i: number) => (typeof d === 'number' ? d : d[i]!);
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
    if (n < 1e-9) return [p[0] + avant[0] * ecart(i), p[1] + avant[1] * ecart(i)];
    const moyenne: XY = [somme[0] / n, somme[1] / n];
    const cos = Math.max(0.5, moyenne[0] * apres[0] + moyenne[1] * apres[1]);
    return [p[0] + (moyenne[0] * ecart(i)) / cos, p[1] + (moyenne[1] * ecart(i)) / cos];
  });
}

// ── Place visuelle du bout d'une voie (docs/voies-position-visuelle.md) ──

/**
 * Place d'un bout de voie à un nœud, dans le repère de la voie : `recul` (m) le long de la voie,
 * vers l'intérieur de la rue (< 0 : la voie s'allonge au-delà de son bout), `decalage` (m) de
 * côté, positif à droite du sens de circulation. `decalage_loin` : décalage au bout éloigné du
 * bloc (`LONGUEUR_BLOC_PLACE_M`), qui fait pivoter le bloc ; absent : égal à `decalage` (le bloc
 * glisse parallèlement à la rue). Ne sert qu'au dessin : le graphe et SUMO l'ignorent.
 */
export interface PlacementVoie {
  recul: number;
  decalage: number;
  decalage_loin?: number;
}

/** Longueur (m) du bloc de voie déplacé d'un tenant depuis son bout, comme l'axe d'une branche. */
export const LONGUEUR_BLOC_PLACE_M = 40;
/** Longueur (m) sur laquelle la voie rejoint sa place dans la rue, au-delà du bloc. */
export const TRANSITION_PLACEMENT_M = 10;
/** Une voie placée garde au moins cette longueur (m). */
const LONGUEUR_MIN_PLACEE_M = 1;

/** Point à `distance` mètres du début de la polyligne inséré comme sommet (s'il tombe dedans). */
function avecSommetA(points: readonly XY[], distance: number): XY[] {
  let cumul = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const [a, b] = [points[i]!, points[i + 1]!];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (distance > cumul + 1e-6 && distance < cumul + l - 1e-6) {
      const t = (distance - cumul) / l;
      return [...points.slice(0, i + 1), [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], ...points.slice(i + 1)];
    }
    cumul += l;
  }
  return [...points];
}

/** Point à `distance` mètres du début de la polyligne, et direction unitaire de la polyligne en ce point. */
function pointA(points: readonly XY[], distance: number): { point: XY; direction: XY } {
  let reste = Math.max(0, distance);
  for (let i = 0; i < points.length - 1; i++) {
    const [a, b] = [points[i]!, points[i + 1]!];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (l === 0) continue;
    const direction: XY = [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
    if (reste <= l || i === points.length - 2) {
      const t = Math.min(reste, l);
      return { point: [a[0] + direction[0] * t, a[1] + direction[1] * t], direction };
    }
    reste -= l;
  }
  return { point: points.at(-1)!, direction: [0, 1] };
}

/** Direction unitaire du bout de la polyligne vers l'intérieur, mesurée sur ses `portee` premiers mètres. */
function directionInterieure(points: readonly XY[], portee = 5): XY {
  const loin = raccourcir(points, Math.min(portee, longueurXY(points) * 0.9), 0)[0]!;
  const [dx, dy] = [loin[0] - points[0]![0], loin[1] - points[0]![1]];
  const l = Math.hypot(dx, dy) || 1;
  return [dx / l, dy / l];
}

const placementVide = (p: PlacementVoie | null | undefined) =>
  !p || (p.recul === 0 && p.decalage === 0 && (p.decalage_loin === undefined || p.decalage_loin === 0));

/**
 * Voie parcourue depuis son bout au nœud, dans un repère local au bout, reculée ou allongée de
 * `recul` : la base des placements. `signe` passe d'un décalage « à droite de la circulation » à
 * « à droite du parcours » (la circulation va vers le nœud quand la voie y arrive).
 */
function depuisLeBout(points: readonly LonLat[], bout: 'debut' | 'fin', recul: number) {
  const depuis = bout === 'debut' ? points : [...points].reverse();
  const repere = repereLocal(depuis[0]!);
  let xy = depuis.map(repere.versXY);
  const r = Math.min(recul, longueurXY(xy) - LONGUEUR_MIN_PLACEE_M);
  if (r > 0) xy = raccourcir(xy, r, 0);
  else if (r < 0) {
    const [ux, uy] = directionInterieure(xy);
    xy = [[xy[0]![0] + ux * r, xy[0]![1] + uy * r], ...xy];
  }
  const bloc = Math.min(LONGUEUR_BLOC_PLACE_M, longueurXY(xy));
  return { repere, xy, bloc, signe: bout === 'debut' ? 1 : -1 };
}

/**
 * Voie dessinée avec son bout placé : `points` dans le sens de circulation, `bout` celui qui est
 * au nœud (`debut` : la voie en repart, `fin` : elle y arrive). Le bout recule ou s'allonge de
 * `recul` le long de la voie ; les `LONGUEUR_BLOC_PLACE_M` premiers mètres glissent de côté de
 * `decalage` au bout à `decalage_loin` au bout éloigné du bloc (un pivot), puis la voie rejoint
 * sa place sur `TRANSITION_PLACEMENT_M`. Une voie plus courte que le bloc est déplacée en entier.
 */
export function placerBoutVoie(points: readonly LonLat[], bout: 'debut' | 'fin', placement: PlacementVoie | null | undefined): LonLat[] {
  if (placementVide(placement) || points.length < 2) return [...points];
  const p = placement!;
  const { repere, xy: base, bloc, signe } = depuisLeBout(points, bout, p.recul);
  const [proche, loin] = [p.decalage * signe, (p.decalage_loin ?? p.decalage) * signe];
  let xy = base;
  if (proche !== 0 || loin !== 0) {
    xy = avecSommetA(avecSommetA(base, bloc), bloc + TRANSITION_PLACEMENT_M);
    const ecarts: number[] = [];
    let cumul = 0;
    xy.forEach((q, i) => {
      if (i > 0) cumul += Math.hypot(q[0] - xy[i - 1]![0], q[1] - xy[i - 1]![1]);
      ecarts.push(
        cumul <= bloc
          ? proche + ((loin - proche) * cumul) / (bloc || 1)
          : loin * Math.max(0, 1 - (cumul - bloc) / TRANSITION_PLACEMENT_M),
      );
    });
    xy = decaler(xy, ecarts);
  }
  const sortie = xy.map(repere.versLonLat);
  return bout === 'debut' ? sortie : sortie.reverse();
}

/**
 * Placement qui pose le bout d'une voie sur `cible` : `points` est la voie à sa place
 * automatique, dans le sens de circulation. Le déplacement est décomposé le long de la voie
 * (recul) et de côté (décalage), au centimètre ; le pivot du bloc (`decalage_loin - decalage`)
 * est gardé, le bloc se déplace d'un tenant.
 */
export function placementVers(points: readonly LonLat[], bout: 'debut' | 'fin', cible: LonLat, actuel?: PlacementVoie | null): PlacementVoie {
  const depuis = bout === 'debut' ? points : [...points].reverse();
  const repere = repereLocal(depuis[0]!);
  const [ux, uy] = directionInterieure(depuis.map(repere.versXY));
  const [x, y] = repere.versXY(cible);
  // Sens de circulation au bout : vers l'intérieur au départ, vers le nœud à l'arrivée ; sa droite.
  const [cx, cy] = bout === 'debut' ? [ux, uy] : [-ux, -uy];
  const recul = arrondiCm(x * ux + y * uy);
  const decalage = arrondiCm(x * cy - y * cx);
  const pivot = actuel?.decalage_loin !== undefined ? actuel.decalage_loin - actuel.decalage : 0;
  return pivot === 0 ? { recul, decalage } : { recul, decalage, decalage_loin: arrondiCm(decalage + pivot) };
}

const arrondiCm = (v: number) => Math.round(v * 100) / 100 || 0;

/** Bout éloigné du bloc placé : là où se tient la poignée de pivot. */
export function pointPivot(points: readonly LonLat[], bout: 'debut' | 'fin', placement: PlacementVoie | null | undefined): LonLat {
  const p = placement ?? { recul: 0, decalage: 0 };
  const { repere, xy, bloc, signe } = depuisLeBout(points, bout, p.recul);
  const { point, direction } = pointA(xy, bloc);
  const ecart = (p.decalage_loin ?? p.decalage) * signe;
  // À droite du parcours : (dy, -dx).
  return repere.versLonLat([point[0] + direction[1] * ecart, point[1] - direction[0] * ecart]);
}

/** Placement dont le bout éloigné du bloc est tiré vers `cible` (poignée de pivot) : seul `decalage_loin` change. */
export function pivotVers(points: readonly LonLat[], bout: 'debut' | 'fin', placement: PlacementVoie | null | undefined, cible: LonLat): PlacementVoie {
  const p = placement ?? { recul: 0, decalage: 0 };
  const { repere, xy, bloc, signe } = depuisLeBout(points, bout, p.recul);
  const { point, direction } = pointA(xy, bloc);
  const [x, y] = repere.versXY(cible);
  const lateral = (x - point[0]) * direction[1] - (y - point[1]) * direction[0];
  const loin = arrondiCm(lateral * signe);
  return loin === p.decalage ? { recul: p.recul, decalage: p.decalage } : { recul: p.recul, decalage: p.decalage, decalage_loin: loin };
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
