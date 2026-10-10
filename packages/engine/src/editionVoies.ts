/**
 * Édition d'un tronçon voie par voie (docs/pipeline-donnees.md, étapes 1 et 3) : une voie ajoutée
 * ou retirée à un rang décale les types, les emprises et les liaisons saisies aux deux bouts du
 * tronçon ; l'emprise d'une voie, polygone posé sur le marquage de la photo, donne sa largeur
 * réelle.
 */
import { repereLocal, type LonLat, type XY } from './geometrie.js';
import { placerBoutVoie, typesVoies, type Liaison, type PlacementVoie, type TypeVoieReseau, type VoiesTroncon } from './reseau.js';

/** Sens d'un tronçon : `avant` de `noeud_de` vers `noeud_vers`, `arriere` dans l'autre sens. */
export type SensVoieTroncon = 'avant' | 'arriere';

/** Emprises des voies d'un tronçon, par clé `avant:0`, `arriere:1`… */
export type EmprisesTroncon = Record<string, LonLat[]>;

export const cleEmprise = (sens: SensVoieTroncon, rang: number) => `${sens}:${rang}`;

/** Types d'un sens après l'ajout d'une voie au rang `rang` (0 = la plus à gauche du conducteur). */
export function insererType(nombre: number, types: readonly TypeVoieReseau[] | null | undefined, rang: number, type: TypeVoieReseau): TypeVoieReseau[] {
  const liste = typesVoies(nombre, types);
  liste.splice(Math.min(Math.max(rang, 0), nombre), 0, type);
  return liste;
}

/** Types d'un sens après le retrait de la voie de rang `rang`. */
export function retirerType(nombre: number, types: readonly TypeVoieReseau[] | null | undefined, rang: number): TypeVoieReseau[] {
  return typesVoies(nombre, types).filter((_, i) => i !== rang);
}

/**
 * Rang d'une voie après l'ajout (+1) ou le retrait (−1) d'une voie au rang `rang` du même sens ;
 * null pour la voie retirée elle-même.
 */
function rangDecale(actuel: number, rang: number, decalage: 1 | -1): number | null {
  if (decalage === 1) return actuel >= rang ? actuel + 1 : actuel;
  if (actuel === rang) return null;
  return actuel > rang ? actuel - 1 : actuel;
}

/** Emprises d'un tronçon après l'ajout ou le retrait d'une voie : celles du même sens suivent leur voie. */
export function decalerEmprises(
  emprises: Readonly<EmprisesTroncon> | null | undefined,
  sens: SensVoieTroncon,
  rang: number,
  decalage: 1 | -1,
): EmprisesTroncon | null {
  if (!emprises) return null;
  const suivantes: EmprisesTroncon = {};
  for (const [cle, polygone] of Object.entries(emprises)) {
    const [s, r] = cle.split(':') as [SensVoieTroncon, string];
    if (s !== sens) {
      suivantes[cle] = polygone;
      continue;
    }
    const nouveau = rangDecale(Number(r), rang, decalage);
    if (nouveau !== null) suivantes[cleEmprise(s, nouveau)] = polygone;
  }
  return Object.keys(suivantes).length > 0 ? suivantes : null;
}

/**
 * Liaisons saisies à un nœud après l'ajout ou le retrait d'une voie sur un tronçon qui y touche.
 * `role` : les voies du sens modifié `arrivent` au nœud (liaisons qui en partent, `de`), ou en
 * `repartent` (liaisons qui y mènent, `vers`). Celles de la voie retirée disparaissent. null
 * (liaisons proposées par défaut) reste null : elles se recalculent.
 */
export function decalerLiaisons(
  liaisons: readonly Liaison[] | null,
  troncon: string,
  role: 'arrivent' | 'repartent',
  rang: number,
  decalage: 1 | -1,
): Liaison[] | null {
  if (!liaisons) return null;
  return liaisons.flatMap((l) => {
    if (role === 'arrivent' && l.de === troncon) {
      const voie = rangDecale(l.voie_de, rang, decalage);
      return voie === null ? [] : [{ ...l, voie_de: voie }];
    }
    if (role === 'repartent' && l.vers === troncon) {
      const voie = rangDecale(l.voie_vers, rang, decalage);
      return voie === null ? [] : [{ ...l, voie_vers: voie }];
    }
    return [l];
  });
}

/**
 * Nœud où arrivent les voies d'un sens, et nœud d'où elles repartent : `avant` va de `noeud_de`
 * vers `noeud_vers`, `arriere` en sens inverse.
 */
export function boutsDuSens(t: { noeud_de: string; noeud_vers: string }, sens: SensVoieTroncon): { arrivent: string; repartent: string } {
  return sens === 'avant' ? { arrivent: t.noeud_vers, repartent: t.noeud_de } : { arrivent: t.noeud_de, repartent: t.noeud_vers };
}

/** Projection d'un point sur une polyligne plane : abscisse curviligne et côté (> 0 : à droite). */
function projeterXY(axe: readonly XY[], p: XY): { abscisse: number; cote: number; distance: number } {
  let meilleure = { abscisse: 0, cote: 0, distance: Infinity };
  let cumul = 0;
  for (let i = 0; i < axe.length - 1; i++) {
    const a = axe[i]!;
    const b = axe[i + 1]!;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy;
    const l = Math.sqrt(l2);
    const t = l2 > 0 ? Math.min(Math.max(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2, 0), 1) : 0;
    const distance = Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
    if (distance < meilleure.distance) {
      // Produit vectoriel (direction × point) : négatif quand le point est à droite du tracé.
      const vectoriel = dx * (p[1] - a[1]) - dy * (p[0] - a[0]);
      meilleure = { abscisse: cumul + t * l, cote: -vectoriel, distance };
    }
    cumul += l;
  }
  return meilleure;
}

/**
 * Sens des voies du côté de l'axe où l'on a cliqué : circulation à droite, les voies `avant`
 * sont à droite du tracé, les voies `arriere` à gauche. Un sens unique a toutes ses voies d'un
 * même sens, quel que soit le côté.
 */
export function sensDuCote(points: readonly LonLat[], position: LonLat, t: { voies_avant: number; voies_arriere: number }): SensVoieTroncon {
  if (t.voies_arriere === 0) return 'avant';
  if (t.voies_avant === 0) return 'arriere';
  const repere = repereLocal(points[0]!);
  return projeterXY(points.map(repere.versXY), repere.versXY(position)).cote >= 0 ? 'avant' : 'arriere';
}

/** Aire d'un polygone plan (m²), quel que soit le sens de ses sommets. */
function aire(polygone: readonly XY[]): number {
  let somme = 0;
  for (let i = 0; i < polygone.length; i++) {
    const [x1, y1] = polygone[i]!;
    const [x2, y2] = polygone[(i + 1) % polygone.length]!;
    somme += x1 * y2 - x2 * y1;
  }
  return Math.abs(somme) / 2;
}

/**
 * Largeur moyenne (m) d'une emprise le long d'un axe : son aire divisée par la longueur d'axe
 * qu'elle couvre (de la première à la dernière projection de ses sommets). null si l'emprise ne
 * couvre aucune longueur d'axe.
 */
export function largeurEmprise(polygone: readonly LonLat[], axe: readonly LonLat[]): number | null {
  if (polygone.length < 3 || axe.length < 2) return null;
  const repere = repereLocal(axe[0]!);
  const axeXY = axe.map(repere.versXY);
  const sommets = polygone.map(repere.versXY);
  const abscisses = sommets.map((p) => projeterXY(axeXY, p).abscisse);
  const longueur = Math.max(...abscisses) - Math.min(...abscisses);
  if (longueur < 0.5) return null;
  return aire(sommets) / longueur;
}

/**
 * Emprises d'un tronçon coupé à la fraction `fraction` de sa longueur : chacune va à la moitié
 * où tombe le milieu de ses sommets.
 */
export function partagerEmprises(
  emprises: Readonly<EmprisesTroncon> | null | undefined,
  axe: readonly LonLat[],
  fraction: number,
): [EmprisesTroncon | null, EmprisesTroncon | null] {
  if (!emprises || axe.length < 2) return [emprises ? { ...emprises } : null, null];
  const repere = repereLocal(axe[0]!);
  const axeXY = axe.map(repere.versXY);
  const longueur = axeXY.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - axeXY[i]![0], p[1] - axeXY[i]![1]), 0);
  const moities: [EmprisesTroncon, EmprisesTroncon] = [{}, {}];
  for (const [cle, polygone] of Object.entries(emprises)) {
    const sommets = polygone.map(repere.versXY);
    const milieu: XY = [sommets.reduce((s, p) => s + p[0], 0) / sommets.length, sommets.reduce((s, p) => s + p[1], 0) / sommets.length];
    const moitie = longueur > 0 && projeterXY(axeXY, milieu).abscisse / longueur > fraction ? 1 : 0;
    moities[moitie][cle] = polygone;
  }
  const ouNull = (e: EmprisesTroncon) => (Object.keys(e).length > 0 ? e : null);
  return [ouNull(moities[0]), ouNull(moities[1])];
}

/** Emprises d'un tronçon retourné : ses voies avant deviennent arrière, et inversement. */
export function inverserEmprises(emprises: Readonly<EmprisesTroncon> | null | undefined): EmprisesTroncon | null {
  if (!emprises) return null;
  return Object.fromEntries(
    Object.entries(emprises).map(([cle, polygone]) => [cle.startsWith('avant:') ? cle.replace('avant:', 'arriere:') : cle.replace('arriere:', 'avant:'), polygone]),
  );
}

// ── Places visuelles des bouts de voies à un nœud (docs/voies-position-visuelle.md) ──

/** Places des bouts de voies d'un nœud, par clé `<tronçon>:avant:0`, `<tronçon>:arriere:1`… */
export type PlacementsVoies = Record<string, PlacementVoie>;

export const clePlacement = (troncon: string, sens: SensVoieTroncon, rang: number) => `${troncon}:${cleEmprise(sens, rang)}`;

/** Tronçon, sens et rang d'une clé de placement ; null si elle est mal formée. */
export function lireClePlacement(cle: string): { troncon: string; sens: SensVoieTroncon; rang: number } | null {
  const morceaux = /^(.+):(avant|arriere):(\d)$/.exec(cle);
  return morceaux ? { troncon: morceaux[1]!, sens: morceaux[2] as SensVoieTroncon, rang: Number(morceaux[3]) } : null;
}

/** Réécrit les clés des placements ; `changer` rend la nouvelle clé, ou null pour retirer le placement. null si plus rien. */
function reecrirePlacements(
  placements: Readonly<PlacementsVoies> | null | undefined,
  changer: (cle: { troncon: string; sens: SensVoieTroncon; rang: number }) => string | null,
): PlacementsVoies | null {
  if (!placements) return null;
  const suivants: PlacementsVoies = {};
  for (const [cle, placement] of Object.entries(placements)) {
    const lue = lireClePlacement(cle);
    const nouvelle = lue ? changer(lue) : cle;
    if (nouvelle !== null) suivants[nouvelle] = placement;
  }
  return Object.keys(suivants).length > 0 ? suivants : null;
}

/** Placements d'un nœud après l'ajout ou le retrait d'une voie du tronçon : ceux du même sens suivent leur voie. */
export function decalerPlacements(
  placements: Readonly<PlacementsVoies> | null | undefined,
  troncon: string,
  sens: SensVoieTroncon,
  rang: number,
  decalage: 1 | -1,
): PlacementsVoies | null {
  return reecrirePlacements(placements, (c) => {
    if (c.troncon !== troncon || c.sens !== sens) return clePlacement(c.troncon, c.sens, c.rang);
    const nouveau = rangDecale(c.rang, rang, decalage);
    return nouveau === null ? null : clePlacement(c.troncon, c.sens, nouveau);
  });
}

/**
 * Placements d'un nœud après l'inversion du tronçon : ses voies avant deviennent arrière. Le
 * rang et le décalage, comptés dans le sens de circulation, ne changent pas.
 */
export function inverserPlacements(placements: Readonly<PlacementsVoies> | null | undefined, troncon: string): PlacementsVoies | null {
  return reecrirePlacements(placements, (c) =>
    clePlacement(c.troncon, c.troncon === troncon ? (c.sens === 'avant' ? 'arriere' : 'avant') : c.sens, c.rang),
  );
}

/**
 * Placements d'un nœud quand un tronçon y est remplacé par un autre (coupe, fusion) ; `inverser` :
 * le nouveau tronçon est tracé dans l'autre sens, ses voies avant sont les arrière de l'ancien.
 */
export function renommerPlacements(
  placements: Readonly<PlacementsVoies> | null | undefined,
  ancien: string,
  nouveau: string,
  inverser = false,
): PlacementsVoies | null {
  return reecrirePlacements(placements, (c) => {
    if (c.troncon !== ancien) return clePlacement(c.troncon, c.sens, c.rang);
    return clePlacement(nouveau, inverser ? (c.sens === 'avant' ? 'arriere' : 'avant') : c.sens, c.rang);
  });
}

/** Placements d'un nœud sans ceux d'un tronçon (supprimé, ou qui n'y touche plus). */
export function retirerPlacements(placements: Readonly<PlacementsVoies> | null | undefined, troncon: string): PlacementsVoies | null {
  return reecrirePlacements(placements, (c) => (c.troncon === troncon ? null : clePlacement(c.troncon, c.sens, c.rang)));
}

/**
 * Voies d'un tronçon (`voiesTroncon`) avec les bouts placés à chacun de ses nœuds : une voie
 * avant part de `noeud_de` et arrive à `noeud_vers`, une voie arrière l'inverse.
 */
export function placerVoiesTroncon(
  voies: VoiesTroncon,
  troncon: string,
  placementsDe: Readonly<PlacementsVoies> | null | undefined,
  placementsVers: Readonly<PlacementsVoies> | null | undefined,
): VoiesTroncon {
  if (!placementsDe && !placementsVers) return voies;
  const placer = (sens: SensVoieTroncon, depart: typeof placementsDe, arrivee: typeof placementsDe) => (points: LonLat[], rang: number) => {
    const cle = clePlacement(troncon, sens, rang);
    return placerBoutVoie(placerBoutVoie(points, 'debut', depart?.[cle]), 'fin', arrivee?.[cle]);
  };
  return {
    avant: voies.avant.map(placer('avant', placementsDe, placementsVers)),
    arriere: voies.arriere.map(placer('arriere', placementsVers, placementsDe)),
  };
}
