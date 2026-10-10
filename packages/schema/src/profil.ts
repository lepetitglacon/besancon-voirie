import { z } from 'zod';

/**
 * Profil en travers théorique d'un tronçon, dessiné dans l'éditeur Streetmix —
 * docs/integration-streetmix.md. On garde la rue Streetmix entière (`data.street`), pour que
 * l'éditeur la redonne à l'identique ; seuls les champs exploités sont validés.
 */

/** Version du schéma des rues Streetmix comprise par l'appli et par le fork de l'éditeur. */
export const VERSION_SCHEMA_STREETMIX = 35;

/** Segment d'une rue Streetmix (une « tranche » du profil, de gauche à droite). */
export const SegmentStreetmix = z.looseObject({
  id: z.string().min(1).max(64),
  type: z.string().regex(/^[a-z0-9-]+$/).max(64),
  /** Variantes séparées par `|`, dans l'ordre défini par le type (`outbound|car`…). */
  variantString: z.string().max(200),
  /** Largeur en mètres. */
  width: z.number().min(0.05).max(60),
  /** Hauteur au-dessus de la chaussée, en mètres (trottoir : 0,15). */
  elevation: z.number().min(-10).max(10).default(0),
  label: z.string().max(200).optional(),
});
export type SegmentStreetmix = z.infer<typeof SegmentStreetmix>;

/** Bord de la rue (bâtiments, clôture, herbe…). */
const BordStreetmix = z.looseObject({
  id: z.string().max(64).optional(),
  variant: z.string().max(64),
  floors: z.number().int().min(0).max(30),
  elevation: z.number().min(-10).max(10).default(0),
});

/** Rue Streetmix (`data.street`), vue de gauche à droite par un observateur posé à un bout. */
export const RueStreetmix = z.looseObject({
  schemaVersion: z.literal(VERSION_SCHEMA_STREETMIX),
  /** Largeur de façade à façade (m) : la somme des segments peut être plus petite. */
  width: z.number().min(0.5).max(400),
  segments: z.array(SegmentStreetmix).max(80),
  boundary: z.looseObject({ left: BordStreetmix, right: BordStreetmix }).optional(),
});
export type RueStreetmix = z.infer<typeof RueStreetmix>;

/** Tronçon qui suit un profil ; `inverse` : il se lit depuis `noeud_vers`, pas depuis `noeud_de`. */
export const RattachementProfil = z.object({ id: z.uuid(), inverse: z.boolean() });
export type RattachementProfil = z.infer<typeof RattachementProfil>;

/**
 * POST /api/profils (multipart) : champ `profil` (ce JSON) et champ `image` (PNG). La rue est
 * vue depuis le premier tronçon de `troncons`, qui devient la référence (`inverse` faux).
 */
export const NouveauProfil = z.object({
  nom: z.string().trim().max(200).nullable(),
  rue: RueStreetmix,
  troncons: z.array(RattachementProfil).min(1).max(200),
});
export type NouveauProfil = z.infer<typeof NouveauProfil>;

/**
 * PUT /api/profils/:id (multipart) : remplace la rue (vue dans le sens de référence) et
 * l'image ; `troncons` rattache en plus ces tronçons au profil.
 */
export const ModificationProfil = z.object({
  nom: z.string().trim().max(200).nullable().optional(),
  rue: RueStreetmix,
  troncons: z.array(RattachementProfil).max(200).default([]),
});
export type ModificationProfil = z.infer<typeof ModificationProfil>;

export interface Profil {
  id: string;
  nom: string | null;
  /** Rue vue dans le sens de référence (`inverse` faux). */
  rue: RueStreetmix;
  largeur_m: number;
  /** URL du PNG (avec sa version, pour le cache) ; null : pas d'image. */
  image: string | null;
  /** Nombre de tronçons qui suivent ce profil. */
  troncons: number;
  cree_le: string;
  modifie_le: string;
}

/** Mode de déplacement auquel une part du profil est consacrée. */
export const ModeProfil = z.enum(['pieton', 'velo', 'voiture', 'bus', 'tram', 'stationnement', 'vegetal', 'autre']);
export type ModeProfil = z.infer<typeof ModeProfil>;

/** Largeur (m) consacrée à chaque mode. */
export type RepartitionProfil = Record<ModeProfil, number>;

/** GET /api/profils/troncon/:id : profil théorique d'un tronçon, et profil estimé d'après ses voies. */
export interface ProfilTroncon {
  troncon: string;
  /** Profil théorique suivi ; null : aucun. */
  profil: Profil | null;
  /** Vrai si le tronçon lit le profil depuis `noeud_vers`. */
  inverse: boolean;
  /** Profil estimé d'après les voies, les emprises et les tags OSM du tronçon, vu dans son sens. */
  estime: RueStreetmix;
  /** Tronçons voisins de la même rue, dans la continuité, orientés par rapport à celui-ci. */
  voisins: RattachementProfil[];
  /** Répartition de l'emprise par mode : théorique (null sans profil) et estimée. */
  repartition: { theorique: RepartitionProfil | null; estime: RepartitionProfil };
}
