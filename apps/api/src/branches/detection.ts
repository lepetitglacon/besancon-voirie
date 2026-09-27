/**
 * Proposition de branches à partir des voies OSM qui traversent le cercle autour d'un
 * carrefour — docs/CONFIGURATION.md §3. Logique pure (sans base), testée à part.
 */
import { codesBranches, lireTurnLanes, voiesParDefaut, type Direction } from '@voirie/engine';

/** Point où une voie OSM traverse le cercle autour du carrefour. */
export interface Passage {
  osmId: number;
  tags: Record<string, string>;
  /** Degrés depuis le nord, du centre vers le passage. */
  azimut: number;
  lon: number;
  lat: number;
  /** La voie OSM, dans son sens de tracé, arrive de l'intérieur du cercle (elle en sort). */
  vientDeLInterieur: boolean;
}

/** Deux passages de même nom à moins de cet écart forment une seule branche (boulevard). */
const ECART_FUSION_DEG = 30;

type Sens = 'avant' | 'arriere';
const OUI = new Set(['yes', 'true', '1']);

export function sensAutorises(tags: Record<string, string>): Record<Sens, boolean> {
  const implicite = tags.junction === 'roundabout' || tags.junction === 'circular' || tags.highway === 'motorway';
  const oneway = tags.oneway ?? (implicite ? 'yes' : 'no');
  if (OUI.has(oneway)) return { avant: true, arriere: false };
  if (oneway === '-1' || oneway === 'reverse') return { avant: false, arriere: true };
  return { avant: true, arriere: true };
}

function entier(valeur: string | undefined): number | undefined {
  const n = Number.parseInt(valeur ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** Voies circulant dans un sens de la voie OSM, avec leurs flèches si OSM les donne. */
export function voiesDansLeSens(tags: Record<string, string>, sens: Sens, unSeulSens: boolean) {
  const suffixe = sens === 'avant' ? 'forward' : 'backward';
  const turn = tags[`turn:lanes:${suffixe}`] ?? (unSeulSens ? tags['turn:lanes'] : undefined);
  if (turn) {
    // `none` (pas de marquage) : on suppose une voie de tout droit.
    const fleches = lireTurnLanes(turn).map((f): Direction[] => (f.length ? f : ['tout_droit']));
    return { fleches, nombre: fleches.length };
  }
  const total = entier(tags.lanes);
  const nombre =
    entier(tags[`lanes:${suffixe}`]) ?? (unSeulSens ? total : total && Math.max(1, Math.floor(total / 2))) ?? 1;
  return { fleches: null, nombre };
}

interface BrancheBrute {
  azimut: number;
  lon: number;
  lat: number;
  nom: string | null;
  osmWayId: number;
  entrant: boolean;
  sortant: boolean;
  voiesEntrantes: Direction[][];
  voiesSortantes: number;
  source: 'osm' | 'defaut';
}

export function brancheDepuisPassage(passage: Passage): BrancheBrute {
  const autorises = sensAutorises(passage.tags);
  const unSeulSens = autorises.avant !== autorises.arriere;
  // À ce passage, le sens « avant » de la voie OSM se dirige vers le carrefour, sauf si elle en vient.
  const sensEntrant: Sens = passage.vientDeLInterieur ? 'arriere' : 'avant';
  const sensSortant: Sens = sensEntrant === 'avant' ? 'arriere' : 'avant';
  const entree = autorises[sensEntrant] ? voiesDansLeSens(passage.tags, sensEntrant, unSeulSens) : null;
  const sortie = autorises[sensSortant] ? voiesDansLeSens(passage.tags, sensSortant, unSeulSens) : null;

  return {
    azimut: passage.azimut,
    lon: passage.lon,
    lat: passage.lat,
    nom: passage.tags.name ?? passage.tags.ref ?? null,
    osmWayId: passage.osmId,
    entrant: entree !== null,
    sortant: sortie !== null,
    voiesEntrantes: entree ? (entree.fleches ?? voiesParDefaut(entree.nombre)) : [],
    voiesSortantes: sortie?.nombre ?? 0,
    source: entree?.fleches ? 'osm' : 'defaut',
  };
}

const ecart = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

function moyenneAngles(angles: number[]): number {
  const x = angles.reduce((s, a) => s + Math.cos((a * Math.PI) / 180), 0);
  const y = angles.reduce((s, a) => s + Math.sin((a * Math.PI) / 180), 0);
  return (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360;
}

function fusionner(groupe: BrancheBrute[]): BrancheBrute {
  const entrantes = groupe.filter((b) => b.entrant).sort((a, b) => b.voiesEntrantes.length - a.voiesEntrantes.length);
  const reference = entrantes[0] ?? groupe[0]!;
  return {
    ...reference,
    azimut: moyenneAngles(groupe.map((b) => b.azimut)),
    lon: groupe.reduce((s, b) => s + b.lon, 0) / groupe.length,
    lat: groupe.reduce((s, b) => s + b.lat, 0) / groupe.length,
    entrant: entrantes.length > 0,
    sortant: groupe.some((b) => b.sortant),
    voiesSortantes: groupe.reduce((s, b) => s + b.voiesSortantes, 0),
  };
}

/** Branche proposée : de quoi générer ses voies et proposer ses connexions. */
export interface BrancheProposee {
  code: string;
  nom: string | null;
  azimut: number;
  osm_way_id: number;
  /** Axe du centre vers le point de passage. */
  geom: [number, number][];
  /** Flèches de chaque voie entrante, rang 0 = la plus à gauche. */
  fleches: Direction[][];
  sortantes: number;
}

export interface Proposition {
  branches: BrancheProposee[];
  sources: Record<string, 'osm' | 'defaut'>;
}

/** Transforme les passages en branches : fusion des chaussées d'un même boulevard, codes cardinaux. */
export function proposerBranches(passages: Passage[], centre: [number, number]): Proposition {
  const brutes = passages
    .map(brancheDepuisPassage)
    .filter((b) => b.entrant || b.sortant)
    .sort((a, b) => a.azimut - b.azimut);

  const groupes: BrancheBrute[][] = [];
  for (const brute of brutes) {
    const groupe = groupes.find((g) => g[0]!.nom === brute.nom && g.every((b) => ecart(b.azimut, brute.azimut) <= ECART_FUSION_DEG));
    if (groupe) groupe.push(brute);
    else groupes.push([brute]);
  }

  const fusionnees = groupes.map(fusionner).sort((a, b) => a.azimut - b.azimut);
  const codes = codesBranches(fusionnees.map((b) => b.azimut));
  const sources: Record<string, 'osm' | 'defaut'> = {};

  const branches = fusionnees.map((b, i): BrancheProposee => {
    const code = codes[i]!;
    if (b.entrant) sources[code] = b.source;
    return {
      code,
      nom: b.nom,
      azimut: Math.round(b.azimut * 10) / 10,
      osm_way_id: b.osmWayId,
      geom: [centre, [b.lon, b.lat]],
      fleches: b.voiesEntrantes,
      sortantes: b.voiesSortantes,
    };
  });
  return { branches, sources };
}

/**
 * Connexions proposées dans un giratoire : chaque voie entrante mène à toutes les branches
 * qui ont une sortie, demi-tour compris ; on sort par la voie de même rang, ou la plus à
 * droite s'il y en a moins. Les flèches d'OSM ne servent pas : elles manquent presque
 * toujours aux entrées de giratoire.
 */
export function connexionsGiratoire(branches: readonly BrancheProposee[]): Array<{ de: string; vers: string }> {
  return branches.flatMap((origine) =>
    origine.fleches.flatMap((_, rang) =>
      branches
        .filter((b) => b.sortantes > 0)
        .map((sortie) => ({ de: `${origine.code}:e${rang}`, vers: `${sortie.code}:s${Math.min(rang, sortie.sortantes - 1)}` })),
    ),
  );
}
