import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  geometry,
  index,
  jsonb,
  pgEnum,
  pgTable,
  real,
  smallint,
  text,
  timestamp,
  unique,
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
