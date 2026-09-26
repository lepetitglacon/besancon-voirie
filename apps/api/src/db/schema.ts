import { sql } from 'drizzle-orm';
import {
  bigint,
  customType,
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

/**
 * LineString WGS84. Drizzle ne sait typer que les points : on déclare le type SQL exact et
 * on lit ou écrit ces colonnes en SQL (ST_AsGeoJSON / ST_GeomFromGeoJSON).
 */
const ligne = customType<{ data: string; driverData: string }>({
  dataType: () => 'geometry(LineString, 4326)',
});

const creeLe = () => timestamp('cree_le', { withTimezone: true }).notNull().defaultNow();

export const statutCarrefour = pgEnum('statut_carrefour', [
  'a_confirmer',
  'non_releve',
  'estime',
  'mesure',
  'verifie',
]);

/** Carrefour à feux, ou traversée piétonne à feux isolée (hors carrefour). */
export const natureCarrefour = pgEnum('nature_carrefour', ['carrefour', 'traversee_pietonne']);

export const statutModeration = pgEnum('statut_moderation', ['en_attente', 'valide', 'rejete']);

export const carrefour = pgTable(
  'carrefour',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull().unique(),
    nom: text('nom').notNull(),
    geom: geometry('geom', { type: 'point', mode: 'xy', srid: 4326 }).notNull(),
    statut: statutCarrefour('statut').notNull().default('non_releve'),
    nature: natureCarrefour('nature').notNull().default('carrefour'),
    controleur: jsonb('controleur').$type<Partial<Controleur>>().notNull().default({}),
    presTram: boolean('pres_tram').notNull().default(false),
    creeLe: creeLe(),
    modifieLe: timestamp('modifie_le', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index('carrefour_geom_idx').using('gist', t.geom)],
);

export const typeFeu = pgEnum('type_feu', ['vehicule', 'pieton']);

/**
 * Un feu physique, importé d'OpenStreetMap (ou ajouté à la main, osm_id nul). Les carrefours
 * se composent à la main en y rattachant des feux. L'import ne modifie jamais `carrefour_id`.
 */
export const feu = pgTable(
  'feu',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    osmId: bigint('osm_id', { mode: 'number' }).unique(),
    type: typeFeu('type').notNull(),
    tags: jsonb('tags').$type<Record<string, string>>().notNull().default({}),
    geom: geometry('geom', { type: 'point', mode: 'xy', srid: 4326 }).notNull(),
    presentOsm: boolean('present_osm').notNull().default(true),
    carrefourId: uuid('carrefour_id').references(() => carrefour.id, { onDelete: 'set null' }),
    creeLe: creeLe(),
  },
  (t) => [index('feu_geom_idx').using('gist', t.geom), index('feu_carrefour_idx').on(t.carrefourId)],
);

export const sensBranche = pgEnum('sens_branche', ['entrant', 'sortant', 'double']);
export const typeVoie = pgEnum('type_voie', ['generale', 'bus', 'velo', 'tram']);

/** Rue qui arrive au carrefour — docs/CONFIGURATION.md §3. */
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
    /** Degrés, sens horaire depuis le nord, du centre du carrefour vers la branche. */
    azimutDeg: real('azimut_deg'),
    sens: sensBranche('sens').notNull().default('double'),
    voiesSortantes: smallint('voies_sortantes').notNull().default(1),
    /** Du centre du carrefour vers la branche. */
    geom: ligne('geom'),
  },
  (t) => [unique().on(t.carrefourId, t.code)],
);

/** Voie entrante d'une branche : rang 0 = la plus à gauche dans le sens d'arrivée. */
export const voie = pgTable(
  'voie',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    brancheId: uuid('branche_id')
      .notNull()
      .references(() => branche.id, { onDelete: 'cascade' }),
    rang: smallint('rang').notNull(),
    mouvements: text('mouvements').array().notNull(),
    type: typeVoie('type').notNull().default('generale'),
  },
  (t) => [unique().on(t.brancheId, t.rang)],
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
