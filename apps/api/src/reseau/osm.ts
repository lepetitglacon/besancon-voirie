/**
 * Réseau routier tiré des voies OSM — docs/RESEAU.md. Logique pure (sans base), testée à part :
 * chaque voie est découpée aux nœuds qu'elle partage avec une autre voie (intersections), ce
 * qui donne des tronçons entre nœuds OSM, avec leur nombre de voies par sens et leur vitesse.
 */
import type { LonLat } from '@voirie/engine';
import { sensAutorises, voiesDansLeSens } from '../branches/detection.js';

export interface VoieOsm {
  osm_id: number;
  tags: Record<string, string>;
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
  vitesse_kmh: number | null;
}

/** Voies par sens de tracé : `lanes:forward` / `lanes:backward`, `lanes`, `oneway`. */
export function voiesParSens(tags: Record<string, string>): { avant: number; arriere: number } {
  const sens = sensAutorises(tags);
  const unSeulSens = sens.avant !== sens.arriere;
  return {
    avant: sens.avant ? Math.min(voiesDansLeSens(tags, 'avant', unSeulSens).nombre, 9) : 0,
    arriere: sens.arriere ? Math.min(voiesDansLeSens(tags, 'arriere', unSeulSens).nombre, 9) : 0,
  };
}

/** `maxspeed` en km/h (nombre seul, ou « 30 mph ») ; null si absent ou symbolique (FR:urban…). */
export function vitesseOsm(tags: Record<string, string>): number | null {
  const valeur = tags.maxspeed?.trim();
  const nombre = valeur ? Number.parseFloat(valeur) : Number.NaN;
  if (!Number.isFinite(nombre) || nombre <= 0) return null;
  return Math.min(130, Math.max(5, Math.round(valeur!.endsWith('mph') ? nombre * 1.609 : nombre)));
}

/**
 * Découpe les voies aux intersections : un nœud OSM partagé par deux voies (ou deux fois par la
 * même, pour une boucle) coupe la voie ; les bouts de voie sont toujours des nœuds du réseau.
 */
export function decouperVoies(voies: readonly VoieOsm[]): { noeuds: Map<number, LonLat>; troncons: TronconOsm[] } {
  const usages = new Map<number, number>();
  for (const v of voies) for (const n of v.nodes) usages.set(n, (usages.get(n) ?? 0) + 1);

  const noeuds = new Map<number, LonLat>();
  const troncons: TronconOsm[] = [];
  for (const v of voies) {
    if (v.nodes.length !== v.coords.length || v.nodes.length < 2) continue;
    const { avant, arriere } = voiesParSens(v.tags);
    const commun = {
      osm_way_id: v.osm_id,
      nom: v.tags.name ?? v.tags.ref ?? null,
      highway: v.tags.highway ?? null,
      voies_avant: avant,
      voies_arriere: arriere,
      vitesse_kmh: vitesseOsm(v.tags),
    };
    let debut = 0;
    for (let i = 1; i < v.nodes.length; i++) {
      const dernier = i === v.nodes.length - 1;
      if (!dernier && (usages.get(v.nodes[i]!) ?? 0) < 2) continue;
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
