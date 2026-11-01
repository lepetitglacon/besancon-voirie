import { createMongoAbility, type MongoAbility, type RawRuleOf } from '@casl/ability';
import { z } from 'zod';

/**
 * Droits RBAC, partagés par l'API (guard des routes d'écriture) et le front (outils affichés).
 * Un rôle par métier, c'est-à-dire par type de saisie : on cumule les rôles selon les besoins
 * de chacun. Changer un rôle, ou le rendre automatique, se fait ici seulement.
 */

export const Action = z.enum(['manage', 'create', 'update', 'delete']);
export type Action = z.infer<typeof Action>;

export const Sujet = z.enum([
  'Carrefour',
  'Feu',
  'Branche',
  'AnalyseIa',
  'LigneFeux',
  'Programme',
  'TopSynchro',
  'ZoneOsm',
  'ImportOsm',
  'LancementSumo',
  'Utilisateur',
  'all',
]);
export type Sujet = z.infer<typeof Sujet>;

export type Droits = MongoAbility<[Action, Sujet]>;
export type RegleDroit = RawRuleOf<Droits>;

export const Role = z.enum([
  'compositeur',
  'geometre',
  'analyste_ia',
  'signaliste',
  'programmeur',
  'releveur',
  'importeur_osm',
  'simulateur',
  'admin',
]);
export type Role = z.infer<typeof Role>;

export interface DefinitionRole {
  libelle: string;
  description: string;
  /** Accordé seulement après validation par un admin, sur motivation. */
  validation: boolean;
  /** Proposé à l'inscription et dans les paramètres du compte. */
  demandable: boolean;
  regles: RegleDroit[];
}

export const ROLES: Record<Role, DefinitionRole> = {
  compositeur: {
    libelle: 'Composer les carrefours',
    description: 'Regrouper les feux en carrefours, les renommer, les supprimer, repositionner un feu.',
    validation: true,
    demandable: true,
    regles: [
      { action: ['create', 'update', 'delete'], subject: 'Carrefour' },
      { action: 'update', subject: 'Feu' },
    ],
  },
  geometre: {
    libelle: 'Placer branches et voies',
    description: 'Dessiner les branches d’un carrefour, leurs voies et passages piétons.',
    validation: true,
    demandable: true,
    regles: [{ action: 'update', subject: 'Branche' }],
  },
  analyste_ia: {
    libelle: 'Lancer les analyses IA',
    description: 'Proposer les branches d’un carrefour par analyse IA de l’orthophoto.',
    validation: true,
    demandable: true,
    regles: [{ action: ['create', 'update', 'delete'], subject: 'AnalyseIa' }],
  },
  signaliste: {
    libelle: 'Lignes de feux et conflits',
    description: 'Associer les feux en lignes de feux et décrire leurs conflits.',
    validation: true,
    demandable: true,
    regles: [{ action: 'update', subject: 'LigneFeux' }],
  },
  programmeur: {
    libelle: 'Plans de feux',
    description: 'Saisir les étapes, cycles et plans de feux d’un carrefour.',
    validation: true,
    demandable: true,
    regles: [{ action: 'update', subject: 'Programme' }],
  },
  releveur: {
    libelle: 'Relever les tops de synchro',
    description: 'Ajouter ou retirer des tops observés sur le terrain.',
    validation: false,
    demandable: true,
    regles: [{ action: ['create', 'delete'], subject: 'TopSynchro' }],
  },
  importeur_osm: {
    libelle: 'Zones et import OSM',
    description: 'Tracer la zone d’import et réimporter les feux depuis OpenStreetMap.',
    validation: true,
    demandable: true,
    regles: [
      { action: ['update', 'delete'], subject: 'ZoneOsm' },
      { action: 'create', subject: 'ImportOsm' },
    ],
  },
  simulateur: {
    libelle: 'Lancer des simulations SUMO',
    description: 'Lancer et arrêter des simulations de trafic sur le serveur.',
    validation: true,
    demandable: true,
    regles: [{ action: ['create', 'delete'], subject: 'LancementSumo' }],
  },
  admin: {
    libelle: 'Administrer',
    description: 'Tous les droits, dont la gestion des comptes et des rôles.',
    validation: true,
    demandable: false,
    regles: [{ action: 'manage', subject: 'all' }],
  },
};

/** Rôles proposés à l'inscription, dans l'ordre d'affichage. */
export const ROLES_DEMANDABLES = Role.options.filter((role) => ROLES[role].demandable);

/** Règles cumulées des rôles accordés. */
export function reglesPour(roles: readonly Role[]): RegleDroit[] {
  return roles.flatMap((role) => ROLES[role].regles);
}

export function creerDroits(regles: RegleDroit[]): Droits {
  return createMongoAbility<Droits>(regles);
}

/**
 * Sujets des outils d'édition : avoir l'un d'eux ouvre le mode Édition. Les tops de synchro s'y
 * relèvent aussi (onglet Programme de la configuration d'un carrefour).
 */
export const SUJETS_EDITION: readonly Sujet[] = [
  'Carrefour',
  'Feu',
  'Branche',
  'AnalyseIa',
  'LigneFeux',
  'Programme',
  'TopSynchro',
  'ZoneOsm',
  'ImportOsm',
];

/** Au moins un outil du mode Édition est permis. */
export function peutEditer(droits: Droits): boolean {
  return SUJETS_EDITION.some((sujet) => (['create', 'update', 'delete'] as const).some((action) => droits.can(action, sujet)));
}
