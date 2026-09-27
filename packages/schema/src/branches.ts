import { z } from 'zod';
import { Mouvement, type LigneFeux } from './feux.js';

export const SensBranche = z.enum(['entrant', 'sortant', 'double']);
export type SensBranche = z.infer<typeof SensBranche>;

export const SensVoie = z.enum(['entrante', 'sortante']);
export type SensVoie = z.infer<typeof SensVoie>;

export const TypeVoie = z.enum(['generale', 'bus', 'velo', 'tram']);
export type TypeVoie = z.infer<typeof TypeVoie>;

export const LonLat = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);
/** Segment orienté : [bout côté carrefour, bout éloigné]. */
export const SegmentGeo = z.tuple([LonLat, LonLat]);
export type SegmentGeo = z.infer<typeof SegmentGeo>;

export const CoordonneesLigne = z.array(LonLat).min(2).max(50);

/**
 * Voie d'une branche, dessinée sur la photo : rang 0 = la plus à gauche dans son sens de
 * circulation. Les connexions partent du bout côté carrefour des voies entrantes et arrivent
 * au bout côté carrefour des voies sortantes.
 */
export const Voie = z.object({
  sens: SensVoie,
  rang: z.number().int().min(0).max(9),
  type: TypeVoie.default('generale'),
  geom: SegmentGeo,
});
export type Voie = z.infer<typeof Voie>;

/**
 * Régime d'une entrée de giratoire hors feux (docs/CONFIGURATION.md §7) : cédez-le-passage à
 * l'anneau (règle par défaut), stop, ou priorité à droite (anneau non prioritaire). Une entrée
 * à feux garde ce régime quand les feux sont éteints ou au jaune clignotant.
 */
export const PrioriteEntree = z.enum(['cedez_le_passage', 'stop', 'priorite_a_droite']);
export type PrioriteEntree = z.infer<typeof PrioriteEntree>;

/** Code d'un nœud d'anneau : 1, 2, 3… */
export const CodeNoeud = z.string().regex(/^\d{1,2}$/, 'Nœud attendu sous la forme 1, 2…');

/**
 * Anneau d'un giratoire (docs/CONFIGURATION.md §7) : ses nœuds, posés sur la photo dans
 * l'ordre de circulation (antihoraire). Chaque nœud est un mini-carrefour ; les tronçons
 * d'anneau entre deux nœuds sont des branches générées (R1 part du nœud 1).
 */
export const Anneau = z
  .object({
    noeuds: z.array(z.object({ code: CodeNoeud, position: LonLat })).min(3, 'Trois nœuds au moins').max(16),
  })
  .refine(({ noeuds }) => new Set(noeuds.map((n) => n.code)).size === noeuds.length, { message: 'Codes de nœud en double' });
export type Anneau = z.infer<typeof Anneau>;

const CodeBranche = z.string().trim().regex(/^[A-Z0-9]{1,4}$/, 'Code en majuscules, 4 caractères au plus (N, NE, S2…)');

export const Branche = z
  .object({
    code: CodeBranche,
    nom: z.string().trim().max(200).nullable().default(null),
    /** Degrés, sens horaire depuis le nord, du centre du carrefour vers la branche. */
    azimut: z.number().min(0).max(360),
    osm_way_id: z.number().int().nullable().default(null),
    /** Axe de la branche, du centre du carrefour vers la rue, en [lon, lat]. */
    geom: CoordonneesLigne.nullable().default(null),
    voies: z.array(Voie).max(16),
    /** Passage piéton en travers de la branche, d'un trottoir à l'autre. */
    traversee: SegmentGeo.nullable().default(null),
    /** Giratoire : régime de l'entrée hors feux ; null = cédez-le-passage. */
    priorite_entree: PrioriteEntree.nullable().default(null),
    /** Giratoire : nœud où la rue se raccorde à l'anneau ; pour un tronçon, son nœud de départ. */
    noeud: CodeNoeud.nullable().default(null),
    /** Tronçon d'anneau généré (R1, R2…), et non une rue. */
    troncon: z.boolean().default(false),
  })
  .superRefine((branche, ctx) => {
    for (const sens of SensVoie.options) {
      const rangs = branche.voies.filter((v) => v.sens === sens).map((v) => v.rang).sort((a, b) => a - b);
      if (rangs.some((rang, i) => rang !== i)) {
        ctx.addIssue({ code: 'custom', path: ['voies'], message: `Rangs des voies ${sens}s non consécutifs depuis 0` });
      }
    }
  });
export type Branche = z.infer<typeof Branche>;

/** Clé de voie : branche, e (entrante) ou s (sortante), rang. Exemple : S:e0. */
export const CleVoie = z.string().regex(/^[A-Z0-9]{1,4}:[es]\d$/, 'Voie attendue sous la forme S:e0');

export const Connexion = z.object({ de: CleVoie, vers: CleVoie });
export type Connexion = z.infer<typeof Connexion>;

export const ConfigurationBranches = z
  .object({
    /** Rues (12 au plus) et, dans un giratoire, tronçons d'anneau (un par nœud, 16 au plus). */
    branches: z.array(Branche).max(28),
    connexions: z.array(Connexion).max(300).default([]),
    /** Anneau d'un giratoire ; null pour un carrefour ordinaire. */
    anneau: Anneau.nullable().default(null),
  })
  .superRefine(({ branches, connexions, anneau }, ctx) => {
    const codes = branches.map((b) => b.code);
    if (branches.filter((b) => !b.troncon).length > 12) {
      ctx.addIssue({ code: 'custom', path: ['branches'], message: '12 rues au plus' });
    }
    const noeuds = new Set(anneau?.noeuds.map((n) => n.code));
    branches.forEach((b, i) => {
      if (b.noeud && !noeuds.has(b.noeud)) {
        ctx.addIssue({ code: 'custom', path: ['branches', i, 'noeud'], message: `${b.code} : pas de nœud ${b.noeud} sur l'anneau` });
      }
      if (b.troncon && (!b.noeud || b.code !== `R${b.noeud}`)) {
        ctx.addIssue({ code: 'custom', path: ['branches', i], message: `Tronçon ${b.code} : code attendu R + nœud de départ` });
      }
    });
    for (const noeud of noeuds) {
      if (!branches.some((b) => b.troncon && b.noeud === noeud)) {
        ctx.addIssue({ code: 'custom', path: ['branches'], message: `Aucun tronçon d'anneau ne part du nœud ${noeud}` });
      }
    }
    if (new Set(codes).size !== codes.length) {
      ctx.addIssue({ code: 'custom', path: ['branches'], message: 'Codes de branche en double' });
    }
    const voies = new Set(
      branches.flatMap((b) => b.voies.map((v) => `${b.code}:${v.sens === 'entrante' ? 'e' : 's'}${v.rang}`)),
    );
    const vues = new Set<string>();
    connexions.forEach((c, i) => {
      if (!c.de.includes(':e') || !voies.has(c.de)) {
        ctx.addIssue({ code: 'custom', path: ['connexions', i, 'de'], message: `${c.de} n'est pas une voie entrante` });
      }
      if (!c.vers.includes(':s') || !voies.has(c.vers)) {
        ctx.addIssue({ code: 'custom', path: ['connexions', i, 'vers'], message: `${c.vers} n'est pas une voie sortante` });
      }
      const cle = `${c.de}>${c.vers}`;
      if (vues.has(cle)) ctx.addIssue({ code: 'custom', path: ['connexions', i], message: `Connexion ${cle} en double` });
      vues.add(cle);
    });
  });
export type ConfigurationBranches = z.infer<typeof ConfigurationBranches>;

export interface MouvementCarrefour {
  origine: string;
  destination: string;
  direction: Mouvement;
  /** Rangs des voies entrantes qui ont une connexion pour ce mouvement. */
  voies: number[];
}

export type BrancheLue = Branche & {
  /** Déduit des voies : entrant, sortant ou double. */
  sens: SensBranche;
};

export interface BranchesCarrefour {
  centre: [number, number];
  branches: BrancheLue[];
  connexions: Connexion[];
  /** Anneau d'un giratoire ; null pour un carrefour ordinaire. */
  anneau: Anneau | null;
  /** Mouvements déduits des connexions. */
  mouvements: MouvementCarrefour[];
  /** Flèches de chaque voie entrante (clé de voie → directions), déduites des connexions. */
  fleches: Record<string, Mouvement[]>;
  /** Voies entrantes sans connexion, etc. */
  alertes: string[];
}

/** Proposition de branches, voies et connexions détectée depuis OSM, non enregistrée. */
export interface DetectionBranches extends BranchesCarrefour {
  rayon_m: number;
  /** Par code de branche : d'où viennent les flèches qui ont servi à proposer les connexions. */
  sources: Record<string, SourceBranche>;
}

/** D'où vient une branche proposée : flèches OSM, règles par défaut, ou lecture de la photo par l'IA. */
export type SourceBranche = 'osm' | 'defaut' | 'ia';

export const ConfianceIa = z.enum(['haute', 'moyenne', 'basse']);
export type ConfianceIa = z.infer<typeof ConfianceIa>;

/** Proposition OSM corrigée par l'IA d'après l'orthophoto IGN, non enregistrée. */
export interface DetectionBranchesIa extends DetectionBranches {
  /** Lignes de feux proposées d'après ce que commande chaque feu vu sur la photo, non enregistrées. */
  lignes: LigneFeux[];
  ia: {
    /** Remarques générales de l'IA : ce qu'elle n'a pas pu voir, ce qu'elle a supposé. */
    remarques: string;
    /** Par code de branche : confiance et remarques. */
    branches: Record<string, { confiance: ConfianceIa; remarques: string }>;
    modele: string;
    duree_s: number;
    cout_usd: number | null;
  };
}
