/**
 * Graphe des étapes d'un programme — docs/CONFIGURATION.md §6.
 *
 * Nœuds : les étapes. Arcs : les enchaînements possibles et leurs conditions.
 * - Cycle de base : les étapes non « hors cycle », dans l'ordre. Une étape « sur appel » n'est
 *   servie que si sa ligne d'appel est demandée (bouton piéton, boucle) ; sinon on la saute.
 * - Arcs saisis : depuis une étape, aller vers une autre si une ligne est demandée (priorité
 *   tram), éventuellement en écourtant l'étape en cours dès son vert minimal (« anticipé ») ;
 *   un arc sans condition remplace la suite du cycle.
 * À la fin d'une étape, on prend le premier arc saisi dont la demande est présente, sinon
 * l'arc saisi sans condition, sinon la prochaine étape servie du cycle de base — après une
 * étape hors cycle, celle qui suit l'étape interrompue.
 *
 * Une demande reste présente jusqu'à ce que sa ligne passe au vert.
 */
import {
  controlerEtapes,
  fusionner,
  inscrireEtapeEtTransition,
  preparerTransitions,
  type ControleProgramme,
  type EntreeProgramme,
  type EtapeCalculee,
  type EtapeProgramme,
  type Intervalle,
  type TransitionCalculee,
} from './programme.js';
import { PARAMETRES_CERTU } from './parametres.js';

export interface ArcGraphe {
  de: number;
  vers: number;
  /** Ligne dont la demande déclenche l'arc ; null : arc sans condition. */
  demande: string | null;
  /** L'étape `de` est écourtée dès son vert minimal quand la demande arrive. */
  anticipe: boolean;
}

export interface Demande {
  ligne: string;
  t: number;
}

const EPSILON = 1e-9;
const arrondi = (x: number) => Math.round(x * 1000) / 1000;
const nom = (i: number) => `É${i + 1}`;

/** Indices des étapes du cycle de base, dans l'ordre. */
export const etapesDeBase = (etapes: readonly EtapeProgramme[]) => etapes.flatMap((e, i) => (e.hors_cycle ? [] : [i]));

/** Cohérence du graphe : erreurs (refus d'enregistrement) et avertissements. */
export function validerGraphe(
  etapes: readonly EtapeProgramme[],
  arcs: readonly ArcGraphe[],
  codes: readonly string[],
): ControleProgramme[] {
  const controles: ControleProgramme[] = [];
  const erreur = (message: string) => controles.push({ niveau: 'erreur', message });
  const avertissement = (message: string) => controles.push({ niveau: 'avertissement', message });
  const base = etapesDeBase(etapes);

  if (etapes[0]?.hors_cycle) erreur(`${nom(0)} doit faire partie du cycle de base`);
  if (base.length > 0 && base.every((i) => etapes[i]!.appel)) erreur('Toutes les étapes du cycle sont sur appel : il en faut au moins une toujours servie');
  etapes.forEach((etape, i) => {
    if (!etape.appel) return;
    if (!codes.includes(etape.appel)) erreur(`${nom(i)} : ligne d'appel ${etape.appel} inconnue`);
    else if (!etape.lignes.includes(etape.appel)) erreur(`${nom(i)} : la ligne d'appel ${etape.appel} doit être au vert dans l'étape`);
    if (etape.hors_cycle) avertissement(`${nom(i)} : hors cycle, son appel est sans effet (ce sont les arcs qui y mènent)`);
  });

  arcs.forEach((arc, k) => {
    const libelle = `Arc ${nom(arc.de)} → ${nom(arc.vers)}`;
    if (!etapes[arc.de] || !etapes[arc.vers]) return erreur(`Arc ${k + 1} : étape inexistante`);
    if (arc.de === arc.vers) erreur(`${libelle} : une étape ne mène pas à elle-même`);
    if (arc.demande !== null) {
      if (!codes.includes(arc.demande)) erreur(`${libelle} : ligne ${arc.demande} inconnue`);
      else if (!etapes[arc.vers]!.lignes.includes(arc.demande)) {
        erreur(`${libelle} : ${arc.demande} doit être au vert dans ${nom(arc.vers)} pour que sa demande soit servie`);
      }
    } else if (arc.anticipe) {
      erreur(`${libelle} : seul un arc déclenché par une demande peut écourter l'étape`);
    }
  });

  etapes.forEach((etape, i) => {
    const sortants = arcs.filter((a) => a.de === i);
    const sansCondition = sortants.filter((a) => a.demande === null);
    if (sansCondition.length > 1) avertissement(`${nom(i)} : plusieurs arcs sans condition, seul le premier est suivi`);
    if (!etape.hors_cycle) return;
    if (!arcs.some((a) => a.vers === i)) avertissement(`${nom(i)} : hors cycle et jamais atteinte (aucun arc n'y mène)`);
  });
  return controles;
}

export interface ArcAffiche {
  de: number;
  vers: number;
  nature: 'suite' | 'saut' | 'demande' | 'reprise';
  /** Condition lisible : « si P1 », « sans appel P1 »… */
  condition: string;
  anticipe: boolean;
  /** Durée de la transition entre les deux étapes (s). */
  transition_s: number;
}

/** Tous les arcs du graphe (cycle de base, sauts d'étapes sur appel, arcs saisis), pour l'affichage. */
export function arcsDuGraphe(
  entree: Pick<EntreeProgramme, 'lignes' | 'etapes' | 'jaune_s' | 'conflits' | 'degagements'>,
  arcs: readonly ArcGraphe[],
): ArcAffiche[] {
  const { etapes } = entree;
  const transition = preparerTransitions(entree);
  const ensemble = (i: number) => new Set(etapes[i]!.lignes);
  const duree = (de: number, vers: number) => transition(ensemble(de), ensemble(vers)).duree_s;
  const base = etapesDeBase(etapes);
  const resultat: ArcAffiche[] = [];

  for (const [rang, i] of base.entries()) {
    if (arcs.some((a) => a.de === i && a.demande === null)) continue; // la suite du cycle est remplacée
    const sautes: string[] = [];
    for (let k = 1; k <= base.length; k++) {
      const j = base[(rang + k) % base.length]!;
      const appel = etapes[j]!.appel;
      if (j === i && base.length > 1) break;
      if (appel) {
        resultat.push({ de: i, vers: j, nature: 'saut', condition: `si ${appel}`, anticipe: false, transition_s: duree(i, j) });
        sautes.push(appel);
        continue;
      }
      if (j !== i || base.length === 1) {
        resultat.push({
          de: i,
          vers: j,
          nature: 'suite',
          condition: sautes.length ? `sans ${sautes.join(' ni ')}` : '',
          anticipe: false,
          transition_s: duree(i, j),
        });
      }
      break;
    }
  }
  for (const arc of arcs) {
    if (!etapes[arc.de] || !etapes[arc.vers]) continue;
    resultat.push({
      de: arc.de,
      vers: arc.vers,
      nature: arc.demande ? 'demande' : 'reprise',
      condition: arc.demande ? `si ${arc.demande}` : '',
      anticipe: arc.anticipe,
      transition_s: duree(arc.de, arc.vers),
    });
  }
  return resultat;
}

export interface EvenementSimulation {
  t: number;
  message: string;
}

export interface AttenteDemande extends Demande {
  /** Temps entre la demande et le vert de sa ligne (s) ; null si pas servie avant la fin. */
  attente_s: number | null;
}

export interface ResultatSimulation {
  duree_s: number;
  etapes: EtapeCalculee[];
  transitions: TransitionCalculee[];
  verts: Record<string, Intervalle[]>;
  jaunes: Record<string, Intervalle[]>;
  evenements: EvenementSimulation[];
  attentes: AttenteDemande[];
  controles: ControleProgramme[];
}

/**
 * Déroule le graphe des étapes sur `duree_s` secondes, à partir du début de l'étape 1, avec
 * les demandes du scénario (appuis sur un bouton piéton, détections, tram).
 */
export function simulerGraphe(
  entree: EntreeProgramme & { arcs: readonly ArcGraphe[]; demandes: readonly Demande[]; duree_s: number },
): ResultatSimulation {
  const { lignes, etapes, arcs, duree_s } = entree;
  const codes = lignes.map((l) => l.code);
  const controles = [...controlerEtapes(lignes, etapes, entree.conflits), ...validerGraphe(etapes, arcs, codes)];
  const demandes = [...entree.demandes].filter((d) => d.t >= 0 && d.t < duree_s).sort((a, b) => a.t - b.t);
  const vide: ResultatSimulation = { duree_s, etapes: [], transitions: [], verts: {}, jaunes: {}, evenements: [], attentes: [], controles };
  if (controles.some((c) => c.niveau === 'erreur') || etapes.length === 0) return vide;

  const parCode = new Map(lignes.map((l) => [l.code, l]));
  const jaune = (code: string) => (parCode.get(code)?.type === 'pieton' ? 0 : entree.jaune_s);
  const transition = preparerTransitions(entree);
  const ensembles = etapes.map((e) => new Set(e.lignes.filter((c) => parCode.has(c))));
  const diagramme = {
    verts: new Map<string, Intervalle[]>(codes.map((c) => [c, []])),
    jaunes: new Map<string, Intervalle[]>(codes.map((c) => [c, []])),
  };
  const base = etapesDeBase(etapes);
  const evenements: EvenementSimulation[] = [];
  const etapesCalculees: EtapeCalculee[] = [];
  const transitions: TransitionCalculee[] = [];

  /** Vert d'une ligne qui couvre l'instant t, ou qui commence après t et avant `jusqua`. */
  const servie = (d: Demande, jusqua: number) =>
    (diagramme.verts.get(d.ligne) ?? []).some(([a, b]) => (a <= d.t + EPSILON && d.t < b - EPSILON) || (a >= d.t - EPSILON && a <= jusqua + EPSILON));
  const enAttente = (ligne: string, x: number) => demandes.some((d) => d.ligne === ligne && d.t <= x + EPSILON && !servie(d, x));

  /** Dernière étape du cycle de base parcourue : le cycle reprend après elle. */
  let derniereDeBase = base[0]!;
  const choisirSuivante = (courante: number, x: number): number => {
    const sortants = arcs.filter((a) => a.de === courante);
    for (const arc of sortants) {
      if (arc.demande && enAttente(arc.demande, x)) {
        evenements.push({ t: arrondi(x), message: `Demande ${arc.demande} : ${nom(courante)} → ${nom(arc.vers)}` });
        return arc.vers;
      }
    }
    const reprise = sortants.find((a) => a.demande === null);
    if (reprise) return reprise.vers;
    const rang = base.indexOf(etapes[courante]!.hors_cycle ? derniereDeBase : courante);
    for (let k = 1; k <= base.length; k++) {
      const j = base[(Math.max(rang, 0) + k) % base.length]!;
      const appel = etapes[j]!.appel;
      if (!appel || enAttente(appel, x)) return j;
      evenements.push({ t: arrondi(x), message: `${nom(j)} sautée : pas d'appel ${appel}` });
    }
    return courante;
  };

  let courante = base[0]!;
  let t = 0;
  for (let garde = 0; t < duree_s - EPSILON && garde < 10_000; garde++) {
    const etape = etapes[courante]!;
    let fin = t + etape.duree_s;
    // Arc anticipé : une demande arrivée pendant l'étape l'écourte, après son vert minimal.
    for (const arc of arcs) {
      // Une ligne déjà au vert dans l'étape en cours sert sa demande sans rien écourter.
      if (arc.de !== courante || !arc.anticipe || !arc.demande || ensembles[courante]!.has(arc.demande)) continue;
      const premiere = demandes.find((d) => d.ligne === arc.demande && d.t < fin && !servie(d, t));
      if (!premiere) continue;
      const ecourtee = Math.max(t + Math.min(PARAMETRES_CERTU.vertMin, etape.duree_s), premiere.t);
      if (ecourtee < fin - EPSILON) {
        fin = ecourtee;
        evenements.push({ t: arrondi(fin), message: `Demande ${arc.demande} : ${nom(courante)} écourtée à ${arrondi(fin - t)} s` });
      }
    }
    etapesCalculees.push({ index: courante, lignes: [...ensembles[courante]!], debut_s: arrondi(t), fin_s: arrondi(fin) });
    if (!etape.hors_cycle) derniereDeBase = courante;
    // Les verts de l'étape comptent pour savoir quelles demandes restent en attente.
    diagramme.verts.forEach((v, code) => ensembles[courante]!.has(code) && v.push([t, fin]));
    const suivante = choisirSuivante(courante, fin);
    diagramme.verts.forEach((v, code) => ensembles[courante]!.has(code) && v.pop());
    const calcul = transition(ensembles[courante]!, ensembles[suivante]!);
    const debutSuivante = inscrireEtapeEtTransition(diagramme, jaune, ensembles[courante]!, ensembles[suivante]!, t, fin, calcul);
    transitions.push({ de: courante, vers: suivante, debut_s: arrondi(fin), ...calcul });
    t = debutSuivante;
    courante = suivante;
  }

  const couper = (intervalles: Intervalle[]) =>
    fusionner(intervalles)
      .filter(([a]) => a < duree_s)
      .map(([a, b]): Intervalle => [a, Math.min(b, duree_s)]);
  const verts = Object.fromEntries([...diagramme.verts].map(([c, v]) => [c, couper(v)]));
  const attentes = demandes.map((d): AttenteDemande => {
    const vert = (verts[d.ligne] ?? []).find(([a, b]) => b > d.t + EPSILON || a >= d.t);
    return { ...d, attente_s: vert ? arrondi(Math.max(0, vert[0] - d.t)) : null };
  });
  return {
    duree_s,
    etapes: etapesCalculees.filter((e) => e.debut_s < duree_s).map((e) => ({ ...e, fin_s: Math.min(e.fin_s, duree_s) })),
    transitions: transitions.filter((tr) => tr.debut_s < duree_s),
    verts,
    jaunes: Object.fromEntries([...diagramme.jaunes].map(([c, v]) => [c, couper(v)])),
    evenements: evenements.filter((e) => e.t < duree_s),
    attentes,
    controles,
  };
}
