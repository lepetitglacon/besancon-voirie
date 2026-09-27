import { z } from 'zod';
import { LonLat, TypeVoie } from './branches.js';

/**
 * Réseau routier — docs/RESEAU.md. Des tronçons relient des nœuds (intersections OSM, feux,
 * passages piétons, points posés à la main) ; à chaque nœud, les voies se relient voie à voie
 * (« lane connector » de TM:PE). Un carrefour est un groupe de nœuds.
 */

type Position = z.infer<typeof LonLat>;

export const SourceReseau = z.enum(['osm', 'manuel']);
export type SourceReseau = z.infer<typeof SourceReseau>;

/** Bout d'un tronçon : `de` (premier point) ou `vers` (dernier point). */
export const Extremite = z.enum(['de', 'vers']);
export type Extremite = z.infer<typeof Extremite>;

/** Nombre de voies dans un sens : 0 pour un sens interdit. */
const NombreVoies = z.number().int().min(0).max(9);

/**
 * Types des voies d'un sens, rang 0 = la plus à gauche ; null : toutes générales. Une liste plus
 * courte que le nombre de voies est complétée par des voies générales.
 */
export const TypesVoies = z.array(TypeVoie).max(9).nullable();
export type TypesVoies = z.infer<typeof TypesVoies>;

/** Passage piéton sur un nœud : à feux, marqué (zébras), ou non marqué. */
export const TraverseePieton = z.enum(['feux', 'marquee', 'non_marquee']);
export type TraverseePieton = z.infer<typeof TraverseePieton>;

export const VitesseKmh = z.number().int().min(5).max(130);

/** Propriétés d'un tronçon sur la carte. `avant` : de `noeud_de` vers `noeud_vers`. */
export interface TronconResume {
  id: string;
  nom: string | null;
  /** Type de voie OSM (`primary`, `residential`, `cycleway`…). */
  highway: string | null;
  voies_avant: number;
  voies_arriere: number;
  types_avant: TypesVoies;
  types_arriere: TypesVoies;
  vitesse_kmh: number | null;
  source: SourceReseau;
  /** Tronçon OSM corrigé à la main : la régénération depuis OSM le garde tel quel. */
  modifie: boolean;
  noeud_de: string;
  noeud_vers: string;
  /** Carrefour du nœud à chaque bout. */
  carrefour_de: string | null;
  carrefour_vers: string | null;
  /** Code de la branche que forme ce bout, s'il entre dans un carrefour (N, S…). */
  branche_de: string | null;
  branche_vers: string | null;
}

/** Liaison, à un nœud, d'une voie qui y arrive vers une voie qui en repart (rangs dans chaque sens). */
export const Liaison = z.object({
  de: z.uuid(),
  voie_de: NombreVoies,
  vers: z.uuid(),
  voie_vers: NombreVoies,
});
export type Liaison = z.infer<typeof Liaison>;

/** PUT /api/reseau/noeuds/:id/liaisons : liaisons du nœud ; null revient à celles proposées par défaut. */
export const SaisieLiaisons = z.object({ liaisons: z.array(Liaison).max(400).nullable() });
export type SaisieLiaisons = z.infer<typeof SaisieLiaisons>;

export interface NoeudResume {
  id: string;
  carrefour_id: string | null;
  osm_node_id: number | null;
  /** Ligne d'arrêt à feux des véhicules (feu OSM `traffic_signals` posé sur la voie, ou saisi). */
  feux: boolean;
  /** Passage piéton sur ce nœud ; null : aucun. */
  pieton: TraverseePieton | null;
  /** Nombre de tronçons qui y arrivent : 1 = cul-de-sac ou bout du réseau. */
  degre: number;
  /** Liaisons saisies ; null : celles proposées par défaut. */
  liaisons: Liaison[] | null;
}

export interface ReseauGeoJson {
  troncons: {
    type: 'FeatureCollection';
    features: Array<{ type: 'Feature'; id: string; geometry: { type: 'LineString'; coordinates: Position[] }; properties: TronconResume }>;
  };
  noeuds: {
    type: 'FeatureCollection';
    features: Array<{ type: 'Feature'; id: string; geometry: { type: 'Point'; coordinates: Position }; properties: NoeudResume }>;
  };
  /** Vrai si l'emprise contenait plus de tronçons que la limite : la carte n'en montre qu'une partie. */
  tronque: boolean;
}

/** Où accrocher un bout de tronçon tracé à la main. */
export const Accroche = z.discriminatedUnion('type', [
  /** Sur un nœud existant. */
  z.object({ type: z.literal('noeud'), id: z.uuid() }),
  /** Sur un tronçon existant, coupé en deux au point le plus proche. */
  z.object({ type: z.literal('troncon'), id: z.uuid() }),
  /** Nouveau nœud au point tracé (cul-de-sac, ou bout à relier plus tard). */
  z.object({ type: z.literal('libre') }),
]);
export type Accroche = z.infer<typeof Accroche>;

const ProprietesTroncon = z.object({
  nom: z.string().trim().max(200).nullable(),
  voies_avant: NombreVoies,
  voies_arriere: NombreVoies,
  vitesse_kmh: VitesseKmh.nullable(),
});

const auMoinsUneVoie = (t: { voies_avant?: number; voies_arriere?: number }) =>
  t.voies_avant === undefined || t.voies_arriere === undefined || t.voies_avant + t.voies_arriere > 0;
const MESSAGE_VOIES = { message: 'Au moins une voie dans un sens', path: ['voies_avant'] };

/** POST /api/reseau/troncons : tronçon tracé à la main, du premier au dernier point. */
export const NouveauTroncon = ProprietesTroncon.extend({
  points: z.array(LonLat).min(2).max(200),
  de: Accroche,
  vers: Accroche,
}).refine(auMoinsUneVoie, MESSAGE_VOIES);
export type NouveauTroncon = z.infer<typeof NouveauTroncon>;

/**
 * PATCH /api/reseau/troncons/:id : champs modifiés ; `inverser` retourne le tronçon (avant ↔
 * arrière) ; `points` redessine son tracé (ses bouts restent sur leurs nœuds).
 */
export const ModificationTroncon = ProprietesTroncon.partial()
  .extend({
    types_avant: TypesVoies.optional(),
    types_arriere: TypesVoies.optional(),
    points: z.array(LonLat).min(2).max(200).optional(),
    inverser: z.boolean().optional(),
  })
  .refine(auMoinsUneVoie, MESSAGE_VOIES);
export type ModificationTroncon = z.infer<typeof ModificationTroncon>;

/**
 * PATCH /api/reseau/noeuds/:id : déplacer le nœud (les tronçons le suivent), dire s'il porte une
 * ligne d'arrêt à feux ou un passage piéton, le mettre dans un carrefour ou l'en retirer (null).
 */
export const ModificationNoeud = z.object({
  position: LonLat.optional(),
  feux: z.boolean().optional(),
  pieton: TraverseePieton.nullable().optional(),
  carrefour_id: z.uuid().nullable().optional(),
});
export type ModificationNoeud = z.infer<typeof ModificationNoeud>;

/** POST /api/reseau/troncons/:id/couper : coupe le tronçon au point le plus proche (nouveau nœud). */
export const CoupeTroncon = z.object({ position: LonLat });
export type CoupeTroncon = z.infer<typeof CoupeTroncon>;

/** POST /api/reseau/semer : semis du réseau depuis OSM, une seule fois ; `reinitialiser` efface tout avant. */
export const SemisReseau = z.object({ reinitialiser: z.boolean().default(false) });
export type SemisReseau = z.infer<typeof SemisReseau>;

export interface BilanSemis {
  voies_osm: number;
  noeuds: number;
  troncons: number;
  /** Nœuds qui portent un feu, un passage piéton. */
  feux: number;
  pieton: number;
  /** Tronçons de piste cyclable. */
  cyclables: number;
  /** Carrefours dont les nœuds ont été retrouvés après une réinitialisation. */
  carrefours: number;
}

/** Fichiers de l'export SUMO « plain XML », à passer à netconvert. */
export const FichierSumo = z.enum(['reseau.nod.xml', 'reseau.edg.xml', 'reseau.con.xml', 'reseau.netccfg']);
export type FichierSumo = z.infer<typeof FichierSumo>;
