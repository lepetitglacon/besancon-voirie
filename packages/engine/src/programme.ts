/**
 * Programme par étapes (feux temporisés à la TM:PE) et diagramme de feux —
 * docs/CONFIGURATION.md §5.
 *
 * Une étape est une période où un ensemble de lignes compatibles est au vert, pour une durée
 * saisie. Entre deux étapes, le moteur insère une transition :
 * - les lignes qui s'arrêtent passent au jaune (véhicules) puis au rouge ;
 * - chaque ligne qui démarre attend, pour chaque ligne en conflit qui s'arrête, la fin de son
 *   jaune puis le rouge de dégagement ; une ligne sans conflit démarre aussitôt ;
 * - les lignes présentes dans les deux étapes restent au vert.
 * La transition dure jusqu'au démarrage de la dernière ligne ; l'étape suivante commence
 * quand toutes ses lignes sont au vert.
 *
 * Le temps 0 du cycle est le début de la première étape. Le diagramme de feux donne, par
 * ligne, ses intervalles de vert et de jaune dans [0, cycle].
 */
import { matriceConflits, type GeometrieCarrefour, type LigneConflits, type TypeLigne } from './conflits.js';
import { cleDegagement, degagementsCalcules, type Degagement } from './degagement.js';
import { longueurPolyligne, repereLocal } from './geometrie.js';
import { PARAMETRES_CERTU } from './parametres.js';

export type Intervalle = [number, number];

export interface LigneProgramme {
  code: string;
  type: TypeLigne;
}

export interface EtapeProgramme {
  lignes: readonly string[];
  duree_s: number;
  /** Étape servie seulement si cette ligne est demandée (bouton piéton, boucle) — graphe.ts. */
  appel?: string | null;
  /** Étape hors du cycle de base, atteinte par un arc du graphe (priorité tram) — graphe.ts. */
  hors_cycle?: boolean;
}

/** Étape produite par le moteur (proposition, reconstruction). */
export interface EtapeProposee {
  lignes: string[];
  duree_s: number;
}

export interface EntreeProgramme {
  lignes: readonly LigneProgramme[];
  etapes: readonly EtapeProgramme[];
  jaune_s: number;
  /** Paires de lignes en conflit non admis : jamais au vert ensemble. */
  conflits: ReadonlyArray<readonly [string, string]>;
  /** Rouge de dégagement par couple « ligne qui s'arrête>ligne qui démarre » (cleDegagement). */
  degagements: ReadonlyMap<string, number>;
  /** Longueur de la traversée de chaque ligne piétonne (m), pour contrôler son vert. */
  longueursTraversees?: ReadonlyMap<string, number>;
}

export interface EtapeCalculee {
  /** Indice de l'étape dans le programme saisi. */
  index: number;
  lignes: string[];
  /** Période où toutes les lignes de l'étape sont au vert. */
  debut_s: number;
  fin_s: number;
}

export interface TransitionCalculee {
  /** Indices des étapes quittée et rejointe. */
  de: number;
  vers: number;
  debut_s: number;
  duree_s: number;
  /** Lignes qui s'arrêtent (jaune puis rouge). */
  arrets: string[];
  /** Lignes qui démarrent, avec leur attente depuis le début de la transition (s). */
  demarrages: Record<string, number>;
  /** Couple qui fixe la durée de la transition. */
  contrainte: { de: string; vers: string; jaune_s: number; rouge_s: number } | null;
}

export interface ControleProgramme {
  niveau: 'erreur' | 'avertissement';
  message: string;
}

export interface ResultatProgramme {
  cycle_s: number;
  etapes: EtapeCalculee[];
  transitions: TransitionCalculee[];
  /** Diagramme de feux : intervalles de vert et de jaune de chaque ligne, dans [0, cycle]. */
  verts: Record<string, Intervalle[]>;
  jaunes: Record<string, Intervalle[]>;
  controles: ControleProgramme[];
}

const EPSILON = 1e-9;
const clePaire = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const arrondi = (x: number) => Math.round(x * 1000) / 1000;

/** Fusionne les intervalles qui se touchent ou se chevauchent. */
export function fusionner(intervalles: Intervalle[]): Intervalle[] {
  const tries = intervalles.filter(([a, b]) => b - a > EPSILON).sort((x, y) => x[0] - y[0]);
  const resultat: Intervalle[] = [];
  for (const [a, b] of tries) {
    const dernier = resultat.at(-1);
    if (dernier && a <= dernier[1] + EPSILON) dernier[1] = Math.max(dernier[1], b);
    else resultat.push([a, b]);
  }
  return resultat.map(([a, b]) => [arrondi(a), arrondi(b)]);
}

/**
 * Durées des périodes de vert d'une ligne sur le cycle, en recollant la période qui finit
 * en fin de cycle avec celle qui commence à 0.
 */
export function dureesDeVert(verts: readonly Intervalle[], cycle_s: number): number[] {
  if (verts.length === 0) return [];
  const durees = verts.map(([a, b]) => b - a);
  const premier = verts[0]!;
  const dernier = verts.at(-1)!;
  if (verts.length > 1 && premier[0] <= EPSILON && dernier[1] >= cycle_s - EPSILON) {
    durees[0]! += durees.pop()!;
  }
  return durees;
}

/** État d'une ligne à l'instant t du cycle. */
export function etatLigne(
  resultat: Pick<ResultatProgramme, 'verts' | 'jaunes'>,
  code: string,
  t: number,
): 'vert' | 'jaune' | 'rouge' {
  const dans = (intervalles: readonly Intervalle[] | undefined) =>
    (intervalles ?? []).some(([a, b]) => t >= a - EPSILON && t < b - EPSILON);
  if (dans(resultat.verts[code])) return 'vert';
  if (dans(resultat.jaunes[code])) return 'jaune';
  return 'rouge';
}

export type Transition = Pick<TransitionCalculee, 'duree_s' | 'arrets' | 'demarrages' | 'contrainte'>;

/**
 * Calcul d'une transition entre deux ensembles de lignes au vert : jaune des lignes qui
 * s'arrêtent, attente de chaque ligne qui démarre (jaune + rouge de dégagement des lignes en
 * conflit qui s'arrêtent), durée fixée par le couple le plus exigeant.
 */
export function preparerTransitions(
  entree: Pick<EntreeProgramme, 'lignes' | 'jaune_s' | 'conflits' | 'degagements'>,
): (courante: ReadonlySet<string>, suivante: ReadonlySet<string>) => Transition {
  const parCode = new Map(entree.lignes.map((l) => [l.code, l]));
  const enConflit = new Set(entree.conflits.map(([a, b]) => clePaire(a, b)));
  const jaune = (code: string) => (parCode.get(code)?.type === 'pieton' ? 0 : entree.jaune_s);
  return (courante, suivante) => {
    const arrets = [...courante].filter((c) => !suivante.has(c));
    const demarrages: Record<string, number> = {};
    let duree = 0;
    let contrainte: TransitionCalculee['contrainte'] = null;
    for (const code of suivante) {
      if (courante.has(code)) continue;
      let attente = 0;
      for (const arret of arrets) {
        if (!enConflit.has(clePaire(arret, code))) continue;
        const rouge = entree.degagements.get(cleDegagement(arret, code)) ?? PARAMETRES_CERTU.rougeDegagementDefaut;
        const besoin = jaune(arret) + rouge;
        attente = Math.max(attente, besoin);
        if (!contrainte || besoin > duree) {
          contrainte = { de: arret, vers: code, jaune_s: jaune(arret), rouge_s: rouge };
          duree = besoin;
        }
      }
      demarrages[code] = attente;
    }
    return { duree_s: duree, arrets, demarrages, contrainte };
  };
}

/**
 * Inscrit une étape puis la transition vers la suivante dans les intervalles de vert et de
 * jaune ; renvoie l'instant de début de l'étape suivante.
 */
export function inscrireEtapeEtTransition(
  diagramme: { verts: Map<string, Intervalle[]>; jaunes: Map<string, Intervalle[]> },
  jaune: (code: string) => number,
  courante: ReadonlySet<string>,
  suivante: ReadonlySet<string>,
  debut: number,
  fin: number,
  transition: Transition,
): number {
  const ajouter = (m: Map<string, Intervalle[]>, code: string, intervalle: Intervalle) => m.get(code)?.push(intervalle);
  for (const code of courante) ajouter(diagramme.verts, code, [debut, fin]);
  for (const code of suivante) {
    if (courante.has(code)) ajouter(diagramme.verts, code, [fin, fin + transition.duree_s]);
    else ajouter(diagramme.verts, code, [fin + transition.demarrages[code]!, fin + transition.duree_s]);
  }
  for (const code of transition.arrets) {
    if (jaune(code) > 0) ajouter(diagramme.jaunes, code, [fin, fin + jaune(code)]);
  }
  return fin + transition.duree_s;
}

/** Contrôles communs à toutes les étapes : lignes inconnues, conflits dans une même étape. */
export function controlerEtapes(
  lignes: readonly LigneProgramme[],
  etapes: readonly EtapeProgramme[],
  conflits: ReadonlyArray<readonly [string, string]>,
): ControleProgramme[] {
  const parCode = new Map(lignes.map((l) => [l.code, l]));
  const enConflit = new Set(conflits.map(([a, b]) => clePaire(a, b)));
  const controles: ControleProgramme[] = [];
  etapes.forEach((etape, i) => {
    const inconnues = etape.lignes.filter((c) => !parCode.has(c));
    if (inconnues.length) controles.push({ niveau: 'erreur', message: `Étape ${i + 1} : ligne(s) inconnue(s) ${inconnues.join(', ')}` });
    const connues = etape.lignes.filter((c) => parCode.has(c));
    for (let a = 0; a < connues.length; a++) {
      for (let b = a + 1; b < connues.length; b++) {
        if (enConflit.has(clePaire(connues[a]!, connues[b]!))) {
          controles.push({ niveau: 'erreur', message: `Étape ${i + 1} : ${connues[a]} et ${connues[b]} sont en conflit` });
        }
      }
    }
    if (connues.length === 0) controles.push({ niveau: 'avertissement', message: `Étape ${i + 1} : aucune ligne au vert` });
  });
  return controles;
}

/**
 * Calcule le cycle de base, ses transitions et son diagramme de feux. Les étapes hors cycle
 * (priorité tram) n'y figurent pas ; les étapes sur appel y figurent comme si elles étaient
 * toujours demandées (cycle le plus long). Le fonctionnement à la demande se simule avec
 * simulerGraphe (graphe.ts).
 */
export function calculerProgramme(entree: EntreeProgramme): ResultatProgramme {
  const { lignes, etapes, jaune_s } = entree;
  const parCode = new Map(lignes.map((l) => [l.code, l]));
  const controles = controlerEtapes(lignes, etapes, entree.conflits);
  const jaune = (code: string) => (parCode.get(code)?.type === 'pieton' ? 0 : jaune_s);
  const transition = preparerTransitions(entree);

  // ── Chronologie : étape 1, transition 1→2, étape 2, …, transition n→1 (cycle de base) ──
  const diagramme = {
    verts: new Map<string, Intervalle[]>(lignes.map((l) => [l.code, []])),
    jaunes: new Map<string, Intervalle[]>(lignes.map((l) => [l.code, []])),
  };
  const etapesCalculees: EtapeCalculee[] = [];
  const transitions: TransitionCalculee[] = [];
  const base = etapes.flatMap((e, index) => (e.hors_cycle ? [] : [index]));
  if (base.length === 0 && etapes.length > 0) controles.push({ niveau: 'erreur', message: 'Aucune étape dans le cycle de base' });
  const ensembles = etapes.map((e) => new Set(e.lignes.filter((c) => parCode.has(c))));
  let t = 0;
  base.forEach((i, rang) => {
    const etape = etapes[i]!;
    const courante = ensembles[i]!;
    const j = base[(rang + 1) % base.length]!;
    const suivante = ensembles[j]!;
    etapesCalculees.push({ index: i, lignes: [...courante], debut_s: t, fin_s: t + etape.duree_s });
    // Une seule étape : ses lignes restent au vert, sans transition.
    const calcul = base.length > 1 ? transition(courante, suivante) : { duree_s: 0, arrets: [], demarrages: {}, contrainte: null };
    const suite = inscrireEtapeEtTransition(diagramme, jaune, courante, base.length > 1 ? suivante : new Set(), t, t + etape.duree_s, calcul);
    if (base.length > 1) transitions.push({ de: i, vers: j, debut_s: t + etape.duree_s, ...calcul });
    t = suite;
  });
  const { verts, jaunes } = diagramme;

  const cycle_s = arrondi(t);
  // Les intervalles qui débordent la fin du cycle (jaune de la dernière transition quand elle
  // est plus courte que le jaune) reviennent au début.
  const replier = (intervalles: Intervalle[]): Intervalle[] =>
    fusionner(
      intervalles.flatMap(([a, b]): Intervalle[] =>
        b <= cycle_s + EPSILON ? [[a, b]] : a >= cycle_s ? [[a - cycle_s, b - cycle_s]] : [[a, cycle_s], [0, b - cycle_s]],
      ),
    );
  const resultat: ResultatProgramme = {
    cycle_s,
    etapes: etapesCalculees,
    transitions,
    verts: Object.fromEntries([...verts].map(([code, v]) => [code, replier(v)])),
    jaunes: Object.fromEntries([...jaunes].map(([code, v]) => [code, replier(v)])),
    controles,
  };

  // ── Contrôles de durée ──
  const p = PARAMETRES_CERTU;
  etapes.forEach((etape, i) => {
    if (etape.duree_s < p.vertMin) {
      controles.push({ niveau: 'avertissement', message: `Étape ${i + 1} : ${etape.duree_s} s, moins que le vert minimal de ${p.vertMin} s` });
    }
  });
  const horsCycle = new Set(etapes.filter((e) => e.hors_cycle).flatMap((e) => e.lignes));
  for (const ligne of lignes) {
    const durees = dureesDeVert(resultat.verts[ligne.code]!, cycle_s);
    if (durees.length === 0) {
      // Une ligne servie seulement hors cycle (tram) n'apparaît pas dans le cycle de base.
      if (horsCycle.has(ligne.code)) continue;
      controles.push({ niveau: 'avertissement', message: `${ligne.code} n'est jamais au vert` });
      continue;
    }
    const plusCourt = Math.min(...durees);
    if (plusCourt < p.vertMin - EPSILON) {
      controles.push({ niveau: 'avertissement', message: `${ligne.code} : vert de ${arrondi(plusCourt)} s, moins que le minimum de ${p.vertMin} s` });
    }
    const longueur = entree.longueursTraversees?.get(ligne.code);
    if (ligne.type === 'pieton' && longueur !== undefined) {
      const necessaire = Math.ceil(longueur / p.vitessePietons);
      if (plusCourt < necessaire - EPSILON) {
        controles.push({
          niveau: 'avertissement',
          message: `${ligne.code} : vert piéton de ${arrondi(plusCourt)} s pour ${Math.round(longueur)} m à traverser (${necessaire} s à ${p.vitessePietons} m/s)`,
        });
      }
    }
  }
  if (cycle_s > p.cycleMax) {
    controles.push({ niveau: 'avertissement', message: `Cycle de ${cycle_s} s, au-delà des ${p.cycleMax} s recommandées` });
  }
  return resultat;
}

/**
 * Proposition d'étapes : chaque étape part de la première ligne pas encore servie et lui
 * ajoute toutes les lignes compatibles, en priorité celles pas encore servies puis celles
 * déjà au vert à l'étape précédente (vert prolongé). À ajuster à la main.
 */
export function proposerEtapes(
  lignes: readonly LigneProgramme[],
  conflits: ReadonlyArray<readonly [string, string]>,
  duree_s = 20,
): EtapeProposee[] {
  const enConflit = new Set(conflits.map(([a, b]) => clePaire(a, b)));
  const ordre = [...lignes.filter((l) => l.type !== 'pieton'), ...lignes.filter((l) => l.type === 'pieton')].map((l) => l.code);
  const servies = new Set<string>();
  const etapes: EtapeProposee[] = [];
  while (servies.size < ordre.length) {
    const precedente = new Set(etapes.at(-1)?.lignes ?? []);
    const etape: string[] = [];
    const candidates = [...ordre.filter((c) => !servies.has(c)), ...ordre.filter((c) => servies.has(c) && precedente.has(c))];
    for (const code of candidates) {
      if (etape.every((autre) => !enConflit.has(clePaire(code, autre)))) etape.push(code);
    }
    etape.forEach((c) => servies.add(c));
    etapes.push({ lignes: ordre.filter((c) => etape.includes(c)), duree_s });
  }
  return etapes;
}

/**
 * Reconstruit les étapes d'un diagramme de feux (relevé terrain au chronomètre, par exemple).
 * Le cycle est découpé aux instants de changement ; une période sans aucun vert, ou plus
 * courte que le vert minimal et dont les verts se retrouvent tous dans la période suivante,
 * est une transition. Les autres périodes sont les étapes, dans l'ordre du cycle.
 */
export function etapesDepuisDiagramme(
  verts: Readonly<Record<string, readonly Intervalle[]>>,
  cycle_s: number,
  vertMin: number = PARAMETRES_CERTU.vertMin,
): EtapeProposee[] {
  const bornes = [...new Set([0, cycle_s, ...Object.values(verts).flatMap((v) => v.flat())])]
    .filter((b) => b >= 0 && b <= cycle_s)
    .sort((a, b) => a - b);
  const auVert = (t: number) =>
    Object.entries(verts)
      .filter(([, intervalles]) => intervalles.some(([a, b]) => t > a && t < b))
      .map(([code]) => code)
      .sort();
  let periodes: Array<{ lignes: string[]; duree: number }> = [];
  for (let k = 0; k < bornes.length - 1; k++) {
    const [a, b] = [bornes[k]!, bornes[k + 1]!];
    if (b - a <= EPSILON) continue;
    const lignes = auVert((a + b) / 2);
    const derniere = periodes.at(-1);
    if (derniere && derniere.lignes.join() === lignes.join()) derniere.duree += b - a;
    else periodes.push({ lignes, duree: b - a });
  }
  // Période à cheval sur la fin du cycle.
  if (periodes.length > 1 && periodes[0]!.lignes.join() === periodes.at(-1)!.lignes.join()) {
    periodes[0]!.duree += periodes.pop()!.duree;
  }

  const etapes: EtapeProposee[] = [];
  periodes.forEach((periode, k) => {
    const suivante = periodes[(k + 1) % periodes.length]!;
    const inclusDansSuivante =
      periode.lignes.length < suivante.lignes.length && periode.lignes.every((c) => suivante.lignes.includes(c));
    const transition = periode.lignes.length === 0 || (periode.duree < vertMin && inclusDansSuivante);
    if (!transition) etapes.push({ lignes: periode.lignes, duree_s: arrondi(periode.duree) });
  });
  return etapes;
}

/** Ce que le programme d'un carrefour tire de ses lignes de feux et de sa géométrie. */
export interface ContexteProgramme {
  lignes: LigneProgramme[];
  /** Paires en conflit non admis. */
  conflits: Array<[string, string]>;
  degagements: Degagement[];
  longueursTraversees: Map<string, number>;
}

export function contexteProgramme(
  lignes: readonly LigneConflits[],
  geometrie: GeometrieCarrefour,
  admis: ReadonlyArray<readonly [string, string]> = [],
): ContexteProgramme {
  const repere = repereLocal(geometrie.centre);
  const longueursTraversees = new Map<string, number>();
  for (const ligne of lignes) {
    // Un seul vert pour tout le groupe : le piéton franchit tous ses passages d'une traite.
    const passages = ligne.type === 'pieton' && ligne.traverse ? (geometrie.traversees.get(ligne.traverse) ?? []) : [];
    if (passages.length) {
      longueursTraversees.set(ligne.code, passages.reduce((total, p) => total + longueurPolyligne(p.map(repere.versXY)), 0));
    }
  }
  return {
    lignes: lignes.map((l) => ({ code: l.code, type: l.type })),
    conflits: matriceConflits(lignes, geometrie, admis)
      .filter((c) => !c.admis)
      .map((c) => [c.a, c.b]),
    degagements: degagementsCalcules(lignes, geometrie, admis),
    longueursTraversees,
  };
}

/** Rouges de dégagement retenus : la saisie manuelle l'emporte sur le calcul. */
export function degagementsRetenus(
  calcules: readonly Degagement[],
  saisis: Readonly<Record<string, number>> = {},
): Map<string, number> {
  return new Map([...calcules.map((d) => [cleDegagement(d.de, d.vers), d.rouge_s] as const), ...Object.entries(saisis)]);
}
