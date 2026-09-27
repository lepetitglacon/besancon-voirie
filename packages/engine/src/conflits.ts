/**
 * Conflits entre lignes de feux, calculés sur la géométrie réelle du carrefour —
 * docs/CONFIGURATION.md §4.
 *
 * Deux trajectoires (connexions) sont en conflit si leurs courbes se coupent, ou si elles
 * aboutissent à la même voie de sortie. Deux trajectoires issues de la même voie entrante ne
 * sont pas en conflit entre elles. Un passage piéton est en conflit avec toute trajectoire
 * qui le coupe. Dans un giratoire (§7), deux trajectoires sur l'anneau sont en conflit
 * d'insertion quand l'une rejoint l'anneau là où l'autre y circule.
 */
import { cleConnexion, lireCleVoie, type Connexion } from './connexions.js';
import { courbeConnexionXY, intersectionsPolylignes, longueurPolyligne, polylignesSeCoupent, repereLocal, type LonLat, type Repere, type Segment, type XY } from './geometrie.js';
import {
  azimutFeuAnneau,
  courbeTrajet,
  franchissementsCercle,
  insertions,
  parcours,
  rayonCirculation,
  surArc,
  trajetGiratoire,
  traverseIlot,
  type Anneau,
  type PassageAnneau,
  type TrajetGiratoire,
} from './giratoire.js';

export type NatureConflit = 'croisement' | 'insertion' | 'convergence' | 'pieton';

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
  /** Feu sur l'anneau d'un giratoire, juste en amont de cette branche : il arrête la circulation de l'anneau. */
  anneau?: string | null;
}

/** Géométrie enregistrée du carrefour, en coordonnées géographiques. */
export interface GeometrieCarrefour {
  centre: LonLat;
  /** Clé de voie (« S:e0 ») → segment [bout côté carrefour, bout éloigné]. */
  voies: ReadonlyMap<string, Segment>;
  connexions: readonly Connexion[];
  /** Code de branche → passage piéton. */
  traversees: ReadonlyMap<string, Segment>;
  /** Clé de voie → type (generale, bus, velo, tram) : dans un giratoire, tram et bus en site propre traversent l'îlot. */
  typesVoies?: ReadonlyMap<string, string>;
  /** Anneau d'un giratoire ; absent pour un carrefour ordinaire. */
  anneau?: Anneau | null;
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

export interface Trajectoire {
  cle: string;
  /** Voie entrante de départ, ou « anneau:X » pour la circulation arrêtée par le feu d'anneau X. */
  de: string;
  /** Voie sortante d'arrivée, ou « anneau:X » quand le feu d'anneau X l'arrête avant. */
  vers: string;
  courbe: XY[];
  /** Dans un giratoire, la partie de la trajectoire qui suit l'anneau. */
  anneau?: PassageAnneau;
}

const PREFIXE_ANNEAU = 'anneau:';
const surAnneau = (cle: string) => cle.startsWith(PREFIXE_ANNEAU);

interface TrajetConnexion {
  mouvement: string;
  trajectoire: Trajectoire;
  /** Trajet par l'anneau, pour une connexion de giratoire qui ne traverse pas l'îlot. */
  trajet?: TrajetGiratoire;
}

function trajetsDesConnexions(geometrie: GeometrieCarrefour, repere: Repere): TrajetConnexion[] {
  const { anneau } = geometrie;
  return geometrie.connexions.flatMap((connexion): TrajetConnexion[] => {
    const entree = geometrie.voies.get(connexion.de);
    const sortie = geometrie.voies.get(connexion.vers);
    const de = lireCleVoie(connexion.de);
    const vers = lireCleVoie(connexion.vers);
    if (!entree || !sortie || !de || !vers) return [];
    const mouvement = `${de.branche}>${vers.branche}`;
    const base = { cle: cleConnexion(connexion), de: connexion.de, vers: connexion.vers };
    const types = geometrie.typesVoies;
    if (!anneau || traverseIlot(types?.get(connexion.de), types?.get(connexion.vers))) {
      return [{ mouvement, trajectoire: { ...base, courbe: courbeConnexionXY(entree, sortie, repere) } }];
    }
    const trajet = trajetGiratoire(entree, sortie, anneau, repere);
    const anneauEntier: PassageAnneau = {
      debut: trajet.debut,
      longueur: trajet.longueur,
      avant: longueurPolyligne(trajet.entree),
      rayon: trajet.rayon,
      insertion: true,
    };
    return [{ mouvement, trajet, trajectoire: { ...base, courbe: courbeTrajet(trajet), anneau: anneauEntier } }];
  });
}

/** Trajectoires de chaque mouvement (« S>O »), en mètres dans le repère local du carrefour. */
export function trajectoiresParMouvement(geometrie: GeometrieCarrefour): Map<string, Trajectoire[]> {
  const parMouvement = new Map<string, Trajectoire[]>();
  for (const { mouvement, trajectoire } of trajetsDesConnexions(geometrie, repereLocal(geometrie.centre))) {
    parMouvement.set(mouvement, [...(parMouvement.get(mouvement) ?? []), trajectoire]);
  }
  return parMouvement;
}

/**
 * Azimut du feu d'anneau placé en amont de chaque branche citée : juste avant le premier
 * point où les trajectoires de la branche touchent l'anneau (§7).
 */
export function feuxAnneau(geometrie: GeometrieCarrefour, branches: readonly string[]): Map<string, number> {
  const { anneau } = geometrie;
  const resultat = new Map<string, number>();
  if (!anneau || branches.length === 0) return resultat;
  const repere = repereLocal(geometrie.centre);
  const centre = repere.versXY(anneau.centre);
  const rayon = rayonCirculation(anneau);
  const trajets = trajetsDesConnexions(geometrie, repere);
  for (const code of new Set(branches)) {
    const deLaBranche = (cle: string) => cle.startsWith(`${code}:`);
    const points = trajets.flatMap(({ trajectoire, trajet }) => {
      if (trajet) return deLaBranche(trajectoire.de) ? [trajet.debut] : [];
      const franchissements = franchissementsCercle(trajectoire.courbe, centre, rayon);
      return [
        ...(deLaBranche(trajectoire.de) ? franchissements.slice(0, 1) : []),
        ...(deLaBranche(trajectoire.vers) ? franchissements.slice(-1) : []),
      ];
    });
    const azimut = azimutFeuAnneau(points, rayon);
    if (azimut !== null) resultat.set(code, azimut);
  }
  return resultat;
}

/**
 * Trajectoires commandées par chaque ligne de feux. Carrefour ordinaire : celles de ses
 * mouvements. Giratoire : une trajectoire sur l'anneau s'arrête au premier feu d'anneau
 * qu'elle rencontre ; un feu d'anneau commande la circulation qui passe devant lui, jusqu'au
 * feu d'anneau suivant ou jusqu'à sa sortie.
 */
export function trajectoiresDesLignes(lignes: readonly LigneConflits[], geometrie: GeometrieCarrefour): Map<string, Trajectoire[]> {
  const repere = repereLocal(geometrie.centre);
  const trajets = trajetsDesConnexions(geometrie, repere);
  const arrets = feuxAnneau(geometrie, lignes.flatMap((l) => (l.anneau ? [l.anneau] : [])));

  /** Premier feu d'anneau strictement à l'intérieur de l'arc, en degrés parcourus depuis son début. */
  const premierArret = (debut: number, longueur: number) => {
    let premier: { code: string; parcouru: number } | null = null;
    for (const [code, azimut] of arrets) {
      const parcouru = parcours(debut, azimut);
      if (parcouru > 1e-6 && parcouru < longueur - 1e-6 && (!premier || parcouru < premier.parcouru)) premier = { code, parcouru };
    }
    return premier;
  };

  /** Tronçon d'un trajet par l'anneau, à partir de `depuis` degrés parcourus, jusqu'au premier feu d'anneau. */
  const troncon = ({ trajectoire, trajet }: TrajetConnexion, depuis: number, de: string): Trajectoire => {
    const t = trajet!;
    const debut = (((t.debut - depuis) % 360) + 360) % 360;
    const arret = premierArret(debut, t.longueur - depuis);
    const jusqua = arret ? depuis + arret.parcouru : t.longueur;
    const vers = arret ? `${PREFIXE_ANNEAU}${arret.code}` : trajectoire.vers;
    return {
      cle: `${de}>${vers}`,
      de,
      vers,
      courbe: courbeTrajet(t, depuis, jusqua),
      anneau: {
        debut,
        longueur: jusqua - depuis,
        avant: depuis === 0 ? longueurPolyligne(t.entree) : 0,
        rayon: t.rayon,
        insertion: depuis === 0,
      },
    };
  };

  const resultat = new Map<string, Trajectoire[]>();
  for (const ligne of lignes) {
    let trajectoires: Trajectoire[];
    if (ligne.anneau) {
      const azimut = arrets.get(ligne.anneau);
      const de = `${PREFIXE_ANNEAU}${ligne.anneau}`;
      trajectoires =
        azimut === undefined
          ? []
          : trajets.flatMap((t) => (t.trajet && surArc(t.trajectoire.anneau!, azimut) ? [troncon(t, parcours(t.trajet.debut, azimut), de)] : []));
    } else {
      const mouvements = new Set(ligne.mouvements);
      trajectoires = trajets
        .filter((t) => mouvements.has(t.mouvement))
        .map((t) => (t.trajet ? troncon(t, 0, t.trajectoire.de) : t.trajectoire));
    }
    // Plusieurs connexions peuvent partager le même tronçon (même départ, même arrivée).
    const uniques = new Map(trajectoires.map((t) => [t.cle, t]));
    resultat.set(ligne.code, [...uniques.values()]);
  }
  return resultat;
}

function conflitTrajectoires(a: Trajectoire, b: Trajectoire): Exclude<NatureConflit, 'pieton'> | null {
  if (a.de === b.de) return null;
  // Deux tronçons arrêtés par le même feu d'anneau s'y rejoignent : leur conflit, s'il y en a, est l'insertion.
  if (a.vers === b.vers && !surAnneau(a.vers)) return 'convergence';
  if (a.anneau && b.anneau) return insertions(a.anneau, b.anneau).length > 0 ? 'insertion' : null;
  return polylignesSeCoupent(a.courbe, b.courbe) ? 'croisement' : null;
}

/**
 * Points de conflit entre deux trajectoires, repérés par la distance parcourue depuis le
 * début de chacune (m) : croisements, insertions sur l'anneau, ou même voie de sortie.
 */
export function pointsDeConflitTrajectoires(a: Trajectoire, b: Trajectoire): Array<{ da: number; db: number }> {
  if (a.de === b.de) return [];
  if (a.vers === b.vers && !surAnneau(a.vers)) return [{ da: longueurPolyligne(a.courbe), db: longueurPolyligne(b.courbe) }];
  if (a.anneau && b.anneau) return insertions(a.anneau, b.anneau);
  return intersectionsPolylignes(a.courbe, b.courbe).map(({ da, db }) => ({ da, db }));
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
  const parLigne = trajectoiresDesLignes(lignes, geometrie);
  const trajectoires = (ligne: LigneConflits) => parLigne.get(ligne.code) ?? [];
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
    // Pour qualifier le conflit, un croisement l'emporte sur une insertion, qui l'emporte sur une convergence.
    let retenu: Omit<ConflitLignes, 'admis'> | null = null;
    for (const ta of trajectoires(a)) {
      for (const tb of trajectoires(b)) {
        const nature = conflitTrajectoires(ta, tb);
        if (nature === 'croisement') return { a: a.code, b: b.code, nature, cause: [ta.cle, tb.cle] };
        if (nature && (!retenu || (nature === 'insertion' && retenu.nature === 'convergence'))) {
          retenu = { a: a.code, b: b.code, nature, cause: [ta.cle, tb.cle] };
        }
      }
    }
    return retenu;
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
