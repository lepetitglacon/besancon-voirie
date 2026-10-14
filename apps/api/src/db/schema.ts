import { sql } from 'drizzle-orm';
import {
  bigint,
  customType,
  boolean,
  check,
  date,
  geometry,
  index,
  jsonb,
  pgEnum,
  pgTable,
  pgView,
  primaryKey,
  integer,
  real,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type { Anneau, ArcGraphe, Controleur, Etape, IntervalleVert, Plage, SourceZoneOsm } from '@voirie/schema';

// Tables du projet — voir docs/ARCHITECTURE.md §4.
// Les tables issues d'OpenStreetMap (osm_*) sont gérées par l'import, pas par Drizzle.

/**
 * LineString WGS84. Drizzle ne sait typer que les points : on déclare le type SQL exact et
 * on lit ou écrit ces colonnes en SQL (ST_AsGeoJSON / ST_GeomFromGeoJSON).
 */
const ligne = customType<{ data: string; driverData: string }>({
  dataType: () => 'geometry(LineString, 4326)',
});

/** Plusieurs lignes : les passages piétons d'une branche. */
const lignes = customType<{ data: string; driverData: string }>({
  dataType: () => 'geometry(MultiLineString, 4326)',
});

const multiPolygone = customType<{ data: string; driverData: string }>({
  dataType: () => 'geometry(MultiPolygon, 4326)',
});

const creeLe = () => timestamp('cree_le', { withTimezone: true }).notNull().defaultNow();

export const statutCarrefour = pgEnum('statut_carrefour', [
  'a_confirmer',
  'non_releve',
  'estime',
  'mesure',
  'verifie',
]);

/** Carrefour à feux, giratoire, ou traversée piétonne à feux isolée (hors carrefour). */
export const natureCarrefour = pgEnum('nature_carrefour', ['carrefour', 'giratoire', 'traversee_pietonne']);

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
    /** Paires de lignes en conflit tolérées (tourne-à-droite avec piétons…). */
    conflitsAdmis: jsonb('conflits_admis').$type<Array<[string, string]>>().notNull().default([]),
    /** Giratoire : nœuds de l'anneau, dans l'ordre de circulation — docs/CONFIGURATION.md §7. */
    anneau: jsonb('anneau').$type<Anneau>(),
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
 *
 * `geom` est la position retenue : celle d'OSM (`geom_osm`), qui est souvent au milieu de la
 * chaussée, ou celle du mât sur la photo si le feu a été placé à la main (`position_manuelle`).
 */
export const feu = pgTable(
  'feu',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    osmId: bigint('osm_id', { mode: 'number' }).unique(),
    type: typeFeu('type').notNull(),
    tags: jsonb('tags').$type<Record<string, string>>().notNull().default({}),
    geom: geometry('geom', { type: 'point', mode: 'xy', srid: 4326 }).notNull(),
    /** Position brute d'OSM, mise à jour à chaque import ; nulle pour un feu ajouté à la main. */
    geomOsm: geometry('geom_osm', { type: 'point', mode: 'xy', srid: 4326 }),
    positionManuelle: boolean('position_manuelle').notNull().default(false),
    presentOsm: boolean('present_osm').notNull().default(true),
    carrefourId: uuid('carrefour_id').references(() => carrefour.id, { onDelete: 'set null' }),
    creeLe: creeLe(),
  },
  (t) => [index('feu_geom_idx').using('gist', t.geom), index('feu_carrefour_idx').on(t.carrefourId)],
);

export const sensBranche = pgEnum('sens_branche', ['entrant', 'sortant', 'double']);
export const typeVoie = pgEnum('type_voie', ['generale', 'bus', 'velo', 'tram']);
export const sensVoie = pgEnum('sens_voie', ['entrante', 'sortante']);
/** Régime d'une entrée de giratoire hors feux ; null = cédez-le-passage. */
export const prioriteEntree = pgEnum('priorite_entree', ['cedez_le_passage', 'stop', 'priorite_a_droite']);

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
    /** Déduit des voies à l'enregistrement. */
    sens: sensBranche('sens').notNull().default('double'),
    /** Du centre du carrefour vers la branche. */
    geom: ligne('geom'),
    /** Passages piétons en travers de la branche (un ou plusieurs), chacun d'un trottoir à l'autre. */
    traversee: lignes('traversee'),
    prioriteEntree: prioriteEntree('priorite_entree'),
    /** Giratoire : nœud où la rue se raccorde à l'anneau ; pour un tronçon, son nœud de départ. */
    noeud: text('noeud'),
    /** Tronçon d'anneau généré (R1, R2…), et non une rue. */
    troncon: boolean('troncon').notNull().default(false),
  },
  (t) => [unique().on(t.carrefourId, t.code)],
);

/**
 * Voie d'une branche, dessinée sur la photo : rang 0 = la plus à gauche dans son sens de
 * circulation ; `geom` = [bout côté carrefour, bout éloigné].
 */
export const voie = pgTable(
  'voie',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    brancheId: uuid('branche_id')
      .notNull()
      .references(() => branche.id, { onDelete: 'cascade' }),
    sens: sensVoie('sens').notNull(),
    rang: smallint('rang').notNull(),
    type: typeVoie('type').notNull().default('generale'),
    geom: ligne('geom').notNull(),
  },
  (t) => [unique().on(t.brancheId, t.sens, t.rang)],
);

/** Connexion d'une voie entrante vers une voie sortante (« lane connector »). */
export const connexion = pgTable(
  'connexion',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    carrefourId: uuid('carrefour_id')
      .notNull()
      .references(() => carrefour.id, { onDelete: 'cascade' }),
    voieEntreeId: uuid('voie_entree_id')
      .notNull()
      .references(() => voie.id, { onDelete: 'cascade' }),
    voieSortieId: uuid('voie_sortie_id')
      .notNull()
      .references(() => voie.id, { onDelete: 'cascade' }),
  },
  (t) => [unique().on(t.voieEntreeId, t.voieSortieId)],
);

/**
 * Chaînage d'une voie sortante vers une voie entrante du même carrefour, de bout éloigné à bout
 * éloigné : une place faite de plusieurs petits carrefours (docs/CONFIGURATION.md §3).
 */
export const chainage = pgTable(
  'chainage',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    carrefourId: uuid('carrefour_id')
      .notNull()
      .references(() => carrefour.id, { onDelete: 'cascade' }),
    voieSortieId: uuid('voie_sortie_id')
      .notNull()
      .references(() => voie.id, { onDelete: 'cascade' }),
    voieEntreeId: uuid('voie_entree_id')
      .notNull()
      .references(() => voie.id, { onDelete: 'cascade' }),
  },
  (t) => [unique().on(t.voieSortieId, t.voieEntreeId)],
);

/**
 * Ligne de feux (signal group) — docs/CONFIGURATION.md §4. `mouvements` : clés « S>O » des
 * mouvements commandés ; `traverse` : branche traversée par une ligne piétonne (R12).
 */
export const ligneFeux = pgTable(
  'ligne_feux',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    carrefourId: uuid('carrefour_id')
      .notNull()
      .references(() => carrefour.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    signal: text('signal').notNull(),
    mouvements: text('mouvements')
      .array()
      .notNull()
      .default(sql`'{}'`),
    traverse: text('traverse'),
  },
  (t) => [unique().on(t.carrefourId, t.code)],
);

/** Feux physiques qui affichent une ligne de feux. */
export const ligneFeuxFeu = pgTable(
  'ligne_feux_feu',
  {
    ligneFeuxId: uuid('ligne_feux_id')
      .notNull()
      .references(() => ligneFeux.id, { onDelete: 'cascade' }),
    feuId: uuid('feu_id')
      .notNull()
      .references(() => feu.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.ligneFeuxId, t.feuId] })],
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
    /** Programme saisi par étapes, dont `lignes` (diagramme de feux) est déduit. */
    etapes: jsonb('etapes').$type<Etape[]>(),
    /** Rouges de dégagement saisis à la main (« F1>F2 » → s), qui remplacent le calcul. */
    degagements: jsonb('degagements').$type<Record<string, number>>().notNull().default({}),
    /** Arcs du graphe des étapes (priorité tram, retours), en plus du cycle de base. */
    arcs: jsonb('arcs').$type<ArcGraphe[]>().notNull().default([]),
    sourceReleve: uuid('source_releve').references(() => releve.id, { onDelete: 'set null' }),
  },
  (t) => [unique().on(t.carrefourId, t.code)],
);

/**
 * Top relevé sur place : instant où une ligne de feux passe au vert. Observation brute : le
 * plan en vigueur et le décalage s'en déduisent à la lecture (docs/ARCHITECTURE.md §6.1).
 */
export const topSynchro = pgTable(
  'top_synchro',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    carrefourId: uuid('carrefour_id')
      .notNull()
      .references(() => carrefour.id, { onDelete: 'cascade' }),
    ligne: text('ligne').notNull(),
    instant: timestamp('instant', { withTimezone: true }).notNull(),
    creeLe: creeLe(),
  },
  (t) => [index('top_synchro_carrefour_idx').on(t.carrefourId, t.instant)],
);

/**
 * Passage d'un véhicule à un arrêt, déduit du flux GTFS-RT Ginko : l'arrêt disparaît de la liste
 * des arrêts restants de la course. Voir docs/ARCHITECTURE.md §8.2. Mêmes colonnes pour le tram
 * et le bus, dans deux tables : le bus compte dix fois plus de passages.
 */
function tablePassages<N extends string>(nom: N) {
  return pgTable(
    nom,
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
      uniqueIndex(`${nom}_course_arret_idx`).on(t.jour, t.course, t.arret),
      index(`${nom}_heure_idx`).on(t.heurePrevue),
    ],
  );
}

export const tramPassage = tablePassages('tram_passage');
export const busPassage = tablePassages('bus_passage');

/**
 * Durée observée de chaque tronçon : deux passages consécutifs d'une même course.
 * Créées par des migrations manuelles (0003 pour le tram), déclarées ici pour le typage.
 */
function vueTroncons<N extends string>(nom: N) {
  return pgView(nom, {
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
}

export const tramTronconObserve = vueTroncons('tram_troncon_observe');
export const busTronconObserve = vueTroncons('bus_troncon_observe');

/** File des propositions « OSM + IA » : une analyse de l'orthophoto par Claude, par demande. */
export const statutAnalyseIa = pgEnum('statut_analyse_ia', ['en_attente', 'en_cours', 'terminee', 'echec']);

export const analyseIa = pgTable(
  'analyse_ia',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    carrefourId: uuid('carrefour_id')
      .notNull()
      .references(() => carrefour.id, { onDelete: 'cascade' }),
    statut: statutAnalyseIa('statut').notNull().default('en_attente'),
    /** Proposition (DetectionBranchesIa), une fois terminée. */
    resultat: jsonb('resultat'),
    erreur: text('erreur'),
    /** Zone de la photo dessinée sur la carte, [ouest, sud, est, nord] ; null : cadre calculé d'après les feux. */
    emprise: jsonb('emprise').$type<[number, number, number, number]>(),
    demandeeLe: timestamp('demandee_le', { withTimezone: true }).notNull().defaultNow(),
    commenceeLe: timestamp('commencee_le', { withTimezone: true }),
    finieLe: timestamp('finie_le', { withTimezone: true }),
    /** Proposition chargée dans l'éditeur : la notification ne s'affiche plus. */
    consulteeLe: timestamp('consultee_le', { withTimezone: true }),
  },
  (t) => [index('analyse_ia_statut_idx').on(t.statut, t.demandeeLe), index('analyse_ia_carrefour_idx').on(t.carrefourId)],
);

export const statutEssaiIa = pgEnum('statut_essai_ia', ['terminee', 'echec', 'delai']);

/**
 * Un modèle lancé sur la photo d'une analyse : chaque analyse lance tous les modèles
 * d'IA_MODELES, pour comparer qualité, temps et coût. Gardé quand l'analyse est retirée.
 */
export const essaiIa = pgTable(
  'essai_ia',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    analyseId: uuid('analyse_id').references(() => analyseIa.id, { onDelete: 'set null' }),
    carrefourId: uuid('carrefour_id')
      .notNull()
      .references(() => carrefour.id, { onDelete: 'cascade' }),
    /** Modèle demandé (alias d'IA_MODELES) et modèle qui a répondu. */
    modele: text('modele').notNull(),
    modeleReel: text('modele_reel'),
    effort: text('effort').notNull(),
    statut: statutEssaiIa('statut').notNull(),
    /** Temps mesuré par l'API, du lancement à la réponse (ou à l'abandon). */
    dureeS: real('duree_s').notNull(),
    coutUsd: real('cout_usd'),
    tokensEntree: integer('tokens_entree'),
    tokensSortie: integer('tokens_sortie'),
    /** Proposition (DetectionBranchesIa) tirée de la réponse. */
    resultat: jsonb('resultat'),
    erreur: text('erreur'),
    /** Photo, consigne et sortie brute, si IA_GARDER_FICHIERS=true. */
    dossier: text('dossier'),
    creeLe: timestamp('cree_le', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('essai_ia_analyse_idx').on(t.analyseId), index('essai_ia_carrefour_idx').on(t.carrefourId, t.creeLe)],
);

/**
 * Zone d'import OSM de l'instance (une seule ligne) : l'import ne garde que les feux qu'elle
 * contient — docs/ARCHITECTURE.md §5. Sans zone, il garde ceux de la commune de Besançon.
 */
export const zoneOsm = pgTable(
  'zone_osm',
  {
    id: smallint('id').primaryKey().default(1),
    geom: multiPolygone('geom').notNull(),
    source: jsonb('source').$type<SourceZoneOsm>().notNull(),
    modifieeLe: timestamp('modifiee_le', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check('zone_osm_unique', sql`${t.id} = 1`)],
);
