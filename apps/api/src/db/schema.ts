import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  date,
  geometry,
  index,
  jsonb,
  pgEnum,
  pgTable,
  pgView,
  primaryKey,
  real,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type { Controleur, IntervalleVert, Plage } from '@voirie/schema';

// Tables du projet — voir docs/ARCHITECTURE.md §4.
// Les tables issues d'OpenStreetMap (osm_*) sont gérées par l'import, pas par Drizzle.

const creeLe = () => timestamp('cree_le', { withTimezone: true }).notNull().defaultNow();

export const statutCarrefour = pgEnum('statut_carrefour', [
  'a_confirmer',
  'non_releve',
  'estime',
  'mesure',
  'verifie',
]);

export const statutModeration = pgEnum('statut_moderation', ['en_attente', 'valide', 'rejete']);

export const carrefour = pgTable(
  'carrefour',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull().unique(),
    nom: text('nom').notNull(),
    geom: geometry('geom', { type: 'point', mode: 'xy', srid: 4326 }).notNull(),
    statut: statutCarrefour('statut').notNull().default('non_releve'),
    controleur: jsonb('controleur').$type<Partial<Controleur>>().notNull().default({}),
    osmNodes: bigint('osm_nodes', { mode: 'number' })
      .array()
      .notNull()
      .default(sql`'{}'`),
    presTram: boolean('pres_tram').notNull().default(false),
    creeLe: creeLe(),
    modifieLe: timestamp('modifie_le', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index('carrefour_geom_idx').using('gist', t.geom)],
);

export const branche = pgTable(
  'branche',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    carrefourId: uuid('carrefour_id')
      .notNull()
      .references(() => carrefour.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    nom: text('nom'),
    osmWayId: bigint('osm_way_id', { mode: 'number' }),
    azimutDeg: real('azimut_deg'),
  },
  (t) => [unique().on(t.carrefourId, t.code)],
);

export const ligneFeux = pgTable(
  'ligne_feux',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    carrefourId: uuid('carrefour_id')
      .notNull()
      .references(() => carrefour.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    signal: text('signal').notNull(),
    brancheCode: text('branche_code'),
    mouvements: text('mouvements')
      .array()
      .notNull()
      .default(sql`'{}'`),
    voies: smallint('voies'),
    traverse: text('traverse'),
    geom: geometry('geom', { type: 'point', mode: 'xy', srid: 4326 }),
  },
  (t) => [unique().on(t.carrefourId, t.code)],
);

export const releve = pgTable(
  'releve',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    carrefourId: uuid('carrefour_id')
      .notNull()
      .references(() => carrefour.id, { onDelete: 'cascade' }),
    pseudo: text('pseudo'),
    brut: jsonb('brut').notNull(),
    synthese: jsonb('synthese').notNull(),
    cyclesObserves: smallint('cycles_observes').notNull(),
    ecartTypeCycleS: real('ecart_type_cycle_s'),
    observeLe: timestamp('observe_le', { withTimezone: true }).notNull(),
    statut: statutModeration('statut').notNull().default('en_attente'),
    motifRejet: text('motif_rejet'),
    creeLe: creeLe(),
  },
  (t) => [index('releve_statut_idx').on(t.statut, t.creeLe)],
);

export const planFeux = pgTable(
  'plan_feux',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    carrefourId: uuid('carrefour_id')
      .notNull()
      .references(() => carrefour.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    mode: text('mode').notNull().default('cycle'),
    plages: jsonb('plages').$type<Plage[]>().notNull(),
    cycleS: real('cycle_s'),
    jauneS: real('jaune_s'),
    reference: jsonb('reference').$type<{ ligne: string; t0: string }>(),
    lignes: jsonb('lignes').$type<Record<string, IntervalleVert[]>>(),
    sourceReleve: uuid('source_releve').references(() => releve.id, { onDelete: 'set null' }),
  },
  (t) => [unique().on(t.carrefourId, t.code)],
);

/**
 * Passage d'une rame à un arrêt, déduit du flux GTFS-RT Ginko : l'arrêt disparaît de la liste
 * des arrêts restants de la course. Voir docs/ARCHITECTURE.md §8.2.
 */
export const tramPassage = pgTable(
  'tram_passage',
  {
    /** Jour de service de la course (une course après minuit appartient à la veille). */
    jour: date('jour', { mode: 'string' }).notNull(),
    course: text('course').notNull(),
    sequence: smallint('sequence').notNull(),
    vehicule: text('vehicule'),
    parcours: text('parcours').notNull(),
    arret: text('arret').notNull(),
    arretPrecedent: text('arret_precedent'),
    /** Dernière heure prévue avant la disparition de l'arrêt : l'heure de passage retenue. */
    heurePrevue: timestamp('heure_prevue', { withTimezone: true }).notNull(),
    /** Instant (horodatage du flux) où l'arrêt a disparu. */
    detecteA: timestamp('detecte_a', { withTimezone: true }).notNull(),
    heureTheorique: timestamp('heure_theorique', { withTimezone: true }),
    /** Heure prévue à différents horizons avant le passage : horizon (s) → s epoch. */
    previsions: jsonb('previsions').$type<Record<string, number>>().notNull().default({}),
  },
  (t) => [
    primaryKey({ columns: [t.jour, t.course, t.sequence] }),
    uniqueIndex('tram_passage_course_arret_idx').on(t.jour, t.course, t.arret),
    index('tram_passage_heure_idx').on(t.heurePrevue),
  ],
);

/**
 * Durée observée de chaque tronçon : deux passages consécutifs d'une même course.
 * Créée par une migration manuelle (0003), déclarée ici pour le typage.
 */
export const tramTronconObserve = pgView('tram_troncon_observe', {
  parcours: text('parcours').notNull(),
  depart: text('depart').notNull(),
  arrivee: text('arrivee').notNull(),
  jour: date('jour', { mode: 'string' }).notNull(),
  course: text('course').notNull(),
  vehicule: text('vehicule'),
  arriveeA: timestamp('arrivee_a', { withTimezone: true }).notNull(),
  dureeS: real('duree_s').notNull(),
  heure: smallint('heure').notNull(),
  typeJour: text('type_jour').notNull(),
}).existing();
