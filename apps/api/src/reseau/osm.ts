/**
 * Réseau routier tiré d'OSM — docs/RESEAU.md. Logique pure (sans base), testée à part : chaque
 * voie est découpée aux nœuds qu'elle partage avec une autre voie (intersections) et à ses feux
 * et passages piétons, ce qui donne des tronçons entre nœuds OSM, avec leurs voies par sens
 * (voies vélo comprises), leur type et leur vitesse.
 */
import type { LonLat } from '@voirie/engine';
import type { TraverseePieton, TypeVoie } from '@voirie/schema';
import { sensAutorises, voiesDansLeSens } from '../branches/detection.js';

type Tags = Record<string, string>;

export interface VoieOsm {
  osm_id: number;
  tags: Tags;
  nodes: number[];
  coords: LonLat[];
}

export interface TronconOsm {
  osm_way_id: number;
  /** Nœuds OSM des deux bouts, dans le sens de tracé de la voie. */
  de: number;
  vers: number;
  points: LonLat[];
  nom: string | null;
  highway: string | null;
  voies_avant: number;
  voies_arriere: number;
  /** Type de chaque voie, rang 0 = la plus à gauche ; null : toutes générales. */
  types_avant: TypeVoie[] | null;
  types_arriere: TypeVoie[] | null;
  vitesse_kmh: number | null;
  tags: Tags;
}

/** Piste cyclable : `highway=cycleway`, ou chemin réservé aux vélos (`path` + `bicycle=designated`). */
export const estCyclable = (tags: Tags) => tags.highway === 'cycleway' || (tags.highway === 'path' && tags.bicycle === 'designated');

const OUI = new Set(['yes', 'true', '1']);
/** Valeurs de `cycleway*` qui donnent une voie vélo le long de la chaussée. */
const VOIE_VELO = new Set(['lane', 'track']);
/** Au plus 9 voies par sens (la clé d'une voie n'a qu'un chiffre). */
const MAX_VOIES = 9;

export interface VoiesParSens {
  avant: number;
  arriere: number;
  types_avant: TypeVoie[] | null;
  types_arriere: TypeVoie[] | null;
}

/** Voies d'une piste cyclable : une par sens autorisé aux vélos. */
function voiesCyclables(tags: Tags): VoiesParSens {
  const oneway = tags['oneway:bicycle'] ?? tags.oneway ?? 'no';
  const avant = oneway === '-1' ? 0 : 1;
  const arriere = OUI.has(oneway) ? 0 : 1;
  return { avant, arriere, types_avant: avant ? ['velo'] : null, types_arriere: arriere ? ['velo'] : null };
}

/**
 * Voies par sens de tracé : `lanes:forward` / `lanes:backward`, `lanes`, `oneway`, puis les
 * voies vélo le long de la chaussée (`cycleway`, `cycleway:right|left|both` = `lane` ou `track`,
 * `opposite_lane` à contresens). Circulation à droite : une voie vélo est la dernière voie (la
 * plus à droite) du sens qui roule de son côté ; à gauche d'un sens unique, c'est la première,
 * sauf à contresens (`cycleway:left:oneway=-1`). `highway=busway` : voies de bus.
 */
export function voiesParSens(tags: Tags): VoiesParSens {
  if (estCyclable(tags)) return voiesCyclables(tags);
  const sens = sensAutorises(tags);
  const unSeulSens = sens.avant !== sens.arriere;
  const general: TypeVoie = tags.highway === 'busway' ? 'bus' : 'generale';
  const avant: TypeVoie[] = Array<TypeVoie>(sens.avant ? voiesDansLeSens(tags, 'avant', unSeulSens).nombre : 0).fill(general);
  const arriere: TypeVoie[] = Array<TypeVoie>(sens.arriere ? voiesDansLeSens(tags, 'arriere', unSeulSens).nombre : 0).fill(general);
  const velo = (valeur: string | undefined) => valeur !== undefined && VOIE_VELO.has(valeur);

  if (!unSeulSens) {
    // Double sens : à droite du tracé pour le sens avant, à gauche pour l'autre.
    if (velo(tags['cycleway:right'] ?? tags['cycleway:both'] ?? tags.cycleway)) avant.push('velo');
    if (velo(tags['cycleway:left'] ?? tags['cycleway:both'] ?? tags.cycleway)) arriere.push('velo');
  } else {
    // Sens unique : `droite` et `gauche` vues par le conducteur, qui roule avec ou contre le tracé.
    const [circule, contresens] = sens.avant ? [avant, arriere] : [arriere, avant];
    const [cleDroite, cleGauche] = sens.avant ? ['cycleway:right', 'cycleway:left'] : ['cycleway:left', 'cycleway:right'];
    if (velo(tags[cleDroite] ?? tags['cycleway:both'] ?? tags.cycleway)) circule.push('velo');
    if (velo(tags[cleGauche])) {
      if (tags[`${cleGauche}:oneway`] === '-1') contresens.push('velo');
      else circule.unshift('velo');
    }
    if ([tags.cycleway, tags[cleGauche]].includes('opposite_lane')) contresens.push('velo');
  }

  const [a, r] = [avant.slice(0, MAX_VOIES), arriere.slice(0, MAX_VOIES)];
  const types = (liste: TypeVoie[]) => (liste.every((t) => t === 'generale') ? null : liste);
  return { avant: a.length, arriere: r.length, types_avant: types(a), types_arriere: types(r) };
}

/** `maxspeed` en km/h (nombre seul, ou « 30 mph ») ; null si absent ou symbolique (FR:urban…). */
export function vitesseOsm(tags: Tags): number | null {
  const valeur = tags.maxspeed?.trim();
  const nombre = valeur ? Number.parseFloat(valeur) : Number.NaN;
  if (!Number.isFinite(nombre) || nombre <= 0) return null;
  return Math.min(130, Math.max(5, Math.round(valeur!.endsWith('mph') ? nombre * 1.609 : nombre)));
}

/** Passage piéton d'un nœud OSM : à feux, non marqué, sinon marqué. */
export function traverseePieton(tags: Tags): TraverseePieton {
  if (tags.crossing === 'traffic_signals' || tags['crossing:signals'] === 'yes') return 'feux';
  if (tags.crossing === 'unmarked' || tags['crossing:markings'] === 'no') return 'non_marquee';
  return 'marquee';
}

/**
 * Découpe les voies aux intersections (nœud OSM partagé par deux voies, ou deux fois par la
 * même, pour une boucle) et aux nœuds de `coupes` (feux, passages piétons). Les bouts de voie
 * sont toujours des nœuds du réseau.
 */
export function decouperVoies(
  voies: readonly VoieOsm[],
  coupes: ReadonlySet<number> = new Set(),
): { noeuds: Map<number, LonLat>; troncons: TronconOsm[] } {
  const usages = new Map<number, number>();
  for (const v of voies) for (const n of v.nodes) usages.set(n, (usages.get(n) ?? 0) + 1);

  const noeuds = new Map<number, LonLat>();
  const troncons: TronconOsm[] = [];
  for (const v of voies) {
    if (v.nodes.length !== v.coords.length || v.nodes.length < 2) continue;
    const { avant, arriere, types_avant, types_arriere } = voiesParSens(v.tags);
    if (avant + arriere === 0) continue;
    const commun = {
      osm_way_id: v.osm_id,
      nom: v.tags.name ?? v.tags.ref ?? null,
      highway: v.tags.highway ?? null,
      voies_avant: avant,
      voies_arriere: arriere,
      types_avant,
      types_arriere,
      vitesse_kmh: vitesseOsm(v.tags),
      tags: v.tags,
    };
    let debut = 0;
    for (let i = 1; i < v.nodes.length; i++) {
      const dernier = i === v.nodes.length - 1;
      if (!dernier && (usages.get(v.nodes[i]!) ?? 0) < 2 && !coupes.has(v.nodes[i]!)) continue;
      // Un tronçon qui revient sur son nœud de départ (boucle) est coupé en deux à mi-parcours.
      const coupures = v.nodes[debut] === v.nodes[i] ? [debut, Math.floor((debut + i) / 2), i] : [debut, i];
      for (let k = 0; k < coupures.length - 1; k++) {
        const [a, b] = [coupures[k]!, coupures[k + 1]!];
        if (a === b) continue;
        noeuds.set(v.nodes[a]!, v.coords[a]!);
        noeuds.set(v.nodes[b]!, v.coords[b]!);
        troncons.push({ ...commun, de: v.nodes[a]!, vers: v.nodes[b]!, points: v.coords.slice(a, b + 1) });
      }
      debut = i;
    }
  }
  return { noeuds, troncons };
}
