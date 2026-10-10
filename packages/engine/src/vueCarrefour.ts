/**
 * Vue d'un carrefour tirée du réseau — docs/RESEAU.md §4. Un carrefour est un groupe de nœuds du
 * réseau : on en déduit ses branches, leurs voies, ses passages piétons et ses connexions, sous
 * la forme qu'attendent les lignes de feux, les conflits et le programme (docs/CONFIGURATION.md).
 *
 * - **Branche** : un tronçon qui entre dans le groupe depuis l'extérieur. Ses voies entrantes
 *   arrivent à sa ligne d'arrêt (premier feu de son approche), ses voies sortantes en repartent.
 *   À l'intérieur du groupe, un feu véhicule sur un tronçon interne (nœud de degré 2 : terre-plein
 *   central, anneau d'un giratoire) ouvre une **branche interne** : on y arrive, puis on en repart.
 * - **Connexion** : d'une voie entrante à une voie sortante, comme dans un carrefour dessiné à la
 *   main ; le carrefour est une boîte noire dont on ne voit que les bouts de rues. Celles
 *   proposées suivent les liaisons de chaque nœud du groupe (le chemin existe dans le réseau) ;
 *   une fois retouchées et enregistrées, elles sont gardées telles quelles (docs/RESEAU.md §4).
 * - **Code** : point cardinal de la branche (N, S2…) ou R1, R2… pour une branche interne ; un
 *   code déjà donné est gardé (`branche_de` / `branche_vers` du tronçon), car les lignes de feux
 *   y renvoient.
 */
import { codeCardinal } from './branches.js';
import { cleVoie } from './connexions.js';
import { LARGEUR_VOIE_M, repereLocal, type LonLat, type Segment, type XY } from './geometrie.js';
import { placerVoiesTroncon, type PlacementsVoies } from './editionVoies.js';
import { boutsAuNoeud, largeurTroncon, liaisonsRetenues, retraitAuNoeud, typesVoies, voiesTroncon, type Liaison, type TypeVoieReseau } from './reseau.js';

export interface NoeudVue {
  id: string;
  position: LonLat;
  /** Ligne d'arrêt à feux des véhicules. */
  feux: boolean;
  /** Passage piéton ; null : aucun. */
  pieton: string | null;
  /** Liaisons saisies ; null : celles proposées par défaut. */
  liaisons: Liaison[] | null;
  /** Places visuelles des bouts de voies (docs/voies-position-visuelle.md) ; seul le dessin les suit. */
  placements?: PlacementsVoies | null;
}

export interface TronconVue {
  id: string;
  noeud_de: string;
  noeud_vers: string;
  points: LonLat[];
  voies_avant: number;
  voies_arriere: number;
  types_avant: TypeVoieReseau[] | null;
  types_arriere: TypeVoieReseau[] | null;
  nom: string | null;
  osm_way_id: number | null;
  /** Codes de branche déjà donnés à chaque bout. */
  branche_de: string | null;
  branche_vers: string | null;
}

export interface EntreeVue {
  /** Nœuds du carrefour. */
  noeuds: NoeudVue[];
  /** Tronçons qui touchent au moins un nœud du carrefour. */
  troncons: TronconVue[];
  /** Nombre de tronçons de chaque nœud touché, dans tout le réseau. */
  degres: ReadonlyMap<string, number>;
  /**
   * Passages piétons tracés librement qui traversent ces tronçons : un passage qui coupe la ligne
   * d'arrêt ou l'approche d'une branche en fait la traversée (docs/pipeline-donnees.md, étape 11).
   */
  passages?: ReadonlyArray<{ id: string; points: readonly [LonLat, LonLat]; troncons: readonly string[] }>;
}

export interface VoieVue {
  sens: 'entrante' | 'sortante';
  rang: number;
  type: TypeVoieReseau;
  /**
   * [bout côté carrefour, bout éloigné], à la place automatique : c'est elle que lisent les
   * mouvements, les conflits et le temps réel.
   */
  geom: Segment;
  /**
   * Dessin de la voie depuis son bout côté carrefour, sur `LONGUEUR_VOIE_M` : il suit la rue, et
   * la place posée à la main (docs/voies-position-visuelle.md). Seul le calque le lit.
   */
  trace: LonLat[];
}

export interface BrancheVue {
  code: string;
  nom: string | null;
  /** Degrés depuis le nord, du nœud vers la branche. */
  azimut: number;
  osm_way_id: number | null;
  /** Axe, du nœud vers l'extérieur. */
  geom: LonLat[];
  voies: VoieVue[];
  traversee: Segment | null;
  /** Passage piéton libre qui fait cette traversée ; null : passage sur nœud, ou aucun. */
  passage: string | null;
  /** Branche interne : ligne d'arrêt à feux sur un tronçon du carrefour. */
  interne: boolean;
}

export interface ConnexionVue {
  de: string;
  vers: string;
}

export interface VueCarrefour {
  branches: BrancheVue[];
  connexions: ConnexionVue[];
  /** Code de chaque bout de tronçon qui forme une branche, à garder d'un calcul à l'autre. */
  codes: Array<{ troncon: string; extremite: 'de' | 'vers'; code: string }>;
  alertes: string[];
}

/** Longueur des voies d'une branche (m), depuis la ligne d'arrêt. */
const LONGUEUR_VOIE_M = 25;
/** Longueur de l'axe d'une branche (m). */
const LONGUEUR_AXE_M = 40;
/** Débord d'un passage piéton de chaque côté de la chaussée (m). */
const DEBORD_PASSAGE_M = 1.5;
/** Chemin le plus long à travers le carrefour (nombre de nœuds). */
const PROFONDEUR_MAX = 30;
const CODE_VALIDE = /^[A-Z0-9]{1,4}$/;

/** Les `longueur` premiers mètres d'une polyligne. */
function debut(points: readonly LonLat[], longueur: number): LonLat[] {
  const repere = repereLocal(points[0]!);
  const xy = points.map(repere.versXY);
  const sortie: XY[] = [xy[0]!];
  let reste = longueur;
  for (let i = 1; i < xy.length && reste > 0; i++) {
    const [a, b] = [xy[i - 1]!, xy[i]!];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (l >= reste) {
      const t = reste / (l || 1);
      sortie.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      break;
    }
    sortie.push(b);
    reste -= l;
  }
  if (sortie.length === 1) sortie.push(xy.at(-1)!);
  return sortie.map(repere.versLonLat);
}

/** Segment [premier point, point à `longueur` mètres le long de la polyligne]. */
const segmentDepuis = (points: readonly LonLat[], longueur = LONGUEUR_VOIE_M): Segment => {
  const d = debut(points, longueur);
  return [d[0]!, d.at(-1)!];
};

/** Porte du carrefour : bout de tronçon qui forme une branche, à sa ligne d'arrêt. */
interface Porte {
  troncon: TronconVue;
  extremite: 'de' | 'vers';
  noeud: string;
  interne: boolean;
  azimut: number;
  code: string;
  /** Nœuds de l'approche où chercher le passage piéton, du plus probable au moins probable. */
  approche: Array<{ troncon: TronconVue; noeud: string }>;
}

export function vueCarrefour({ noeuds, troncons, degres, passages = [] }: EntreeVue): VueCarrefour {
  const dans = new Map(noeuds.map((n) => [n.id, n]));
  const alertes: string[] = [];
  const noeudA = (t: TronconVue, extremite: 'de' | 'vers') => (extremite === 'de' ? t.noeud_de : t.noeud_vers);

  // ── Voies de chaque tronçon, reculées aux intersections (degré ≥ 3) ──
  const largeurMax = new Map<string, number>();
  for (const t of troncons) {
    for (const n of [t.noeud_de, t.noeud_vers]) largeurMax.set(n, Math.max(largeurMax.get(n) ?? 0, largeurTroncon(t)));
  }
  const retrait = (n: string) => ((degres.get(n) ?? 0) >= 3 ? retraitAuNoeud(degres.get(n)!, largeurMax.get(n) ?? LARGEUR_VOIE_M) : 0);
  const voies = new Map(
    troncons.map((t) => [
      t.id,
      voiesTroncon(t.points, t.voies_avant, t.voies_arriere, retrait(t.noeud_de), retrait(t.noeud_vers), { avant: t.types_avant, arriere: t.types_arriere }),
    ]),
  );
  // Voies dessinées, bouts placés à la main (docs/voies-position-visuelle.md) : pour le calque seulement.
  const dessinees = new Map(
    troncons.map((t) => [t.id, placerVoiesTroncon(voies.get(t.id)!, t.id, dans.get(t.noeud_de)?.placements, dans.get(t.noeud_vers)?.placements)]),
  );
  /** Voies d'un tronçon qui arrivent au nœud (dans le sens de circulation), dessinées, et leurs types. */
  const arrivant = (t: TronconVue, noeud: string) =>
    noeud === t.noeud_vers
      ? { polylignes: voies.get(t.id)!.avant, dessins: dessinees.get(t.id)!.avant, types: typesVoies(t.voies_avant, t.types_avant) }
      : { polylignes: voies.get(t.id)!.arriere, dessins: dessinees.get(t.id)!.arriere, types: typesVoies(t.voies_arriere, t.types_arriere) };
  const partant = (t: TronconVue, noeud: string) =>
    noeud === t.noeud_de
      ? { polylignes: voies.get(t.id)!.avant, dessins: dessinees.get(t.id)!.avant, types: typesVoies(t.voies_avant, t.types_avant) }
      : { polylignes: voies.get(t.id)!.arriere, dessins: dessinees.get(t.id)!.arriere, types: typesVoies(t.voies_arriere, t.types_arriere) };

  // ── Liaisons de chaque nœud du carrefour ──
  const autour = new Map<string, TronconVue[]>();
  for (const t of troncons) {
    for (const n of [t.noeud_de, t.noeud_vers]) if (dans.has(n)) autour.set(n, [...(autour.get(n) ?? []), t]);
  }
  const bouts = new Map(noeuds.map((n) => [n.id, boutsAuNoeud(n.id, autour.get(n.id) ?? [])]));
  const liaisons = new Map(noeuds.map((n) => [n.id, liaisonsRetenues(bouts.get(n.id)!, n.liaisons).liaisons]));
  const azimutBout = (t: TronconVue, noeud: string) => bouts.get(noeud)?.find((b) => b.troncon === t.id)?.azimut ?? 0;

  // ── Portes ──
  const degre = (n: string) => degres.get(n) ?? 0;
  /** Pas vers l'intérieur depuis un nœud de degré 2 : son autre tronçon et l'autre bout de celui-ci, s'il est du groupe. */
  const pasSuivant = (troncon: TronconVue, noeud: string) => {
    if (degre(noeud) !== 2) return null;
    const suite = (autour.get(noeud) ?? []).find((t) => t.id !== troncon.id);
    if (!suite) return null;
    const loin = suite.noeud_de === noeud ? suite.noeud_vers : suite.noeud_de;
    return dans.has(loin) ? { troncon: suite, noeud: loin } : null;
  };
  const extremiteA = (t: TronconVue, noeud: string) => (t.noeud_vers === noeud ? 'vers' : 'de');

  // Branches de bord : depuis le bout qui entre dans le groupe, on suit l'approche (nœuds de
  // degré 2 : passage piéton, élargissement) jusqu'à l'intersection. La ligne d'arrêt, où
  // arrivent les voies entrantes de la branche, est son premier feu véhicule ; à défaut son
  // premier passage piéton à feux (traversée piétonne) ; à défaut l'intersection.
  const portes: Omit<Porte, 'code'>[] = [];
  const surUneApproche = new Set<string>();
  for (const t of troncons) {
    const [de, vers] = [dans.has(t.noeud_de), dans.has(t.noeud_vers)];
    if (de === vers) continue;
    const chaine = [{ troncon: t, noeud: noeudA(t, de ? 'de' : 'vers') }];
    for (let pas = 0; pas < PROFONDEUR_MAX; pas++) {
      const suivant = pasSuivant(chaine.at(-1)!.troncon, chaine.at(-1)!.noeud);
      if (!suivant) break;
      chaine.push(suivant);
    }
    const i =
      [chaine.findIndex((c) => dans.get(c.noeud)!.feux), chaine.findIndex((c) => dans.get(c.noeud)!.pieton === 'feux')].find((k) => k >= 0) ??
      chaine.length - 1;
    const arret = chaine[i]!;
    for (const { noeud } of chaine) surUneApproche.add(noeud);
    portes.push({
      troncon: arret.troncon,
      extremite: extremiteA(arret.troncon, arret.noeud),
      noeud: arret.noeud,
      interne: false,
      azimut: azimutBout(arret.troncon, arret.noeud),
      approche: [...chaine.slice(i + 1), ...chaine.slice(0, i).reverse()],
    });
  }
  // Branches internes : un feu véhicule hors des approches (terre-plein central, anneau).
  for (const n of noeuds) {
    if (!n.feux || degre(n.id) !== 2 || surUneApproche.has(n.id)) continue;
    for (const t of autour.get(n.id) ?? []) {
      if (arrivant(t, n.id).polylignes.length === 0) continue;
      portes.push({ troncon: t, extremite: extremiteA(t, n.id), noeud: n.id, interne: true, azimut: azimutBout(t, n.id), approche: [] });
    }
  }

  // Codes : ceux déjà donnés (valides et uniques), puis les nouveaux dans l'ordre des azimuts.
  const pris = new Set<string>();
  const codes = new Map<Omit<Porte, 'code'>, string>();
  for (const p of portes) {
    const garde = p.extremite === 'de' ? p.troncon.branche_de : p.troncon.branche_vers;
    if (garde && CODE_VALIDE.test(garde) && !pris.has(garde)) {
      codes.set(p, garde);
      pris.add(garde);
    }
  }
  const libre = (base: string) => {
    for (let i = 1; ; i++) {
      const code = base === 'R' ? `R${i}` : i === 1 ? base : `${base}${i}`;
      if (!pris.has(code)) return (pris.add(code), code);
    }
  };
  for (const p of [...portes].sort((a, b) => a.azimut - b.azimut)) {
    if (!codes.has(p)) codes.set(p, libre(p.interne ? 'R' : codeCardinal(p.azimut)));
  }
  const toutes: Porte[] = portes.map((p) => ({ ...p, code: codes.get(p)! }));
  const porteDe = (troncon: string, noeud: string) => toutes.find((p) => p.troncon.id === troncon && p.noeud === noeud);

  // ── Voies des branches ──
  const branches: BrancheVue[] = toutes.map((p) => {
    const t = p.troncon;
    const entrantes = arrivant(t, p.noeud);
    // Branche de bord : les voies qui repartent vers l'extérieur. Branche interne : les mêmes voies
    // que les entrantes, prises à leur départ (on y arrive depuis le nœud d'avant).
    const sortantes = p.interne ? entrantes : partant(t, p.noeud);
    const axe = p.extremite === 'de' ? t.points : [...t.points].reverse();
    return {
      code: p.code,
      nom: t.nom,
      azimut: Math.round(p.azimut * 10) / 10,
      osm_way_id: t.osm_way_id,
      geom: debut(axe, LONGUEUR_AXE_M),
      voies: [
        ...entrantes.polylignes.map((l, rang): VoieVue => ({
          sens: 'entrante',
          rang,
          type: entrantes.types[rang]!,
          geom: segmentDepuis([...l].reverse()),
          trace: debut([...entrantes.dessins[rang]!].reverse(), LONGUEUR_VOIE_M),
        })),
        ...sortantes.polylignes.map(
          (l, rang): VoieVue => ({
            sens: 'sortante',
            rang,
            type: sortantes.types[rang]!,
            geom: segmentDepuis(l),
            trace: debut(sortantes.dessins[rang]!, LONGUEUR_VOIE_M),
          }),
        ),
      ],
      ...(p.interne ? { traversee: null, passage: null } : traverseeDe(p)),
      interne: p.interne,
    };
  });

  // Passage piéton d'une branche : un passage libre qui coupe sa ligne d'arrêt ou son approche ;
  // sinon celui d'un nœud, sur sa ligne d'arrêt, entre elle et l'intersection, sinon en amont.
  function traverseeDe(p: Porte): { traversee: Segment | null; passage: string | null } {
    const approche = new Set([p.troncon.id, ...p.approche.map((a) => a.troncon.id)]);
    const libre = passages.find((pp) => pp.troncons.some((t) => approche.has(t)));
    if (libre) return { traversee: [libre.points[0], libre.points[1]], passage: libre.id };
    const trouve = [{ troncon: p.troncon, noeud: p.noeud }, ...p.approche].find((a) => dans.get(a.noeud)?.pieton);
    return { traversee: trouve ? travers(trouve.troncon, trouve.noeud) : null, passage: null };
  }
  function travers(t: TronconVue, noeud: string): Segment {
    const centre = dans.get(noeud)!.position;
    const repere = repereLocal(centre);
    const axe = (noeud === t.noeud_de ? t.points : [...t.points].reverse()).map(repere.versXY);
    const [x, y] = axe[1] ?? [0, 1];
    const l = Math.hypot(x, y) || 1;
    const demi = largeurTroncon(t) / 2 + DEBORD_PASSAGE_M;
    const n: XY = [-y / l, x / l];
    return [repere.versLonLat([n[0] * demi, n[1] * demi]), repere.versLonLat([-n[0] * demi, -n[1] * demi])];
  }

  // ── Connexions proposées : chemins voie à voie à travers le groupe, en suivant les liaisons ──
  const connexions = new Map<string, ConnexionVue>();
  const ajouter = (de: string, vers: string) => {
    const cle = `${de}>${vers}`;
    if (!connexions.has(cle)) connexions.set(cle, { de, vers });
  };
  for (const p of toutes) {
    const entrantes = arrivant(p.troncon, p.noeud).polylignes;
    entrantes.forEach((_, rang) => {
      const de = cleVoie(p.code, 'entrante', rang);
      const parcourir = (noeud: string, troncon: string, voie: number, vus: Set<string>, profondeur: number) => {
        if (profondeur > PROFONDEUR_MAX) return;
        for (const l of liaisons.get(noeud) ?? []) {
          if (l.de !== troncon || l.voie_de !== voie) continue;
          const suite = troncons.find((t) => t.id === l.vers);
          if (!suite) continue;
          if (!partant(suite, noeud).polylignes[l.voie_vers]) continue;
          const bout = suite.noeud_de === noeud ? 'vers' : 'de';
          const loin = noeudA(suite, bout);
          // Sortie par une branche de bord (le tronçon quitte le groupe).
          const sortie = porteDe(suite.id, noeud);
          if (sortie && !sortie.interne) {
            ajouter(de, cleVoie(sortie.code, 'sortante', l.voie_vers));
            continue;
          }
          if (!dans.has(loin)) continue;
          // Arrivée sur une ligne d'arrêt interne : la connexion s'arrête là.
          const interne = porteDe(suite.id, loin);
          if (interne?.interne) {
            ajouter(de, cleVoie(interne.code, 'sortante', l.voie_vers));
            continue;
          }
          const cle = `${suite.id}:${bout}:${l.voie_vers}`;
          if (vus.has(cle)) continue;
          parcourir(loin, suite.id, l.voie_vers, new Set([...vus, cle]), profondeur + 1);
        }
      };
      parcourir(p.noeud, p.troncon.id, rang, new Set(), 0);
    });
  }

  for (const b of branches) {
    for (const v of b.voies.filter((x) => x.sens === 'entrante')) {
      const cle = cleVoie(b.code, 'entrante', v.rang);
      if (![...connexions.values()].some((c) => c.de === cle)) alertes.push(`${b.code}, voie entrante ${v.rang + 1} : aucune connexion`);
    }
  }
  if (toutes.length === 0) alertes.push('Aucune rue n’entre dans le carrefour : ajouter ses nœuds');

  return {
    branches,
    connexions: [...connexions.values()],
    codes: toutes.map((p) => ({ troncon: p.troncon.id, extremite: p.extremite, code: p.code })),
    alertes,
  };
}
