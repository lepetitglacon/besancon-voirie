/**
 * Export du réseau au format SUMO « plain XML » (nœuds, arêtes, connexions), à passer à
 * netconvert — docs/RESEAU.md.
 *
 * - Chaque nœud du réseau donne un nœud SUMO. Les nœuds d'un carrefour à feux sont des nœuds
 *   `traffic_light` qui partagent un même feu (`tl="c<carrefour>"`), comme un feu temporisé de
 *   TM:PE posé sur plusieurs nœuds : netconvert les regroupe en un seul programme.
 * - Chaque tronçon donne une arête par sens de circulation : `t<id>` (de → vers) et `-t<id>`.
 * - Les liaisons de chaque nœud (saisies, ou proposées par défaut) deviennent des `<connection>`.
 *   SUMO numérote les voies de la droite (0) vers la gauche : l'index SUMO d'une voie de rang r
 *   parmi n (rang 0 = la plus à gauche) est n − 1 − r.
 *
 * - Un carrefour décrit dans `carrefours` (sa jonction, ses connexions, son programme) devient
 *   une seule jonction `c<carrefour>` avec ses liens et son `<tlLogic>` (voir sumoCarrefours.ts).
 * - Une voie dont l'emprise a été dessinée prend sa largeur moyenne (`<lane width>`).
 *
 * Les coordonnées sont écrites en longitude, latitude : netconvert les projette
 * (`proj.plain-geo` + `proj.utm`, voir `configurationNetconvert`).
 */
import { HIERARCHIE_VOIES } from './nommage.js';
import { boutsAuNoeud, liaisonsRetenues, type Liaison, type TypeVoieReseau } from './reseau.js';
import { LARGEUR_VOIE_VELO_M, type LonLat } from './geometrie.js';
import { cleEmprise, largeurEmprise, type EmprisesTroncon } from './editionVoies.js';
import { preparerJonctions, versTlLogic, type CarrefourSumo } from './sumoCarrefours.js';

export interface NoeudSumo {
  id: string;
  position: LonLat;
  /** Carrefour à feux dont le nœud fait partie ; null : nœud ordinaire. */
  carrefour: string | null;
  /** Liaisons voie à voie saisies ; null ou absent : celles proposées par défaut. */
  liaisons?: Liaison[] | null;
}

export interface TronconSumo {
  id: string;
  de: string;
  vers: string;
  points: LonLat[];
  voies_avant: number;
  voies_arriere: number;
  /** Type de chaque voie, rang 0 = la plus à gauche ; null ou absent : toutes générales. */
  types_avant?: TypeVoieReseau[] | null;
  types_arriere?: TypeVoieReseau[] | null;
  vitesse_kmh: number | null;
  nom: string | null;
  highway: string | null;
  /** Code de la branche que forme chaque bout dans un carrefour (N, S, R1…). */
  branche_de?: string | null;
  branche_vers?: string | null;
  /** Emprises réelles de voies (`avant:0`…), dessinées sur la photo. */
  emprises?: EmprisesTroncon | null;
}

export interface ReseauSumo {
  noeuds: NoeudSumo[];
  troncons: TronconSumo[];
  /** Carrefours exportés en une jonction, avec leurs connexions et leur programme. */
  carrefours?: CarrefourSumo[];
}

export interface ExportSumo {
  nod: string;
  edg: string;
  con: string;
  /** Programmes des carrefours (`<tlLogic>`) et ordre de leurs liens (`linkIndex`). */
  tll: string;
  alertes: string[];
}

/** Vitesse retenue quand OSM ne donne pas `maxspeed` (km/h), selon le type de voie. */
export function vitesseParDefaut(highway: string | null): number {
  if (highway === 'living_street' || highway === 'cycleway') return 20;
  if (highway === 'residential' || highway === 'service' || highway === 'pedestrian') return 30;
  if (highway?.startsWith('motorway')) return 90;
  if (highway?.startsWith('trunk')) return 70;
  return 50;
}

/** Priorité SUMO : plus la voie est importante, plus elle est prioritaire aux intersections simples. */
function priorite(highway: string | null): number {
  const base = highway?.replace(/_link$/, '') ?? 'road';
  const rang = (HIERARCHIE_VOIES as readonly string[]).indexOf(base);
  return rang < 0 ? 1 : HIERARCHIE_VOIES.length - rang;
}

const ALLOW: Record<TypeVoieReseau, string | null> = { generale: null, bus: 'bus', velo: 'bicycle', tram: 'tram' };

const echapper = (texte: string) =>
  texte.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const coord = ([lon, lat]: LonLat) => `${lon.toFixed(7)},${lat.toFixed(7)}`;
const forme = (points: readonly LonLat[]) => points.map(coord).join(' ');
const indexSumo = (nombre: number, rang: number) => nombre - 1 - rang;

interface Arete {
  id: string;
  de: string;
  vers: string;
  voies: number;
  vitesse_kmh: number;
  priorite: number;
  nom: string | null;
  points: LonLat[];
  /** Type de chaque voie, rang 0 = la plus à gauche ; null : toutes générales. */
  types: readonly TypeVoieReseau[] | null;
  /** Largeur réelle (m) de certaines voies, d'après leur emprise, par rang. */
  largeurs: ReadonlyMap<number, number>;
}

/** Largeur de chaque voie d'un sens qui a une emprise, par rang. */
function largeursEmprises(t: TronconSumo, sens: 'avant' | 'arriere', voies: number): Map<number, number> {
  const largeurs = new Map<number, number>();
  for (let rang = 0; rang < voies; rang++) {
    const polygone = t.emprises?.[cleEmprise(sens, rang)];
    const largeur = polygone ? largeurEmprise(polygone, t.points) : null;
    if (largeur !== null && largeur > 0.5 && largeur < 10) largeurs.set(rang, largeur);
  }
  return largeurs;
}

export function exporterSumo(reseau: ReseauSumo): ExportSumo {
  const jonctions = preparerJonctions(reseau);
  const alertes: string[] = [...jonctions.alertes];
  const aretes: Arete[] = [];
  const connexions: string[] = [];

  for (const t of reseau.troncons) {
    // Au cœur d'un carrefour exporté en jonction : le tronçon disparaît, ses liens sont ceux du carrefour.
    if (jonctions.interne(t)) continue;
    const de = jonctions.noeudSumo(t.de);
    const vers = jonctions.noeudSumo(t.vers);
    if (de === vers) {
      alertes.push(`Tronçon ${t.nom ?? t.id} : boucle sur un seul nœud, ignoré`);
      continue;
    }
    const commun = { vitesse_kmh: t.vitesse_kmh ?? vitesseParDefaut(t.highway), priorite: priorite(t.highway), nom: t.nom };
    if (t.voies_avant > 0) {
      aretes.push({
        ...commun,
        id: `t${t.id}`,
        de,
        vers,
        voies: t.voies_avant,
        points: t.points,
        types: t.types_avant ?? null,
        largeurs: largeursEmprises(t, 'avant', t.voies_avant),
      });
    }
    if (t.voies_arriere > 0) {
      aretes.push({
        ...commun,
        id: `-t${t.id}`,
        de: vers,
        vers: de,
        voies: t.voies_arriere,
        points: [...t.points].reverse(),
        types: t.types_arriere ?? null,
        largeurs: largeursEmprises(t, 'arriere', t.voies_arriere),
      });
    }
  }

  // ── Liaisons voie à voie à chaque nœud ──
  const emises = new Set(aretes.map((a) => a.id));
  const parNoeud = new Map<string, TronconSumo[]>();
  for (const t of reseau.troncons) {
    for (const n of [t.de, t.vers]) parNoeud.set(n, [...(parNoeud.get(n) ?? []), t]);
  }
  for (const n of reseau.noeuds) {
    const autour = parNoeud.get(n.id) ?? [];
    if (autour.length < 2 || jonctions.dansUnCoeur(n.id)) continue;
    const bouts = boutsAuNoeud(
      n.id,
      autour.map((t) => ({
        id: t.id,
        noeud_de: t.de,
        noeud_vers: t.vers,
        points: t.points,
        voies_avant: t.voies_avant,
        voies_arriere: t.voies_arriere,
        types_avant: t.types_avant ?? null,
        types_arriere: t.types_arriere ?? null,
      })),
    );
    for (const l of liaisonsRetenues(bouts, n.liaisons ?? null).liaisons) {
      const a = bouts.find((b) => b.troncon === l.de)!;
      const b = bouts.find((x) => x.troncon === l.vers)!;
      const depuis = a.extremite === 'vers' ? `t${l.de}` : `-t${l.de}`;
      const vers = b.extremite === 'de' ? `t${l.vers}` : `-t${l.vers}`;
      if (!emises.has(depuis) || !emises.has(vers)) continue;
      connexions.push(
        `  <connection from="${depuis}" to="${vers}" fromLane="${indexSumo(a.arrivent, l.voie_de)}" toLane="${indexSumo(b.repartent, l.voie_vers)}"/>`,
      );
    }
  }

  // Liens des carrefours exportés en jonction, et leurs programmes.
  const tll: string[] = [];
  for (const coeur of jonctions.coeurs) {
    const liens = coeur.liens.filter((l) => emises.has(l.depuis) && emises.has(l.vers));
    for (const l of liens) {
      connexions.push(`  <connection from="${l.depuis}" to="${l.vers}" fromLane="${l.voieDepuis}" toLane="${l.voieVers}"/>`);
    }
    if (!coeur.carrefour.programme || liens.length === 0) continue;
    tll.push(versTlLogic(coeur.id, coeur.carrefour.programme, liens));
    tll.push(
      ...liens.map(
        (l, index) => `  <connection from="${l.depuis}" to="${l.vers}" fromLane="${l.voieDepuis}" toLane="${l.voieVers}" tl="${coeur.id}" linkIndex="${index}"/>`,
      ),
    );
  }

  // Nœuds utilisés seulement.
  const utilises = new Set(aretes.flatMap((a) => [a.de, a.vers]));
  const nod = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!-- Besançon Voirie : nœuds du réseau (lon, lat : option proj.plain-geo de netconvert) -->',
    '<nodes>',
    ...reseau.noeuds
      .filter((n) => utilises.has(n.id))
      .map((n) => {
        const position = `x="${n.position[0].toFixed(7)}" y="${n.position[1].toFixed(7)}"`;
        // Nœud d'approche d'un carrefour exporté en jonction : un nœud ordinaire.
        return n.carrefour && !(reseau.carrefours ?? []).some((c) => c.id === n.carrefour)
          ? `  <node id="${n.id}" ${position} type="traffic_light" tl="c${n.carrefour}"/>`
          : `  <node id="${n.id}" ${position} type="priority"/>`;
      }),
    ...jonctions.coeurs
      .filter((c) => utilises.has(c.id))
      .map((c) => `  <node id="${c.id}" x="${c.position[0].toFixed(7)}" y="${c.position[1].toFixed(7)}" type="traffic_light" tl="${c.id}"/>`),
    '</nodes>',
    '',
  ].join('\n');

  const edg = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!-- Besançon Voirie : tronçons (t…, -t… en sens inverse) -->',
    '<edges>',
    ...aretes.map((a) => {
      const attributs = [
        `id="${a.id}"`,
        `from="${a.de}"`,
        `to="${a.vers}"`,
        `numLanes="${a.voies}"`,
        `speed="${(a.vitesse_kmh / 3.6).toFixed(2)}"`,
        `priority="${a.priorite}"`,
        ...(a.nom ? [`name="${echapper(a.nom)}"`] : []),
        `shape="${forme(a.points)}"`,
      ].join(' ');
      const voiesDecrites = Array.from({ length: a.voies }, (_, rang) => {
        const type = a.types?.[rang] ?? 'generale';
        const largeur = a.largeurs.get(rang) ?? (type === 'velo' ? LARGEUR_VOIE_VELO_M : null);
        return { index: indexSumo(a.voies, rang), allow: ALLOW[type], largeur };
      })
        .filter((v) => v.allow !== null || v.largeur !== null)
        .sort((p, q) => p.index - q.index);
      if (voiesDecrites.length === 0) return `  <edge ${attributs}/>`;
      return [
        `  <edge ${attributs}>`,
        ...voiesDecrites.map(
          (v) => `    <lane index="${v.index}"${v.allow ? ` allow="${v.allow}"` : ''}${v.largeur !== null ? ` width="${v.largeur.toFixed(2)}"` : ''}/>`,
        ),
        '  </edge>',
      ].join('\n');
    }),
    '</edges>',
    '',
  ].join('\n');

  const con = ['<?xml version="1.0" encoding="UTF-8"?>', '<connections>', ...connexions, '</connections>', ''].join('\n');
  const tllXml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!-- Besançon Voirie : programmes des carrefours (premier plan à cycle) et ordre de leurs liens -->',
    '<tlLogics>',
    ...tll,
    '</tlLogics>',
    '',
  ].join('\n');
  return { nod, edg, con, tll: tllXml, alertes };
}

/** Configuration netconvert : lit les trois fichiers en lon/lat, projette en UTM, écrit reseau.net.xml. */
export function configurationNetconvert(): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!-- netconvert -c reseau.netccfg -->',
    '<configuration>',
    '  <input>',
    '    <node-files value="reseau.nod.xml"/>',
    '    <edge-files value="reseau.edg.xml"/>',
    '    <connection-files value="reseau.con.xml"/>',
    '    <tllogic-files value="reseau.tll.xml"/>',
    '  </input>',
    '  <output>',
    '    <output-file value="reseau.net.xml"/>',
    '  </output>',
    '  <projection>',
    '    <proj.utm value="true"/>',
    '    <proj.plain-geo value="true"/>',
    '  </projection>',
    '  <processing>',
    '    <no-turnarounds.tls value="true"/>',
    '  </processing>',
    '  <junctions>',
    '    <junctions.join value="false"/>',
    '  </junctions>',
    '</configuration>',
    '',
  ].join('\n');
}
