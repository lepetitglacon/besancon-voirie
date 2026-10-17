/**
 * Relevé terrain d'un carrefour : ce qu'on tape devant le feu (changements de couleur d'une ligne,
 * événements qui peuvent déclencher une étape) et ce qu'on en tire, sans effet de bord. Le téléphone
 * l'affiche en direct ; l'API le refait à la réception (docs/ARCHITECTURE.md, `analyserReleve`).
 * Protocole : README §3.3 ; comparaison au programme : docs/refonte-plan-de-feux.md §5.
 */

/** Ce qui peut appeler une étape ou la prolonger, noté à l'instant où on le voit. */
export type EvenementReleve = 'bus' | 'tram' | 'boucle' | 'pieton';

export type CouleurReleve = 'vert' | 'jaune' | 'rouge';

/**
 * Une saisie, horodatée par le téléphone (ms epoch) : un changement de couleur d'une ligne, ou un
 * événement, rattaché à la ligne qu'il concerne quand on l'a indiquée.
 */
export type SaisieReleve =
  | { t: number; ligne: string; couleur: CouleurReleve }
  | { t: number; evenement: EvenementReleve; ligne?: string };

export const estChangementCouleur = (s: SaisieReleve): s is Extract<SaisieReleve, { couleur: CouleurReleve }> => 'couleur' in s;

/** Couleur d'une ligne d'après la dernière saisie ; null tant qu'on ne l'a pas vue changer. */
export function couleurCourante(saisies: readonly SaisieReleve[], ligne: string): CouleurReleve | null {
  for (let i = saisies.length - 1; i >= 0; i--) {
    const s = saisies[i]!;
    if (estChangementCouleur(s) && s.ligne === ligne) return s.couleur;
  }
  return null;
}

/**
 * Couleur qui suit dans l'ordre d'un feu : vert, jaune, rouge, puis vert. Une ligne piétonne n'a pas
 * de jaune (R12) : elle passe du vert au rouge.
 */
export function couleurSuivante(actuelle: CouleurReleve | null, avecJaune = true): CouleurReleve {
  if (actuelle === 'vert') return avecJaune ? 'jaune' : 'rouge';
  if (actuelle === 'jaune') return 'rouge';
  return 'vert';
}

/** Un appui sur une ligne : elle passe à la couleur qui suit celle où on l'a vue (au vert la première fois). */
export const basculerLigne = (saisies: readonly SaisieReleve[], ligne: string, t: number, avecJaune = true): SaisieReleve[] => [
  ...saisies,
  { t, ligne, couleur: couleurSuivante(couleurCourante(saisies, ligne), avecJaune) },
];

/** Force la couleur d'une ligne (un changement raté, une erreur) ; rien si elle l'a déjà. */
export const fixerCouleur = (saisies: readonly SaisieReleve[], ligne: string, couleur: CouleurReleve, t: number): SaisieReleve[] =>
  couleurCourante(saisies, ligne) === couleur ? [...saisies] : [...saisies, { t, ligne, couleur }];

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
  /** Durée médiane du vert de chaque ligne (passage au vert → au jaune ou au rouge), null si jamais mesurée. */
  verts: Record<string, number | null>;
  /** Durée médiane du jaune de chaque ligne (passage au jaune → au rouge), null si jamais vu. */
  jaunes: Record<string, number | null>;
  /** Instants des passages au vert de chaque ligne : les tops du calage (ms epoch). */
  tops: Record<string, number[]>;
  /** Nombre de chaque événement vu. */
  evenements: Record<EvenementReleve, number>;
  /** Les mêmes, par ligne de feux à laquelle on les a rattachés. */
  evenementsParLigne: Record<string, Partial<Record<EvenementReleve, number>>>;
}

export function analyserReleve(saisies: readonly SaisieReleve[], lignes: readonly string[]): SyntheseReleve {
  const changements = saisies.filter(estChangementCouleur);
  const tops: Record<string, number[]> = {};
  const verts: Record<string, number | null> = {};
  const jaunes: Record<string, number | null> = {};
  /** Intervalles entre deux passages au vert, ligne par ligne (s). */
  const intervalles: Array<{ ligne: string; d: number }> = [];
  for (const ligne of lignes) {
    const siens = changements.filter((c) => c.ligne === ligne);
    const sesTops = siens.filter((c) => c.couleur === 'vert').map((c) => c.t);
    tops[ligne] = sesTops;
    sesTops.slice(1).forEach((t, i) => intervalles.push({ ligne, d: (t - sesTops[i]!) / 1000 }));
    // Durée de chaque `de` jusqu'au changement suivant, s'il est l'un de `vers`.
    const durees = (de: CouleurReleve, vers: readonly CouleurReleve[]) =>
      siens.flatMap((c, i) => {
        const suivant = siens[i + 1];
        return c.couleur === de && suivant && vers.includes(suivant.couleur) ? [(suivant.t - c.t) / 1000] : [];
      });
    const mVert = mediane(durees('vert', ['jaune', 'rouge']));
    const mJaune = mediane(durees('jaune', ['rouge']));
    verts[ligne] = mVert === null ? null : arrondi(mVert);
    jaunes[ligne] = mJaune === null ? null : arrondi(mJaune);
  }

  // Un appui oublié donne un intervalle de deux cycles : on écarte ce qui s'éloigne trop de la médiane.
  const brute = mediane(intervalles.map((i) => i.d));
  const gardes = brute === null ? [] : intervalles.filter(({ d }) => d > brute * 0.5 && d < brute * 1.5);
  const retenus = gardes.map((i) => i.d);
  const cycle_s = mediane(retenus);
  // Plusieurs lignes relevées voient les mêmes cycles : on compte ceux de la ligne la plus suivie.
  const cycles = Math.max(0, ...lignes.map((ligne) => gardes.filter((g) => g.ligne === ligne).length));
  const evenements: Record<EvenementReleve, number> = { bus: 0, tram: 0, boucle: 0, pieton: 0 };
  const evenementsParLigne: Record<string, Partial<Record<EvenementReleve, number>>> = {};
  for (const s of saisies) {
    if (estChangementCouleur(s)) continue;
    evenements[s.evenement]++;
    if (s.ligne) {
      const siens = (evenementsParLigne[s.ligne] ??= {});
      siens[s.evenement] = (siens[s.evenement] ?? 0) + 1;
    }
  }

  return {
    cycle: cycle_s !== null && cycles >= 2 ? { cycle_s: arrondi(cycle_s), ecart_type_s: arrondi(ecartType(retenus)), cycles } : null,
    verts,
    jaunes,
    tops,
    evenements,
    evenementsParLigne,
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
export function dureeDuVert(intervalles: ReadonlyArray<readonly [number, number]>, cycle_s: number): number | null {
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

/**
 * Verts mesurés placés dans le cycle du programme, pour les superposer au diagramme de feux. Le relevé
 * n'a pas d'heure de référence : on cale chaque cycle relevé sur un passage au vert de la ligne de
 * `reference`, posé au début de son vert dans le programme. Chaque ligne garde son vert médian (décalage
 * et durée), découpé en deux s'il passe la fin du cycle.
 */
export function vertsDansLeCycle(
  saisies: readonly SaisieReleve[],
  reference: { ligne: string; debut_s: number },
  cycle_s: number,
): Record<string, Array<[number, number]>> {
  const changements = saisies.filter(estChangementCouleur).sort((a, b) => a.t - b.t);
  const reperes = changements.filter((c) => c.ligne === reference.ligne && c.couleur === 'vert').map((c) => c.t);
  if (reperes.length === 0 || cycle_s <= 0) return {};
  const lignes = [...new Set(changements.map((c) => c.ligne))];
  const resultat: Record<string, Array<[number, number]>> = {};
  for (const ligne of lignes) {
    const siens = changements.filter((c) => c.ligne === ligne);
    const decalages: number[] = [];
    const durees: number[] = [];
    siens.forEach((c, i) => {
      const suivant = siens[i + 1];
      const repere = reperes.filter((r) => r <= c.t).at(-1);
      if (c.couleur !== 'vert' || !suivant || suivant.couleur === 'vert' || repere === undefined) return;
      decalages.push((((c.t - repere) / 1000 + reference.debut_s) % cycle_s + cycle_s) % cycle_s);
      durees.push((suivant.t - c.t) / 1000);
    });
    if (decalages.length === 0) continue;
    // Des décalages de part et d'autre de la fin du cycle (101 s et 1 s) sont voisins : on les rapproche du premier.
    const premier = decalages[0]!;
    const proches = decalages.map((d) => (d - premier > cycle_s / 2 ? d - cycle_s : premier - d > cycle_s / 2 ? d + cycle_s : d));
    const debut = ((mediane(proches)! % cycle_s) + cycle_s) % cycle_s;
    const duree = Math.min(cycle_s, mediane(durees)!);
    const fin = debut + duree;
    resultat[ligne] = fin <= cycle_s ? [[arrondi(debut), arrondi(fin)]] : [[arrondi(debut), cycle_s], [0, arrondi(fin - cycle_s)]];
  }
  return resultat;
}
