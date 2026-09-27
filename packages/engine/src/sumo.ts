/**
 * Export du réseau au format SUMO « plain XML » (nœuds, arêtes, connexions), à passer à
 * netconvert — docs/RESEAU.md.
 *
 * - Chaque tronçon donne une arête par sens de circulation : `t<id>` (de → vers) et `-t<id>`.
 * - Un carrefour configuré devient un nœud à feux, au centre de ses branches. Chaque branche y
 *   mène par une arête d'approche à ses propres voies (`<branche>_e` vers le centre, `_s` depuis
 *   le centre), qui démarre au bout du tronçon raccordé (ou au bout des voies, sans tronçon).
 * - Les connexions dessinées dans le carrefour, les liens de raccordement et les liaisons de chaque
 *   nœud (saisies, ou proposées par défaut) deviennent des `<connection>`. SUMO numérote les voies de la droite (0) vers la gauche : l'index SUMO d'une
 *   voie de rang r parmi n (rang 0 = la plus à gauche) est n − 1 − r.
 *
 * Les coordonnées sont écrites en longitude, latitude : netconvert les projette
 * (`proj.plain-geo` + `proj.utm`, voir `configurationNetconvert`).
 */
import { lireCleVoie, type Connexion } from './connexions.js';
import { HIERARCHIE_VOIES } from './nommage.js';
import { boutsAuNoeud, liaisonsRetenues, liensParDefaut, type Liaison } from './reseau.js';
import type { LonLat, Segment } from './geometrie.js';

export type TypeVoieSumo = 'generale' | 'bus' | 'velo' | 'tram';

export interface NoeudSumo {
  id: string;
  position: LonLat;
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
  vitesse_kmh: number | null;
  nom: string | null;
  highway: string | null;
}

export interface BrancheSumo {
  code: string;
  voies: Array<{ sens: 'entrante' | 'sortante'; rang: number; type: TypeVoieSumo; geom: Segment }>;
}

export interface CarrefourSumo {
  id: string;
  nom: string;
  /** Nœud du réseau qui représente le carrefour. */
  noeud: string;
  centre: LonLat;
  branches: BrancheSumo[];
  connexions: Connexion[];
}

export interface RaccordementSumo {
  troncon: string;
  extremite: 'de' | 'vers';
  carrefour: string;
  branche: string;
  /** Liens voie à voie (rangs) : [tronçon → branche] à l'entrée, [branche → tronçon] à la sortie. */
  liens: { entree: Array<[number, number]>; sortie: Array<[number, number]> } | null;
}

export interface ReseauSumo {
  noeuds: NoeudSumo[];
  troncons: TronconSumo[];
  carrefours: CarrefourSumo[];
  raccordements: RaccordementSumo[];
}

export interface ExportSumo {
  nod: string;
  edg: string;
  con: string;
  alertes: string[];
}

/** Vitesse retenue quand OSM ne donne pas `maxspeed` (km/h), selon le type de voie. */
export function vitesseParDefaut(highway: string | null): number {
  if (highway === 'living_street') return 20;
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

/** Les approches d'un carrefour à feux passent avant les rues qui s'y raccordent. */
const PRIORITE_APPROCHE = HIERARCHIE_VOIES.length + 1;

const ALLOW: Record<TypeVoieSumo, string | null> = { generale: null, bus: 'bus', velo: 'bicycle', tram: 'tram' };

const echapper = (texte: string) =>
  texte.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const coord = ([lon, lat]: LonLat) => `${lon.toFixed(7)},${lat.toFixed(7)}`;
const forme = (points: readonly LonLat[]) => points.map(coord).join(' ');
const indexSumo = (nombre: number, rang: number) => nombre - 1 - rang;

const moyenne = (points: readonly LonLat[]): LonLat => [
  points.reduce((s, p) => s + p[0], 0) / points.length,
  points.reduce((s, p) => s + p[1], 0) / points.length,
];

interface Arete {
  id: string;
  de: string;
  vers: string;
  voies: number;
  vitesse_kmh: number;
  priorite: number;
  nom: string | null;
  points: LonLat[];
  /** Type de chaque voie, index SUMO (0 = la plus à droite) ; absent : toutes générales. */
  types?: TypeVoieSumo[];
}

/** Arêtes d'approche d'une branche : vers le centre (entrantes) et depuis le centre (sortantes). */
interface Approche {
  noeud: string;
  entree?: { arete: string; voies: number };
  sortie?: { arete: string; voies: number };
}

export function exporterSumo(reseau: ReseauSumo): ExportSumo {
  const alertes: string[] = [];
  const noeuds = new Map<string, { position: LonLat; type: 'priority' | 'traffic_light' | 'dead_end' }>();
  const aretes: Arete[] = [];
  const connexions: string[] = [];

  for (const n of reseau.noeuds) noeuds.set(n.id, { position: n.position, type: 'priority' });
  const tronconsParId = new Map(reseau.troncons.map((t) => [t.id, t]));
  const raccordements = new Map(reseau.raccordements.map((r) => [`${r.troncon}:${r.extremite}`, r]));

  // ── Carrefours : nœud à feux et arêtes d'approche de chaque branche ──
  const approches = new Map<string, Approche>(); // clé : carrefour:branche:troncon:extremite ou carrefour:branche
  /** Arête d'approche qui porte les voies entrantes (resp. sortantes) de chaque branche d'un carrefour. */
  const entreesBranche = new Map<string, { arete: string; voies: number }>();
  const sortiesBranche = new Map<string, { arete: string; voies: number }>();

  for (const c of reseau.carrefours) {
    const idNoeud = `c${c.id}`;
    noeuds.set(idNoeud, { position: c.centre, type: 'traffic_light' });
    for (const b of c.branches) {
      const entrantes = b.voies.filter((v) => v.sens === 'entrante').sort((p, q) => p.rang - q.rang);
      const sortantes = b.voies.filter((v) => v.sens === 'sortante').sort((p, q) => p.rang - q.rang);
      const lies = reseau.raccordements.filter((r) => r.carrefour === c.id && r.branche === b.code && tronconsParId.has(r.troncon));
      // Bouts de tronçons raccordés à cette branche, ou à défaut le bout des voies (branche sans tronçon).
      const bouts =
        lies.length > 0
          ? lies.map((r) => {
              const t = tronconsParId.get(r.troncon)!;
              const point = r.extremite === 'de' ? t.points[0]! : t.points.at(-1)!;
              const arrivent = r.extremite === 'vers' ? t.voies_avant : t.voies_arriere;
              const repartent = r.extremite === 'vers' ? t.voies_arriere : t.voies_avant;
              const vitesse_kmh = t.vitesse_kmh ?? vitesseParDefaut(t.highway);
              return { cle: `${c.id}:${b.code}:${r.troncon}:${r.extremite}`, noeud: `r${r.troncon}_${r.extremite}`, point, arrivent, repartent, vitesse_kmh };
            })
          : [
              {
                cle: `${c.id}:${b.code}`,
                noeud: `b${c.id}_${b.code}`,
                point: moyenne(b.voies.map((v) => v.geom[1])),
                arrivent: 1,
                repartent: 1,
                vitesse_kmh: vitesseParDefaut(null),
              },
            ];
      if (lies.length === 0 && b.voies.length > 0) alertes.push(`${c.nom} : branche ${b.code} sans tronçon raccordé (cul-de-sac)`);

      for (const bout of bouts) {
        noeuds.set(bout.noeud, { position: bout.point, type: lies.length > 0 ? 'priority' : 'dead_end' });
        const approche: Approche = { noeud: bout.noeud };
        if (entrantes.length > 0 && bout.arrivent > 0) {
          if (entreesBranche.has(`${c.id}:${b.code}`)) {
            alertes.push(`${c.nom} : plusieurs tronçons arrivent sur la branche ${b.code}, seul le premier mène à ses voies entrantes`);
          } else {
            const id = `a${c.id}_${b.code}_e${lies.length > 0 ? `_${bout.noeud}` : ''}`;
            aretes.push({
              id,
              de: bout.noeud,
              vers: idNoeud,
              voies: entrantes.length,
              vitesse_kmh: bout.vitesse_kmh,
              priorite: PRIORITE_APPROCHE,
              nom: null,
              points: [bout.point, moyenne(entrantes.map((v) => v.geom[0]))],
              types: [...entrantes].reverse().map((v) => v.type),
            });
            approche.entree = { arete: id, voies: entrantes.length };
            entreesBranche.set(`${c.id}:${b.code}`, approche.entree);
          }
        }
        if (sortantes.length > 0 && bout.repartent > 0) {
          if (sortiesBranche.has(`${c.id}:${b.code}`)) {
            alertes.push(`${c.nom} : plusieurs tronçons partent de la branche ${b.code}, seul le premier reçoit ses voies sortantes`);
          } else {
            const id = `a${c.id}_${b.code}_s${lies.length > 0 ? `_${bout.noeud}` : ''}`;
            aretes.push({
              id,
              de: idNoeud,
              vers: bout.noeud,
              voies: sortantes.length,
              vitesse_kmh: bout.vitesse_kmh,
              priorite: PRIORITE_APPROCHE,
              nom: null,
              points: [moyenne(sortantes.map((v) => v.geom[0])), bout.point],
              types: [...sortantes].reverse().map((v) => v.type),
            });
            approche.sortie = { arete: id, voies: sortantes.length };
            sortiesBranche.set(`${c.id}:${b.code}`, approche.sortie);
          }
        }
        approches.set(bout.cle, approche);
      }
    }

    // Connexions dessinées dans le carrefour.
    for (const { de, vers } of c.connexions) {
      const entree = lireCleVoie(de);
      const sortie = lireCleVoie(vers);
      const depuis = entree && entreesBranche.get(`${c.id}:${entree.branche}`);
      const jusqua = sortie && sortiesBranche.get(`${c.id}:${sortie.branche}`);
      if (!entree || !sortie || !depuis || !jusqua) continue;
      connexions.push(
        `  <connection from="${depuis.arete}" to="${jusqua.arete}" fromLane="${indexSumo(depuis.voies, entree.rang)}" toLane="${indexSumo(jusqua.voies, sortie.rang)}"/>`,
      );
    }
  }

  // ── Tronçons : une arête par sens ; un bout raccordé part du nœud de raccordement ──
  const noeudCarrefour = new Map(reseau.carrefours.map((c) => [c.noeud, c]));
  for (const t of reseau.troncons) {
    const bout = (extremite: 'de' | 'vers') => {
      const r = raccordements.get(`${t.id}:${extremite}`);
      const idNoeud = extremite === 'de' ? t.de : t.vers;
      if (r && noeuds.has(`r${t.id}_${extremite}`)) return `r${t.id}_${extremite}`;
      const c = noeudCarrefour.get(idNoeud);
      if (c) {
        alertes.push(`${c.nom} : tronçon ${t.nom ?? t.id} non raccordé à une branche`);
        // Nœud de bout isolé : le tronçon s'arrête au cercle du carrefour, sans y entrer.
        const id = `r${t.id}_${extremite}`;
        noeuds.set(id, { position: extremite === 'de' ? t.points[0]! : t.points.at(-1)!, type: 'dead_end' });
        return id;
      }
      return idNoeud;
    };
    const de = bout('de');
    const vers = bout('vers');
    if (de === vers) {
      alertes.push(`Tronçon ${t.nom ?? t.id} : boucle sur un seul nœud, ignoré`);
      continue;
    }
    const commun = { vitesse_kmh: t.vitesse_kmh ?? vitesseParDefaut(t.highway), priorite: priorite(t.highway), nom: t.nom };
    if (t.voies_avant > 0) aretes.push({ ...commun, id: `t${t.id}`, de, vers, voies: t.voies_avant, points: t.points });
    if (t.voies_arriere > 0) aretes.push({ ...commun, id: `-t${t.id}`, de: vers, vers: de, voies: t.voies_arriere, points: [...t.points].reverse() });

    // Liens au raccordement : tronçon → voies entrantes de la branche, voies sortantes → tronçon.
    for (const extremite of ['de', 'vers'] as const) {
      const r = raccordements.get(`${t.id}:${extremite}`);
      const approche = r && approches.get(`${r.carrefour}:${r.branche}:${t.id}:${extremite}`);
      if (!r || !approche) continue;
      const arrivee = extremite === 'vers' ? { arete: `t${t.id}`, voies: t.voies_avant } : { arete: `-t${t.id}`, voies: t.voies_arriere };
      const depart = extremite === 'vers' ? { arete: `-t${t.id}`, voies: t.voies_arriere } : { arete: `t${t.id}`, voies: t.voies_avant };
      if (approche.entree && arrivee.voies > 0) {
        for (const [i, j] of r.liens?.entree ?? liensParDefaut(arrivee.voies, approche.entree.voies)) {
          if (i >= arrivee.voies || j >= approche.entree.voies) continue;
          connexions.push(
            `  <connection from="${arrivee.arete}" to="${approche.entree.arete}" fromLane="${indexSumo(arrivee.voies, i)}" toLane="${indexSumo(approche.entree.voies, j)}"/>`,
          );
        }
      }
      if (approche.sortie && depart.voies > 0) {
        for (const [j, i] of r.liens?.sortie ?? liensParDefaut(approche.sortie.voies, depart.voies)) {
          if (j >= approche.sortie.voies || i >= depart.voies) continue;
          connexions.push(
            `  <connection from="${approche.sortie.arete}" to="${depart.arete}" fromLane="${indexSumo(approche.sortie.voies, j)}" toLane="${indexSumo(depart.voies, i)}"/>`,
          );
        }
      }
    }
  }

  // ── Liaisons voie à voie aux nœuds ordinaires (ni carrefour, ni cul-de-sac) ──
  const emises = new Set(aretes.map((a) => a.id));
  const parNoeud = new Map<string, TronconSumo[]>();
  for (const t of reseau.troncons) {
    for (const n of [t.de, t.vers]) parNoeud.set(n, [...(parNoeud.get(n) ?? []), t]);
  }
  for (const n of reseau.noeuds) {
    const autour = parNoeud.get(n.id) ?? [];
    if (noeudCarrefour.has(n.id) || autour.length < 2) continue;
    const bouts = boutsAuNoeud(
      n.id,
      autour.map((t) => ({ id: t.id, noeud_de: t.de, noeud_vers: t.vers, points: t.points, voies_avant: t.voies_avant, voies_arriere: t.voies_arriere })),
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

  // Nœuds utilisés seulement.
  const utilises = new Set(aretes.flatMap((a) => [a.de, a.vers]));
  const nod = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!-- Besançon Voirie : nœuds du réseau (lon, lat : option proj.plain-geo de netconvert) -->',
    '<nodes>',
    ...[...noeuds]
      .filter(([id]) => utilises.has(id))
      .map(([id, n]) => `  <node id="${id}" x="${n.position[0].toFixed(7)}" y="${n.position[1].toFixed(7)}" type="${n.type}"/>`),
    '</nodes>',
    '',
  ].join('\n');

  const edg = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!-- Besançon Voirie : tronçons (t…, -t… en sens inverse) et approches des carrefours (a…) -->',
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
      const voiesTypees = (a.types ?? []).map((type, index) => ({ index, allow: ALLOW[type] })).filter((v) => v.allow);
      if (voiesTypees.length === 0) return `  <edge ${attributs}/>`;
      return [
        `  <edge ${attributs}>`,
        ...voiesTypees.map((v) => `    <lane index="${v.index}" allow="${v.allow}"/>`),
        '  </edge>',
      ].join('\n');
    }),
    '</edges>',
    '',
  ].join('\n');

  const con = ['<?xml version="1.0" encoding="UTF-8"?>', '<connections>', ...connexions, '</connections>', ''].join('\n');
  return { nod, edg, con, alertes };
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
