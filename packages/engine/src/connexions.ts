/**
 * Connexions entre voies (à la « lane connector » de TM:PE) : d'une voie entrante vers une
 * voie sortante. Flèches et mouvements s'en déduisent — docs/CONFIGURATION.md §3.
 */
import { directionMouvement, type Direction } from './branches.js';
import { repereLocal, type Segment } from './geometrie.js';

export type SensVoie = 'entrante' | 'sortante';

export interface Connexion {
  /** Clé de la voie entrante, par exemple « S:e0 ». */
  de: string;
  /** Clé de la voie sortante, par exemple « O:s1 ». */
  vers: string;
}

/** Clé d'une voie : branche, sens (e / s) et rang, par exemple « S:e0 ». */
export const cleVoie = (branche: string, sens: SensVoie, rang: number) =>
  `${branche}:${sens === 'entrante' ? 'e' : 's'}${rang}`;

export function lireCleVoie(cle: string): { branche: string; sens: SensVoie; rang: number } | null {
  const correspondance = /^([A-Z0-9]{1,4}):([es])(\d)$/.exec(cle);
  if (!correspondance) return null;
  const [, branche, sens, rang] = correspondance;
  return { branche: branche!, sens: sens === 'e' ? 'entrante' : 'sortante', rang: Number(rang) };
}

export const cleConnexion = (c: Connexion) => `${c.de}>${c.vers}`;

export interface MouvementDeduit {
  origine: string;
  destination: string;
  direction: Direction;
  /** Rangs des voies entrantes qui ont une connexion pour ce mouvement. */
  voies: number[];
}

/** Azimut d'une voie, de son bout côté carrefour vers son bout éloigné (°). */
export function azimutSegment(segment: Segment): number {
  const [x, y] = repereLocal(segment[0]).versXY(segment[1]);
  return ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360;
}

/** Direction d'une connexion : d'après ses voies si leurs azimuts sont donnés, sinon d'après ses branches. */
function directionConnexion(
  connexion: Connexion,
  azimuts: ReadonlyMap<string, number>,
  azimutsVoies: ReadonlyMap<string, number>,
): Direction | null {
  const de = lireCleVoie(connexion.de);
  const vers = lireCleVoie(connexion.vers);
  if (!de || !vers) return null;
  const entree = azimutsVoies.get(connexion.de) ?? azimuts.get(de.branche);
  const sortie = azimutsVoies.get(connexion.vers) ?? azimuts.get(vers.branche);
  if (entree === undefined || sortie === undefined) return null;
  return directionMouvement(entree, sortie, de.branche === vers.branche);
}

/**
 * Mouvements (branche d'origine → branche de destination) déduits des connexions.
 * `azimutsVoies` : azimuts des voies de giratoire (voir `azimutsVoiesGiratoire`).
 */
export function mouvementsDepuisConnexions(
  branches: ReadonlyArray<{ code: string; azimut: number }>,
  connexions: readonly Connexion[],
  azimutsVoies: ReadonlyMap<string, number> = new Map(),
): MouvementDeduit[] {
  const azimuts = new Map(branches.map((b) => [b.code, b.azimut]));
  const parCle = new Map<string, MouvementDeduit>();
  for (const connexion of connexions) {
    const de = lireCleVoie(connexion.de);
    const vers = lireCleVoie(connexion.vers);
    const direction = directionConnexion(connexion, azimuts, azimutsVoies);
    if (!de || !vers || !direction) continue;
    const cle = `${de.branche}>${vers.branche}`;
    const mouvement = parCle.get(cle) ?? {
      origine: de.branche,
      destination: vers.branche,
      direction,
      voies: [],
    };
    if (!mouvement.voies.includes(de.rang)) mouvement.voies.push(de.rang);
    parCle.set(cle, mouvement);
  }
  const mouvements = [...parCle.values()];
  for (const m of mouvements) m.voies.sort((a, b) => a - b);
  return mouvements;
}

/** Flèches de chaque voie entrante, déduites de ses connexions (clé de voie → directions). */
export function flechesParVoie(
  branches: ReadonlyArray<{ code: string; azimut: number }>,
  connexions: readonly Connexion[],
  azimutsVoies: ReadonlyMap<string, number> = new Map(),
): Record<string, Direction[]> {
  const azimuts = new Map(branches.map((b) => [b.code, b.azimut]));
  const fleches: Record<string, Direction[]> = {};
  for (const connexion of connexions) {
    const direction = directionConnexion(connexion, azimuts, azimutsVoies);
    if (!direction) continue;
    const liste = (fleches[connexion.de] ??= []);
    if (!liste.includes(direction)) liste.push(direction);
  }
  const ordre: Direction[] = ['demi_tour', 'gauche', 'tout_droit', 'droite'];
  for (const liste of Object.values(fleches)) liste.sort((x, y) => ordre.indexOf(x) - ordre.indexOf(y));
  return fleches;
}

export interface BranchePourProposition {
  code: string;
  azimut: number;
  /** Flèches de chaque voie entrante, rang 0 = la plus à gauche (OSM ou par défaut). */
  fleches: ReadonlyArray<readonly Direction[]>;
  sortantes: number;
}

/**
 * Connexions proposées à partir des flèches : tourne-à-gauche vers la voie sortante la plus à
 * gauche, tourne-à-droite vers la plus à droite, tout droit voie par voie de gauche à droite.
 * Point de départ à corriger à la main.
 */
export function proposerConnexions(branches: readonly BranchePourProposition[]): Connexion[] {
  const connexions: Connexion[] = [];
  for (const origine of branches) {
    const toutDroit = origine.fleches.flatMap((f, rang) => (f.includes('tout_droit') ? [rang] : []));
    origine.fleches.forEach((directions, rang) => {
      for (const direction of directions) {
        const sorties = branches.filter(
          (b) =>
            b.sortantes > 0 &&
            directionMouvement(origine.azimut, b.azimut, b.code === origine.code) === direction,
        );
        for (const sortie of sorties) {
          const rangSortie =
            direction === 'droite'
              ? sortie.sortantes - 1
              : direction === 'tout_droit'
                ? Math.min(toutDroit.indexOf(rang), sortie.sortantes - 1)
                : 0;
          connexions.push({ de: cleVoie(origine.code, 'entrante', rang), vers: cleVoie(sortie.code, 'sortante', rangSortie) });
        }
      }
    });
  }
  return connexions;
}
