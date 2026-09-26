/**
 * Géométrie des carrefours : branches, voies, mouvements — docs/CONFIGURATION.md §2 et §3.
 *
 * Azimut : degrés, sens horaire depuis le nord, du centre du carrefour vers la branche.
 * Rang d'une voie : 0 = la plus à gauche dans le sens d'arrivée.
 */

export const DIRECTIONS = ['gauche', 'tout_droit', 'droite', 'demi_tour'] as const;
export type Direction = (typeof DIRECTIONS)[number];

export type SensBranche = 'entrant' | 'sortant' | 'double';

/** Écart d'angle maximal (°) pour qu'un mouvement soit considéré « tout droit ». */
export const TOLERANCE_TOUT_DROIT = 35;

/** Ramène un angle dans ]−180, 180]. */
export function normaliserAngle(angle: number): number {
  const a = ((angle % 360) + 360) % 360;
  return a > 180 ? a - 360 : a;
}

const CARDINAUX = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'] as const;

export function codeCardinal(azimut: number): (typeof CARDINAUX)[number] {
  const a = ((azimut % 360) + 360) % 360;
  return CARDINAUX[Math.round(a / 45) % 8]!;
}

/** Codes cardinaux uniques pour une liste d'azimuts : N, E, N2… */
export function codesBranches(azimuts: readonly number[]): string[] {
  const vus = new Map<string, number>();
  return azimuts.map((azimut) => {
    const base = codeCardinal(azimut);
    const n = (vus.get(base) ?? 0) + 1;
    vus.set(base, n);
    return n === 1 ? base : `${base}${n}`;
  });
}

/**
 * Direction du mouvement entre une branche d'entrée et une branche de sortie.
 * Angle de braquage t = azimut de sortie − (azimut d'entrée + 180°).
 */
export function directionMouvement(azimutEntree: number, azimutSortie: number, memeBranche = false): Direction {
  if (memeBranche) return 'demi_tour';
  const t = normaliserAngle(azimutSortie - (azimutEntree + 180));
  if (Math.abs(t) <= TOLERANCE_TOUT_DROIT) return 'tout_droit';
  return t > 0 ? 'droite' : 'gauche';
}

const FLECHES_OSM: Record<string, Direction> = {
  left: 'gauche',
  slight_left: 'gauche',
  sharp_left: 'gauche',
  through: 'tout_droit',
  right: 'droite',
  slight_right: 'droite',
  sharp_right: 'droite',
  reverse: 'demi_tour',
};

/**
 * Lit une valeur OSM `turn:lanes` (« left|through;right ») : une liste de voies, de gauche à
 * droite, chacune avec ses flèches. `none`, vide ou `merge_to_*` : aucune flèche connue.
 */
export function lireTurnLanes(valeur: string): Direction[][] {
  return valeur.split('|').map((voie) => {
    const fleches = voie
      .split(';')
      .map((f) => FLECHES_OSM[f.trim()])
      .filter((f): f is Direction => f !== undefined);
    return [...new Set(fleches)];
  });
}

/**
 * Flèches par défaut quand OSM n'en donne pas : voie unique = toutes directions ; sinon
 * gauche + tout droit à gauche, tout droit au milieu, tout droit + droite à droite.
 */
export function voiesParDefaut(nombre: number): Direction[][] {
  if (nombre <= 0) return [];
  if (nombre === 1) return [['gauche', 'tout_droit', 'droite']];
  return Array.from({ length: nombre }, (_, rang): Direction[] =>
    rang === 0 ? ['gauche', 'tout_droit'] : rang === nombre - 1 ? ['tout_droit', 'droite'] : ['tout_droit'],
  );
}

export interface BrancheGeometrie {
  code: string;
  azimut: number;
  sens: SensBranche;
  voies: ReadonlyArray<{ rang: number; mouvements: readonly Direction[] }>;
}

export interface MouvementCalcule {
  origine: string;
  destination: string;
  direction: Direction;
  /** Rangs des voies d'entrée qui permettent ce mouvement. */
  voies: number[];
}

export interface AlerteFleche {
  branche: string;
  rang: number;
  direction: Direction;
}

const entre = (b: BrancheGeometrie) => b.sens !== 'sortant';
const sort = (b: BrancheGeometrie) => b.sens !== 'entrant';

/**
 * Mouvements permis par les flèches des voies entrantes. Une flèche « gauche » alimente
 * toutes les sorties classées à gauche. Une flèche sans sortie correspondante donne une alerte.
 */
export function calculerMouvements(branches: readonly BrancheGeometrie[]): {
  mouvements: MouvementCalcule[];
  alertes: AlerteFleche[];
} {
  const parCle = new Map<string, MouvementCalcule>();
  const alertes: AlerteFleche[] = [];

  for (const origine of branches.filter(entre)) {
    for (const voie of origine.voies) {
      for (const direction of voie.mouvements) {
        const sorties = branches.filter(
          (destination) =>
            sort(destination) &&
            directionMouvement(origine.azimut, destination.azimut, destination.code === origine.code) === direction,
        );
        if (sorties.length === 0) alertes.push({ branche: origine.code, rang: voie.rang, direction });
        for (const destination of sorties) {
          const cle = `${origine.code}>${destination.code}`;
          const mouvement = parCle.get(cle) ?? { origine: origine.code, destination: destination.code, direction, voies: [] };
          if (!mouvement.voies.includes(voie.rang)) mouvement.voies.push(voie.rang);
          parCle.set(cle, mouvement);
        }
      }
    }
  }

  const mouvements = [...parCle.values()];
  for (const m of mouvements) m.voies.sort((a, b) => a - b);
  return { mouvements, alertes };
}
