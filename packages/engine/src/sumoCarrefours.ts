/**
 * Carrefours dans l'export SUMO (docs/pipeline-donnees.md, étape 6 ; reseau-d-abord.md, étape 9 ;
 * décision S3 de poc-sumo.md) :
 *
 * - le **cœur** d'un carrefour (ses nœuds au-delà des lignes d'arrêt) devient une seule jonction
 *   SUMO `c<carrefour>` ; les voies d'approche, jusqu'aux lignes d'arrêt, restent des arêtes, avec
 *   leurs présélections ; les tronçons du cœur disparaissent ;
 * - ses **connexions** (saisies ou proposées, d'une voie entrante à une voie sortante) deviennent
 *   les liens de la jonction ; une branche interne (R1…) se traverse : O → R1 puis R1 → E donne
 *   O → E, commandé par la ligne de la première ligne d'arrêt ;
 * - son **programme** (premier plan à cycle) devient un `<tlLogic>` dont chaque caractère d'état
 *   suit la ligne de feux du lien ; l'ordre des liens est imposé (`linkIndex`) dans reseau.tll.xml.
 */
import { etatLigne, type ResultatProgramme } from './programme.js';
import type { LonLat } from './geometrie.js';

/** Carrefour du réseau à exporter en une jonction. */
export interface CarrefourSumo {
  id: string;
  /** Connexions du carrefour : clés de voie « N:e0 » → « S:s1 ». */
  connexions: ReadonlyArray<{ de: string; vers: string }>;
  /** Ligne de feux véhicules de chaque mouvement « O>D ». */
  lignes: Readonly<Record<string, string>>;
  /** Programme retenu (premier plan à cycle) ; null : netconvert lui en invente un. */
  programme: ({ code: string } & Pick<ResultatProgramme, 'cycle_s' | 'verts' | 'jaunes'>) | null;
}

/** Ce que l'export sait d'un nœud et d'un tronçon pour bâtir les jonctions. */
interface NoeudJonction {
  id: string;
  position: LonLat;
  carrefour: string | null;
}

interface TronconJonction {
  id: string;
  de: string;
  vers: string;
  voies_avant: number;
  voies_arriere: number;
  /** Code de la branche que forme ce bout dans un carrefour (N, S, R1…). */
  branche_de?: string | null;
  branche_vers?: string | null;
}

/** Lien d'une jonction : d'une voie d'une arête qui arrive à une voie d'une arête qui repart (index SUMO). */
export interface LienSumo {
  depuis: string;
  vers: string;
  voieDepuis: number;
  voieVers: number;
  /** Ligne de feux qui le commande ; null : aucune (le lien cède le passage). */
  ligne: string | null;
}

export interface JonctionsSumo {
  /** Identifiant SUMO d'un nœud : `c<carrefour>` pour un nœud du cœur d'un carrefour exporté. */
  noeudSumo: (noeud: string) => string;
  /** Nœud du cœur d'un carrefour exporté : ses liaisons ne s'écrivent pas (la jonction a ses liens). */
  dansUnCoeur: (noeud: string) => boolean;
  /** Tronçon du cœur (ses deux bouts dans le même cœur) : il disparaît dans la jonction. */
  interne: (t: TronconJonction) => boolean;
  coeurs: Array<{ id: string; carrefour: CarrefourSumo; position: LonLat; liens: LienSumo[] }>;
  alertes: string[];
}

const PROFONDEUR_MAX = 30;
const interne = (code: string) => /^R\d+$/.test(code);
const lireCle = (cle: string) => {
  const [branche, voie] = cle.split(':') as [string, string];
  return { branche, rang: Number(voie.slice(1)) };
};
const borner = (x: number, max: number) => Math.min(Math.max(x, 0), Math.max(max, 0));

export function preparerJonctions(reseau: { noeuds: readonly NoeudJonction[]; troncons: readonly TronconJonction[]; carrefours?: readonly CarrefourSumo[] }): JonctionsSumo {
  const alertes: string[] = [];
  const exportes = new Map((reseau.carrefours ?? []).map((c) => [c.id, c]));
  const carrefourDe = new Map(reseau.noeuds.filter((n) => n.carrefour && exportes.has(n.carrefour)).map((n) => [n.id, n.carrefour!]));
  const autour = new Map<string, TronconJonction[]>();
  for (const t of reseau.troncons) for (const n of [t.de, t.vers]) autour.set(n, [...(autour.get(n) ?? []), t]);
  const autre = (t: TronconJonction, n: string) => (t.de === n ? t.vers : t.de);
  const bouts = reseau.troncons.flatMap((t) =>
    (['de', 'vers'] as const).flatMap((extremite) => {
      const code = extremite === 'de' ? t.branche_de : t.branche_vers;
      const noeud = extremite === 'de' ? t.de : t.vers;
      const carrefour = carrefourDe.get(noeud);
      return code && carrefour ? [{ t, extremite, code, noeud, carrefour }] : [];
    }),
  );

  // Nœuds d'approche : du carrefour, mais en amont d'une ligne d'arrêt (passage piéton, présélection).
  const approches = new Set<string>();
  for (const b of bouts) {
    if (interne(b.code)) continue;
    let troncon = b.t;
    let noeud = autre(troncon, b.noeud);
    for (let pas = 0; pas < PROFONDEUR_MAX; pas++) {
      const voisins = autour.get(noeud) ?? [];
      if (carrefourDe.get(noeud) !== b.carrefour || voisins.length !== 2) break;
      approches.add(noeud);
      const suite = voisins.find((x) => x.id !== troncon.id);
      if (!suite) break;
      troncon = suite;
      noeud = autre(troncon, noeud);
    }
  }
  const coeurDe = (n: string) => (approches.has(n) ? undefined : carrefourDe.get(n));
  const noeudSumo = (n: string) => {
    const c = coeurDe(n);
    return c ? `c${c}` : n;
  };

  const coeurs = [...exportes.values()].flatMap((carrefour) => {
    const membres = reseau.noeuds.filter((n) => coeurDe(n.id) === carrefour.id);
    if (membres.length === 0) {
      alertes.push(`Carrefour ${carrefour.id} : aucun nœud au cœur, non exporté en jonction`);
      return [];
    }
    const position: LonLat = [membres.reduce((s, n) => s + n.position[0], 0) / membres.length, membres.reduce((s, n) => s + n.position[1], 0) / membres.length];

    // Arêtes qui arrivent à chaque branche et qui en repartent, avec leur nombre de voies.
    const portes = new Map<string, { arrivee: { arete: string; voies: number }; depart: { arete: string; voies: number } }>();
    for (const b of bouts) {
      if (b.carrefour !== carrefour.id || interne(b.code) || coeurDe(b.noeud) !== carrefour.id) continue;
      const avant = { arete: `t${b.t.id}`, voies: b.t.voies_avant };
      const arriere = { arete: `-t${b.t.id}`, voies: b.t.voies_arriere };
      portes.set(b.code, b.extremite === 'vers' ? { arrivee: avant, depart: arriere } : { arrivee: arriere, depart: avant });
    }

    // Connexions, branches internes traversées : de la voie entrante d'une rue à la voie sortante d'une autre.
    const depuisInterne = new Map<string, string[]>();
    for (const c of carrefour.connexions) {
      if (interne(lireCle(c.de).branche)) depuisInterne.set(c.de, [...(depuisInterne.get(c.de) ?? []), c.vers]);
    }
    /** Voies sortantes de rues atteintes depuis une voie sortante (vers une branche interne, on la traverse). */
    const sorties = (vers: string, profondeur = 0): string[] => {
      const { branche, rang } = lireCle(vers);
      if (!interne(branche)) return [vers];
      if (profondeur >= PROFONDEUR_MAX) return [];
      return (depuisInterne.get(`${branche}:e${rang}`) ?? []).flatMap((suite) => sorties(suite, profondeur + 1));
    };
    const vus = new Set<string>();
    const liens: LienSumo[] = [];
    for (const c of carrefour.connexions) {
      const de = lireCle(c.de);
      if (interne(de.branche)) continue;
      // La ligne qui commande le lien est celle de la première ligne d'arrêt franchie.
      const ligne = carrefour.lignes[`${de.branche}>${lireCle(c.vers).branche}`] ?? null;
      for (const sortie of sorties(c.vers)) {
        const vers = lireCle(sortie);
        const entree = portes.get(de.branche)?.arrivee;
        const depart = portes.get(vers.branche)?.depart;
        if (!entree || !depart || entree.voies === 0 || depart.voies === 0) {
          alertes.push(`Carrefour ${carrefour.id} : connexion ${c.de} → ${sortie} sans arête SUMO`);
          continue;
        }
        const lien = {
          depuis: entree.arete,
          vers: depart.arete,
          voieDepuis: borner(entree.voies - 1 - de.rang, entree.voies - 1),
          voieVers: borner(depart.voies - 1 - vers.rang, depart.voies - 1),
          ligne,
        };
        const cle = `${lien.depuis}|${lien.voieDepuis}|${lien.vers}|${lien.voieVers}`;
        if (vus.has(cle)) continue;
        vus.add(cle);
        liens.push(lien);
      }
    }
    return [{ id: `c${carrefour.id}`, carrefour, position, liens }];
  });

  return {
    noeudSumo,
    dansUnCoeur: (n) => coeurDe(n) !== undefined,
    interne: (t) => {
      const c = coeurDe(t.de);
      return c !== undefined && c === coeurDe(t.vers);
    },
    coeurs,
    alertes,
  };
}

const ETATS = { vert: 'G', jaune: 'y', rouge: 'r' } as const;
/** Lien sans ligne de feux : feu éteint, le véhicule cède le passage. */
const SANS_LIGNE = 'o';

/** Phases d'un programme : un état par lien, constant sur chaque phase ; la somme des durées fait le cycle. */
export function phasesSumo(
  programme: Pick<ResultatProgramme, 'cycle_s' | 'verts' | 'jaunes'>,
  lignes: ReadonlyArray<string | null>,
): Array<{ duree_s: number; etat: string }> {
  const cycle = programme.cycle_s;
  const instants = new Set([0, cycle]);
  for (const intervalles of [...Object.values(programme.verts), ...Object.values(programme.jaunes)]) {
    for (const [a, b] of intervalles) for (const t of [a, b]) if (t > 0 && t < cycle) instants.add(t);
  }
  const bornes = [...instants].sort((a, b) => a - b);
  const phases: Array<{ duree_s: number; etat: string }> = [];
  for (let i = 0; i < bornes.length - 1; i++) {
    const [a, b] = [bornes[i]!, bornes[i + 1]!];
    if (b - a < 1e-6) continue;
    const t = (a + b) / 2;
    const etat = lignes.map((l) => (l === null ? SANS_LIGNE : ETATS[etatLigne(programme, l, t)])).join('');
    const derniere = phases.at(-1);
    if (derniere?.etat === etat) derniere.duree_s += b - a;
    else phases.push({ duree_s: b - a, etat });
  }
  return phases;
}

const duree = (s: number) => String(Math.round(s * 100) / 100);

/** `<tlLogic>` d'une jonction : son programme, état par lien dans l'ordre de `liens` (linkIndex). */
export function versTlLogic(id: string, programme: { code: string } & Pick<ResultatProgramme, 'cycle_s' | 'verts' | 'jaunes'>, liens: readonly LienSumo[]): string {
  const phases = phasesSumo(programme, liens.map((l) => l.ligne));
  return [
    `  <tlLogic id="${id}" programID="${programme.code.replace(/[^A-Za-z0-9_-]/g, '_')}" offset="0" type="static">`,
    ...phases.map((p) => `    <phase duration="${duree(p.duree_s)}" state="${p.etat}"/>`),
    '  </tlLogic>',
  ].join('\n');
}
