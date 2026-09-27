import { z } from 'zod';
import { LonLat } from './branches.js';

/**
 * Réseau routier hors carrefours — docs/RESEAU.md. Des tronçons relient des nœuds
 * (intersections OSM, points posés à la main, carrefours configurés) ; à un carrefour, chaque
 * bout de tronçon est raccordé à une branche, voie par voie (« lane connector » de TM:PE).
 */

type Position = z.infer<typeof LonLat>;

export const SourceReseau = z.enum(['osm', 'manuel']);
export type SourceReseau = z.infer<typeof SourceReseau>;

/** Bout d'un tronçon : `de` (premier point) ou `vers` (dernier point). */
export const Extremite = z.enum(['de', 'vers']);
export type Extremite = z.infer<typeof Extremite>;

/** Nombre de voies dans un sens : 0 pour un sens interdit. */
const NombreVoies = z.number().int().min(0).max(9);

export const VitesseKmh = z.number().int().min(5).max(130);

/** Propriétés d'un tronçon sur la carte. `avant` : de `noeud_de` vers `noeud_vers`. */
export interface TronconResume {
  id: string;
  nom: string | null;
  highway: string | null;
  voies_avant: number;
  voies_arriere: number;
  vitesse_kmh: number | null;
  source: SourceReseau;
  /** Tronçon OSM corrigé à la main : la régénération depuis OSM le garde tel quel. */
  modifie: boolean;
  noeud_de: string;
  noeud_vers: string;
  /** Carrefour configuré à ce bout, et branche à laquelle le bout est raccordé. */
  carrefour_de: string | null;
  carrefour_vers: string | null;
  branche_de: string | null;
  branche_vers: string | null;
}

export interface NoeudResume {
  id: string;
  carrefour_id: string | null;
  osm_node_id: number | null;
  /** Nombre de tronçons qui y arrivent : 1 = cul-de-sac ou bout du réseau. */
  degre: number;
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

/** PATCH /api/reseau/troncons/:id : champs modifiés ; `inverser` retourne le tronçon (avant ↔ arrière). */
export const ModificationTroncon = ProprietesTroncon.partial()
  .extend({ inverser: z.boolean().optional() })
  .refine(auMoinsUneVoie, MESSAGE_VOIES);
export type ModificationTroncon = z.infer<typeof ModificationTroncon>;

/**
 * Liens voie à voie entre le bout d'un tronçon et sa branche (rangs : 0 = la plus à gauche dans
 * le sens de circulation). `entree` : [voie du tronçon qui arrive, voie entrante de la branche] ;
 * `sortie` : [voie sortante de la branche, voie du tronçon qui repart].
 */
export const LiensRaccordement = z.object({
  entree: z.array(z.tuple([NombreVoies, NombreVoies])).max(100),
  sortie: z.array(z.tuple([NombreVoies, NombreVoies])).max(100),
});
export type LiensRaccordement = z.infer<typeof LiensRaccordement>;

/** Bout de tronçon raccordé (ou à raccorder) à une branche d'un carrefour configuré. */
export interface Raccordement {
  troncon_id: string;
  extremite: Extremite;
  nom: string | null;
  /** Branche choisie (à la main ou par l'azimut) ; null : aucune branche dans cette direction. */
  branche: string | null;
  /** Azimut (°) du centre du carrefour vers le bout du tronçon. */
  azimut: number;
  /** Bout du tronçon, sur le cercle du carrefour, puis quelques points vers l'extérieur. */
  points: Position[];
  /** Voies du tronçon qui arrivent au carrefour, et qui en repartent. */
  voies_vers_carrefour: number;
  voies_depuis_carrefour: number;
  /** Liens retenus : ceux saisis, ou à défaut ceux proposés (`liens_auto`). */
  liens: LiensRaccordement;
  liens_auto: boolean;
}

export interface RaccordementsCarrefour {
  /** Rayon (m) du cercle où les tronçons s'arrêtent : le bout de la plus longue voie, plus une marge. */
  rayon_m: number;
  raccordements: Raccordement[];
  alertes: string[];
}

/** PUT /api/carrefours/:id/raccordements : branche et liens de chaque bout (liens null : automatiques). */
export const SaisieRaccordements = z.object({
  raccordements: z
    .array(
      z.object({
        troncon_id: z.uuid(),
        extremite: Extremite,
        branche: z.string().regex(/^[A-Z0-9]{1,4}$/).nullable(),
        liens: LiensRaccordement.nullable(),
      }),
    )
    .max(60),
});
export type SaisieRaccordements = z.infer<typeof SaisieRaccordements>;

/** Fichiers de l'export SUMO « plain XML », à passer à netconvert. */
export const FichierSumo = z.enum(['reseau.nod.xml', 'reseau.edg.xml', 'reseau.con.xml', 'reseau.netccfg']);
export type FichierSumo = z.infer<typeof FichierSumo>;
