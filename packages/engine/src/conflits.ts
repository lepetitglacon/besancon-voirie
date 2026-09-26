/**
 * Conflits entre lignes de feux, calculés sur la géométrie réelle du carrefour —
 * docs/CONFIGURATION.md §4.
 *
 * Deux trajectoires (connexions) sont en conflit si leurs courbes se coupent, ou si elles
 * aboutissent à la même voie de sortie. Deux trajectoires issues de la même voie entrante ne
 * sont pas en conflit entre elles. Un passage piéton est en conflit avec toute trajectoire
 * qui le coupe.
 */
import { cleConnexion, lireCleVoie, type Connexion } from './connexions.js';
import { courbeConnexionXY, polylignesSeCoupent, repereLocal, type LonLat, type Segment, type XY } from './geometrie.js';

export type NatureConflit = 'croisement' | 'convergence' | 'pieton';

export interface MouvementCle {
  origine: string;
  destination: string;
}

export const cleMouvement = (m: MouvementCle) => `${m.origine}>${m.destination}`;

export function lireCleMouvement(cle: string): MouvementCle | null {
  const [origine, destination, reste] = cle.split('>');
  return origine && destination && reste === undefined ? { origine, destination } : null;
}

export type TypeLigne = 'vehicule' | 'pieton';

export interface LigneConflits {
  code: string;
  type: TypeLigne;
  /** Clés « origine>destination » des mouvements commandés (lignes véhicules, vélos, TC). */
  mouvements: readonly string[];
  /** Code de la branche dont on emprunte le passage piéton (lignes piétonnes). */
  traverse?: string | null;
}

/** Géométrie enregistrée du carrefour, en coordonnées géographiques. */
export interface GeometrieCarrefour {
  centre: LonLat;
  /** Clé de voie (« S:e0 ») → segment [bout côté carrefour, bout éloigné]. */
  voies: ReadonlyMap<string, Segment>;
  connexions: readonly Connexion[];
  /** Code de branche → passage piéton. */
  traversees: ReadonlyMap<string, Segment>;
}

export interface ConflitLignes {
  a: string;
  b: string;
  nature: NatureConflit;
  /** Trajectoires (ou passage piéton) à l'origine du conflit, pour l'expliquer. */
  cause: [string, string];
  /** Conflit toléré à la main : les deux lignes peuvent être au vert ensemble. */
  admis: boolean;
}

interface Trajectoire {
  cle: string;
  de: string;
  vers: string;
  courbe: XY[];
}

/** Trajectoires de chaque mouvement (« S>O »), prêtes pour les calculs d'intersection. */
function trajectoiresParMouvement(geometrie: GeometrieCarrefour): Map<string, Trajectoire[]> {
  const repere = repereLocal(geometrie.centre);
  const parMouvement = new Map<string, Trajectoire[]>();
  for (const connexion of geometrie.connexions) {
    const entree = geometrie.voies.get(connexion.de);
    const sortie = geometrie.voies.get(connexion.vers);
    const de = lireCleVoie(connexion.de);
    const vers = lireCleVoie(connexion.vers);
    if (!entree || !sortie || !de || !vers) continue;
    const mouvement = `${de.branche}>${vers.branche}`;
    const trajectoire = { cle: cleConnexion(connexion), de: connexion.de, vers: connexion.vers, courbe: courbeConnexionXY(entree, sortie, repere) };
    parMouvement.set(mouvement, [...(parMouvement.get(mouvement) ?? []), trajectoire]);
  }
  return parMouvement;
}

function conflitTrajectoires(a: Trajectoire, b: Trajectoire): Exclude<NatureConflit, 'pieton'> | null {
  if (a.de === b.de) return null;
  if (a.vers === b.vers) return 'convergence';
  return polylignesSeCoupent(a.courbe, b.courbe) ? 'croisement' : null;
}

const clePaire = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/**
 * Matrice des conflits entre lignes de feux, paire par paire. `admis` liste les paires de
 * codes tolérées à la main (tourne-à-droite au vert avec les piétons, par exemple).
 */
export function matriceConflits(
  lignes: readonly LigneConflits[],
  geometrie: GeometrieCarrefour,
  admis: ReadonlyArray<readonly [string, string]> = [],
): ConflitLignes[] {
  const repere = repereLocal(geometrie.centre);
  const parMouvement = trajectoiresParMouvement(geometrie);
  const trajectoires = (ligne: LigneConflits) => ligne.mouvements.flatMap((m) => parMouvement.get(m) ?? []);
  const traversee = (ligne: LigneConflits): XY[] | null => {
    const segment = ligne.traverse ? geometrie.traversees.get(ligne.traverse) : undefined;
    return segment ? segment.map(repere.versXY) : null;
  };
  const tolerees = new Set(admis.map(([a, b]) => clePaire(a, b)));

  const conflit = (a: LigneConflits, b: LigneConflits): Omit<ConflitLignes, 'admis'> | null => {
    if (a.type === 'pieton' && b.type === 'pieton') return null;
    if (a.type === 'pieton' || b.type === 'pieton') {
      const [pieton, vehicule] = a.type === 'pieton' ? [a, b] : [b, a];
      const passage = traversee(pieton);
      const coupee = passage && trajectoires(vehicule).find((t) => polylignesSeCoupent(passage, t.courbe));
      if (!coupee) return null;
      const cause: [string, string] = [`traversée ${pieton.traverse}`, coupee.cle];
      return { a: a.code, b: b.code, nature: 'pieton', cause: a.type === 'pieton' ? cause : [cause[1], cause[0]] };
    }
    let convergence: Omit<ConflitLignes, 'admis'> | null = null;
    for (const ta of trajectoires(a)) {
      for (const tb of trajectoires(b)) {
        const nature = conflitTrajectoires(ta, tb);
        // Un croisement l'emporte sur une convergence pour qualifier le conflit.
        if (nature === 'croisement') return { a: a.code, b: b.code, nature, cause: [ta.cle, tb.cle] };
        if (nature === 'convergence' && !convergence) convergence = { a: a.code, b: b.code, nature, cause: [ta.cle, tb.cle] };
      }
    }
    return convergence;
  };

  const conflits: ConflitLignes[] = [];
  for (let i = 0; i < lignes.length; i++) {
    for (let j = i + 1; j < lignes.length; j++) {
      const c = conflit(lignes[i]!, lignes[j]!);
      if (c) conflits.push({ ...c, admis: tolerees.has(clePaire(c.a, c.b)) });
    }
  }
  return conflits;
}

/** Mouvements qu'aucune ligne véhicule ne commande. */
export function mouvementsNonCommandes(
  mouvements: readonly MouvementCle[],
  lignes: readonly LigneConflits[],
): string[] {
  const commandes = new Set(lignes.filter((l) => l.type !== 'pieton').flatMap((l) => l.mouvements));
  return mouvements.map(cleMouvement).filter((cle) => !commandes.has(cle));
}

/**
 * Point de départ : une ligne véhicules par branche d'arrivée, qui commande tous ses
 * mouvements (F1, F2… dans l'ordre des branches). À ajuster à la main ensuite.
 */
export function proposerLignes(mouvements: readonly MouvementCle[]): Array<{ code: string; mouvements: string[] }> {
  const parOrigine = new Map<string, string[]>();
  for (const m of mouvements) parOrigine.set(m.origine, [...(parOrigine.get(m.origine) ?? []), cleMouvement(m)]);
  return [...parOrigine.values()].map((cles, i) => ({ code: `F${i + 1}`, mouvements: cles }));
}
