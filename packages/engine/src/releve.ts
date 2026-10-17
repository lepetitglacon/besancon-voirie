/**
 * Relevé terrain d'un carrefour : ce qu'on tape devant le feu (changements de couleur d'une ligne,
 * événements qui peuvent déclencher une étape) et ce qu'on en tire, sans effet de bord. Le téléphone
 * l'affiche en direct ; l'API le refait à la réception (docs/ARCHITECTURE.md, `analyserReleve`).
 * Protocole : README §3.3 ; comparaison au programme : docs/refonte-plan-de-feux.md §5.
 */

/** Ce qui peut appeler une étape ou la prolonger, noté à l'instant où on le voit. */
export type EvenementReleve = 'bus' | 'tram' | 'boucle' | 'pieton';

export type CouleurReleve = 'vert' | 'rouge';

/** Une saisie, horodatée par le téléphone (ms epoch). */
export type SaisieReleve = { t: number; ligne: string; couleur: CouleurReleve } | { t: number; evenement: EvenementReleve };

export const estChangementCouleur = (s: SaisieReleve): s is Extract<SaisieReleve, { ligne: string }> => 'ligne' in s;

/** Couleur d'une ligne d'après la dernière saisie ; null tant qu'on ne l'a pas vue changer. */
export function couleurCourante(saisies: readonly SaisieReleve[], ligne: string): CouleurReleve | null {
  for (let i = saisies.length - 1; i >= 0; i--) {
    const s = saisies[i]!;
    if (estChangementCouleur(s) && s.ligne === ligne) return s.couleur;
  }
  return null;
}

/** Un appui sur une ligne : elle passe au vert, ou au rouge si on l'a vue au vert. */
export const basculerLigne = (saisies: readonly SaisieReleve[], ligne: string, t: number): SaisieReleve[] => [
  ...saisies,
  { t, ligne, couleur: couleurCourante(saisies, ligne) === 'vert' ? 'rouge' : 'vert' },
];

/** Écart de cycle ou de vert au-delà duquel le relevé contredit le programme (README §3.3). */
export const ECART_RELEVE_S = 2;

const arrondi = (x: number) => Math.round(x * 10) / 10;

function mediane(valeurs: readonly number[]): number | null {
  if (valeurs.length === 0) return null;
  const triees = [...valeurs].sort((a, b) => a - b);
  const milieu = Math.floor(triees.length / 2);
  return triees.length % 2 ? triees[milieu]! : (triees[milieu - 1]! + triees[milieu]!) / 2;
}

function ecartType(valeurs: readonly number[]): number {
  const moyenne = valeurs.reduce((a, b) => a + b, 0) / valeurs.length;
  return Math.sqrt(valeurs.reduce((a, v) => a + (v - moyenne) ** 2, 0) / valeurs.length);
}

export interface SyntheseReleve {
  /** Cycle mesuré entre deux passages au vert d'une même ligne ; null avant deux cycles. */
  cycle: { cycle_s: number; ecart_type_s: number; cycles: number } | null;
  /** Durée médiane du vert de chaque ligne (passage au vert → au rouge), null si jamais mesurée. */
  verts: Record<string, number | null>;
  /** Instants des passages au vert de chaque ligne : les tops du calage (ms epoch). */
  tops: Record<string, number[]>;
  /** Nombre de chaque événement vu. */
  evenements: Record<EvenementReleve, number>;
}

export function analyserReleve(saisies: readonly SaisieReleve[], lignes: readonly string[]): SyntheseReleve {
  const changements = saisies.filter(estChangementCouleur);
  const tops: Record<string, number[]> = {};
  const verts: Record<string, number | null> = {};
  /** Intervalles entre deux passages au vert, ligne par ligne (s). */
  const intervalles: Array<{ ligne: string; d: number }> = [];
  for (const ligne of lignes) {
    const siens = changements.filter((c) => c.ligne === ligne);
    const sesTops = siens.filter((c) => c.couleur === 'vert').map((c) => c.t);
    tops[ligne] = sesTops;
    sesTops.slice(1).forEach((t, i) => intervalles.push({ ligne, d: (t - sesTops[i]!) / 1000 }));
    const durees = siens.flatMap((c, i) => {
      const suivant = siens[i + 1];
      return c.couleur === 'vert' && suivant?.couleur === 'rouge' ? [(suivant.t - c.t) / 1000] : [];
    });
    const m = mediane(durees);
    verts[ligne] = m === null ? null : arrondi(m);
  }

  // Un appui oublié donne un intervalle de deux cycles : on écarte ce qui s'éloigne trop de la médiane.
  const brute = mediane(intervalles.map((i) => i.d));
  const gardes = brute === null ? [] : intervalles.filter(({ d }) => d > brute * 0.5 && d < brute * 1.5);
  const retenus = gardes.map((i) => i.d);
  const cycle_s = mediane(retenus);
  // Plusieurs lignes relevées voient les mêmes cycles : on compte ceux de la ligne la plus suivie.
  const cycles = Math.max(0, ...lignes.map((ligne) => gardes.filter((g) => g.ligne === ligne).length));
  const evenements: Record<EvenementReleve, number> = { bus: 0, tram: 0, boucle: 0, pieton: 0 };
  for (const s of saisies) if (!estChangementCouleur(s)) evenements[s.evenement]++;

  return {
    cycle: cycle_s !== null && cycles >= 2 ? { cycle_s: arrondi(cycle_s), ecart_type_s: arrondi(ecartType(retenus)), cycles } : null,
    verts,
    tops,
    evenements,
  };
}

/** Ce que le programme prévoit pour le plan en vigueur : cycle et intervalles de vert de chaque ligne. */
export interface PlanTheorique {
  code: string;
  cycle_s: number | null;
  verts: Record<string, Array<[number, number]>> | null;
}

export interface EcartReleve {
  /** Ligne concernée ; absente pour le cycle. */
  ligne?: string;
  mesure_s: number;
  theorique_s: number;
  message: string;
}

/**
 * Durée du vert d'une ligne dans le programme. Un vert à cheval sur la fin du cycle est découpé en
 * deux intervalles : ils n'en font qu'un. null si la ligne n'a pas exactement un vert par cycle.
 */
function dureeDuVert(intervalles: ReadonlyArray<[number, number]>, cycle_s: number): number | null {
  const aCheval = intervalles.length === 2 && intervalles.some(([a]) => a <= 0) && intervalles.some(([, b]) => b >= cycle_s);
  if (intervalles.length !== 1 && !aCheval) return null;
  return arrondi(intervalles.reduce((total, [a, b]) => total + b - a, 0));
}

/** Écarts significatifs entre le relevé et le plan en vigueur : cycle, puis vert de chaque ligne. */
export function ecartsAuPlan(releve: SyntheseReleve, plan: PlanTheorique | null): EcartReleve[] {
  if (!plan?.cycle_s) return [];
  const liste: EcartReleve[] = [];
  if (releve.cycle && Math.abs(releve.cycle.cycle_s - plan.cycle_s) >= ECART_RELEVE_S) {
    liste.push({
      mesure_s: releve.cycle.cycle_s,
      theorique_s: plan.cycle_s,
      message: `Cycle mesuré ${releve.cycle.cycle_s} s, programme ${plan.cycle_s} s`,
    });
  }
  for (const [ligne, mesure_s] of Object.entries(releve.verts)) {
    const theorique_s = dureeDuVert(plan.verts?.[ligne] ?? [], plan.cycle_s);
    if (mesure_s === null || theorique_s === null) continue;
    if (Math.abs(mesure_s - theorique_s) >= ECART_RELEVE_S) {
      liste.push({ ligne, mesure_s, theorique_s, message: `${ligne} : vert mesuré ${mesure_s} s, programme ${theorique_s} s` });
    }
  }
  return liste;
}
