/**
 * Plans de feux calés sur l'heure réelle — docs/ARCHITECTURE.md §6.1.
 *
 * Un contrôleur coordonné ne fait pas tourner son cycle depuis sa mise sous tension : il le
 * cale sur une base de temps de synchronisation (BTS), calculée à partir de l'heure légale
 * commune à tous les contrôleurs (remis à l'heure par le poste central, DCF77 ou GPS). En
 * général, la BTS vaut 0 à 3 h du matin et se prend modulo la durée du cycle en cours
 * (Wikipédia, Carrefour à feux). La position dans le cycle vaut donc
 * (BTS − décalage) mod cycle, avec un décalage propre au carrefour et au plan, qui ne dépend ni
 * du jour ni de l'heure de début du plan.
 *
 * Le décalage se déduit de « tops » relevés sur place : l'instant où une ligne passe au vert.
 * Des tops de jours différents qui donnent le même décalage confirment le modèle. S'ils
 * divergent, le carrefour n'est pas calé sur l'heure (cycle non prédéfini : carrefour isolé,
 * micro-régulation, priorité tram) ou le cycle saisi est faux.
 */
import { modulo } from './decalage.js';
import type { Intervalle } from './programme.js';

export const FUSEAU_CONTROLEURS = 'Europe/Paris';
/** Heure légale où la BTS vaut 0. */
export const ORIGINE_BTS_S = 3 * 3600;
/** Écart toléré entre les décalages de deux tops : un top se tape au doigt. */
export const TOLERANCE_SYNCHRO_S = 2;

const JOUR_S = 86_400;
const EPSILON = 1e-9;

export type JourSemaine = 'lun' | 'mar' | 'mer' | 'jeu' | 'ven' | 'sam' | 'dim';
const JOURS: readonly JourSemaine[] = ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'];
const JOURS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

let format: Intl.DateTimeFormat | undefined;

/** Jour, date et secondes écoulées depuis minuit à l'heure légale des contrôleurs. */
export function heureLegale(instant_ms: number): { jour: JourSemaine; date: string; secondes: number } {
  format ??= new Intl.DateTimeFormat('en-US', {
    timeZone: FUSEAU_CONTROLEURS,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parties = Object.fromEntries(format.formatToParts(new Date(instant_ms)).map((p) => [p.type, p.value]));
  const ms = modulo(instant_ms, 1000) / 1000;
  return {
    jour: JOURS[JOURS_EN.indexOf(parties.weekday!)]!,
    date: `${parties.year}-${parties.month}-${parties.day}`,
    secondes: Number(parties.hour) * 3600 + Number(parties.minute) * 60 + Number(parties.second) + ms,
  };
}

/** Base de temps de synchronisation : secondes écoulées depuis 3 h, heure légale. */
export function bts(instant_ms: number): number {
  return modulo(heureLegale(instant_ms).secondes - ORIGINE_BTS_S, JOUR_S);
}

/** Jour d'exploitation d'un instant : il commence à l'origine de la BTS (3 h). */
export function jourExploitation(instant_ms: number): string {
  return heureLegale(instant_ms - ORIGINE_BTS_S * 1000).date;
}

/** Position dans le cycle à un instant réel, pour un plan de décalage connu. */
export function positionCycle(instant_ms: number, cycle_s: number, decalage_s: number): number {
  return modulo(bts(instant_ms) - decalage_s, cycle_s);
}

/**
 * Débuts de vert d'une ligne dans le cycle. Un vert à cheval sur la fin du cycle est découpé en
 * [a, cycle] et [0, b] par le diagramme : il commence en a, pas en 0.
 */
export function debutsDeVert(verts: readonly Intervalle[], cycle_s: number): number[] {
  const aCheval = verts.some(([, b]) => b >= cycle_s - EPSILON);
  return verts.filter(([a]) => !(aCheval && a <= EPSILON && verts.length > 1)).map(([a]) => a);
}

/** Décalage que donne un top : au top, la position dans le cycle est le début de vert de la ligne. */
export function decalageDuTop(instant_ms: number, debutVert_s: number, cycle_s: number): number {
  return modulo(bts(instant_ms) - debutVert_s, cycle_s);
}

/** Moyenne de valeurs sur un cercle de période donnée, et écart maximal à cette moyenne. */
export function moyenneCirculaire(valeurs: readonly number[], periode: number): { moyenne: number; ecartMax: number } {
  const angle = (v: number) => (2 * Math.PI * v) / periode;
  const x = valeurs.reduce((s, v) => s + Math.cos(angle(v)), 0);
  const y = valeurs.reduce((s, v) => s + Math.sin(angle(v)), 0);
  const moyenne = modulo((Math.atan2(y, x) * periode) / (2 * Math.PI), periode);
  const ecart = (v: number) => {
    const d = modulo(v - moyenne, periode);
    return Math.min(d, periode - d);
  };
  return { moyenne, ecartMax: Math.max(0, ...valeurs.map(ecart)) };
}

export type ConfianceSynchro = 'inconnue' | 'estimee' | 'synchronisee' | 'incoherente';

export interface Synchronisation {
  /** Décalage retenu (s dans [0, cycle)), null sans top exploitable. */
  decalage_s: number | null;
  /**
   * inconnue : aucun top ; estimee : tops d'un seul jour ; synchronisee : plusieurs jours
   * concordants ; incoherente : tops discordants (carrefour non calé sur l'heure, cycle faux).
   */
  confiance: ConfianceSynchro;
  tops: number;
  jours: number;
  /** Plus grand écart d'un top au décalage retenu (s). */
  ecart_s: number | null;
}

/** Décalage d'un plan d'après ses tops : chaque top donne un décalage, on garde leur moyenne. */
export function synchroniser(
  tops: ReadonlyArray<{ instant_ms: number; debutVert_s: number }>,
  cycle_s: number,
  tolerance_s = TOLERANCE_SYNCHRO_S,
): Synchronisation {
  if (tops.length === 0 || cycle_s <= 0) return { decalage_s: null, confiance: 'inconnue', tops: 0, jours: 0, ecart_s: null };
  const { moyenne, ecartMax } = moyenneCirculaire(
    tops.map((t) => decalageDuTop(t.instant_ms, t.debutVert_s, cycle_s)),
    cycle_s,
  );
  const jours = new Set(tops.map((t) => jourExploitation(t.instant_ms))).size;
  const arrondi = (x: number) => Math.round(x * 100) / 100;
  const confiance = ecartMax > tolerance_s ? 'incoherente' : jours >= 2 ? 'synchronisee' : 'estimee';
  return { decalage_s: arrondi(moyenne), confiance, tops: tops.length, jours, ecart_s: arrondi(ecartMax) };
}

/**
 * Cycle observé sur une série de tops d'une même ligne, tapés à la suite : durée totale divisée
 * par le nombre de cycles le plus proche de celui du plan. Null s'il faut au moins deux cycles.
 */
export function cycleObserve(instants_ms: readonly number[], cycle_s: number): { cycle_s: number; cycles: number } | null {
  if (instants_ms.length < 2 || cycle_s <= 0) return null;
  const duree = (Math.max(...instants_ms) - Math.min(...instants_ms)) / 1000;
  const cycles = Math.round(duree / cycle_s);
  if (cycles < 2) return null;
  return { cycle_s: Math.round((duree / cycles) * 10) / 10, cycles };
}

/** Plage horaire d'un plan : jours de départ, de `de` (inclus) à `a` (exclu), heure légale. */
export interface PlageHoraire {
  jours: 'tous' | readonly string[];
  de: string;
  a: string;
}

const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h! * 60 + m!;
};

/**
 * Plan en vigueur à un instant : le premier dont une plage couvre l'heure légale. Une plage
 * qui finit avant de commencer (22:00 → 06:00) déborde sur le lendemain ; de 00:00 à 00:00,
 * elle couvre toute la journée.
 */
export function planEnVigueur<P extends { plages: readonly PlageHoraire[] }>(plans: readonly P[], instant_ms: number): P | null {
  const { jour, secondes } = heureLegale(instant_ms);
  const veille = JOURS[modulo(JOURS.indexOf(jour) - 1, 7)]!;
  const m = secondes / 60;
  const le = (plage: PlageHoraire, j: JourSemaine) => plage.jours === 'tous' || plage.jours.includes(j);
  const couvre = (plage: PlageHoraire) => {
    const [de, a] = [minutes(plage.de), minutes(plage.a)];
    if (de < a) return le(plage, jour) && m >= de && m < a;
    return (le(plage, jour) && m >= de) || (le(plage, veille) && m < a);
  };
  return plans.find((p) => p.plages.some(couvre)) ?? null;
}
