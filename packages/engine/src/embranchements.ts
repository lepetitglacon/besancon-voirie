/**
 * Embranchements d'un nœud, à la manière des « junction restrictions » de TM:PE
 * (docs/pipeline-donnees.md, étape 9) : pour chaque rue qui arrive, les rues où elle peut aller.
 * Une rue peut aller vers une autre dès qu'au moins une liaison voie à voie les relie ; autoriser
 * un embranchement ajoute les liaisons qu'en proposerait la règle par défaut, l'interdire retire
 * toutes celles de l'une vers l'autre.
 */
import { directionMouvement, type Direction } from './branches.js';
import { cleVoie } from './connexions.js';
import { liaisonsParDefaut, liensParDefaut, type BoutAuNoeud, type Liaison } from './reseau.js';

export interface Embranchement {
  /** Tronçon où l'on va. */
  vers: string;
  direction: Direction;
  autorise: boolean;
  /** Nombre de liaisons voie à voie de l'un vers l'autre. */
  liaisons: number;
}

/** Pour chaque tronçon qui arrive au nœud (au moins une voie), les tronçons où l'on peut repartir. */
export function embranchements(bouts: readonly BoutAuNoeud[], liaisons: readonly Liaison[]): Array<{ de: string; vers: Embranchement[] }> {
  return bouts
    .filter((a) => a.arrivent > 0)
    .map((a) => ({
      de: a.troncon,
      vers: bouts
        .filter((b) => b.repartent > 0)
        .map((b) => {
          const nombre = liaisons.filter((l) => l.de === a.troncon && l.vers === b.troncon).length;
          return { vers: b.troncon, direction: directionMouvement(a.azimut, b.azimut, a.troncon === b.troncon), autorise: nombre > 0, liaisons: nombre };
        }),
    }));
}

/**
 * Liaisons d'un tronçon vers un autre, comme les proposerait la règle par défaut ; un demi-tour
 * (qu'elle ne propose jamais) part de la voie de gauche vers la voie de gauche.
 */
export function liaisonsEntre(bouts: readonly BoutAuNoeud[], de: string, vers: string): Liaison[] {
  const proposees = liaisonsParDefaut(bouts).filter((l) => l.de === de && l.vers === vers);
  if (proposees.length > 0) return proposees;
  const a = bouts.find((b) => b.troncon === de);
  const b = bouts.find((x) => x.troncon === vers);
  if (!a || !b || a.arrivent === 0 || b.repartent === 0) return [];
  const direction = directionMouvement(a.azimut, b.azimut, de === vers);
  const paires: Array<[number, number]> =
    direction === 'demi_tour' || direction === 'gauche'
      ? [[0, 0]]
      : direction === 'droite'
        ? [[a.arrivent - 1, b.repartent - 1]]
        : liensParDefaut(a.arrivent, b.repartent);
  return paires.map(([i, j]) => ({ de, voie_de: i, vers, voie_vers: j }));
}

/** Liaisons d'un nœud après avoir autorisé (ou interdit) d'aller d'un tronçon vers un autre. */
export function basculerEmbranchement(bouts: readonly BoutAuNoeud[], liaisons: readonly Liaison[], de: string, vers: string, autorise: boolean): Liaison[] {
  const autres = liaisons.filter((l) => !(l.de === de && l.vers === vers));
  return autorise ? [...autres, ...liaisonsEntre(bouts, de, vers)] : autres;
}

/**
 * Connexions d'un carrefour d'une branche vers une autre (« depuis N, on peut aller vers S »),
 * voie à voie : tout droit, chaque voie entrante vers sa part des voies sortantes ; à gauche (et
 * en demi-tour), de la voie de gauche vers la voie de gauche ; à droite, de droite à droite.
 */
export function connexionsMouvement(
  origine: { code: string; azimut: number; entrantes: number },
  destination: { code: string; azimut: number; sortantes: number },
): Array<{ de: string; vers: string }> {
  if (origine.entrantes === 0 || destination.sortantes === 0) return [];
  const direction = directionMouvement(origine.azimut, destination.azimut, origine.code === destination.code);
  const paires: Array<[number, number]> =
    direction === 'tout_droit'
      ? liensParDefaut(origine.entrantes, destination.sortantes)
      : direction === 'droite'
        ? [[origine.entrantes - 1, destination.sortantes - 1]]
        : [[0, 0]];
  return paires.map(([i, j]) => ({ de: cleVoie(origine.code, 'entrante', i), vers: cleVoie(destination.code, 'sortante', j) }));
}
