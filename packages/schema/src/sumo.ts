import { z } from 'zod';

/**
 * Essais SUMO de la ville entière, archivés par `data/sumo/ville/essai.py` dans
 * `data/sumo/ville/essais/<id>/` : meta.json, troncons.geojson, series.bin.gz.
 */

/** Identifiant d'essai : horodatage et nom, en kebab-case (`20261009-2215-choix-au-depart`). */
export const MOTIF_ID_ESSAI = /^[a-z0-9][a-z0-9-]{0,99}$/;

/** Bilan d'une journée simulée. */
export interface BilanEssai {
  /** Voitures entrées dans la simulation. */
  inseres: number;
  /** Voitures arrivées à destination. */
  arrives: number;
  teleportations: number;
  /** Heure simulée de fin, en secondes depuis minuit. */
  finSimulee: number;
  /** Raison d'un arrêt anticipé (« Too many teleports »), sinon null. */
  raisonFin: string | null;
  /** Temps de calcul de SUMO, en s. */
  dureeCalcul: number;
  /** Par trajet arrivé, en s (distance en m). */
  dureeMoyenne: number;
  perteMoyenne: number;
  attenteMoyenne: number;
  distanceMoyenne: number;
}

/** Résumé d'un essai, pour la liste. */
export interface EssaiSumoResume {
  id: string;
  nom: string;
  description: string;
  /** Date de l'archivage (ISO, heure locale). */
  cree: string;
  /** Début et fin des mesures, en secondes depuis minuit. */
  debut: number;
  fin: number;
  /** Durée d'une tranche de mesure, en s. */
  pas: number;
  tranches: number;
  troncons: number;
  bilan: BilanEssai;
}

/** Grandeur brute stockée dans les séries : valeur = brut × facteur. */
export interface GrandeurSerie {
  cle: 'entres' | 'secondes' | 'vitesse' | 'perte' | 'attente';
  facteur: number;
}

/** Essai complet : résumé, format des séries et courbes de la ville au début de chaque tranche. */
export interface EssaiSumo extends EssaiSumoResume {
  /** Paramètres du lancement, pour un essai lancé depuis l'app. */
  parametres?: LancerEssaiSumo;
  /** Voitures enregistrées une par une (vehicules.bin.gz), si l'essai les a. */
  vehicules?: {
    nombre: number;
    /** Tronçons parcourus, toutes voitures confondues. */
    etapes: number;
    /** Motifs (« matin », « midi », « soir », « flux1 »…) ; le fichier donne leur rang. */
    motifs: string[];
  };
  series: { grandeurs: GrandeurSerie[]; absent: number };
  globales: {
    enRoute: number[];
    aLArret: number[];
    /** Vitesse moyenne des voitures en route, en km/h. */
    vitesse: number[];
    arrives: number[];
    teleportations: number[];
  };
}

/** Tronçon (arête SUMO) emprunté pendant l'essai, avec ses agrégats sur toute la journée. */
export interface TronconSumo {
  /** Rang dans les séries (et `id` de l'entité GeoJSON). */
  i: number;
  /** Identifiant de l'arête SUMO. */
  id: string;
  nom: string;
  /** En m. */
  longueur: number;
  voies: number;
  /** Vitesse autorisée, en km/h. */
  vmax: number;
  /** Voitures entrées sur le tronçon pendant l'essai. */
  total: number;
  /** Plus fort débit d'une tranche, en véh/h. */
  debitMax: number;
  /** Plus forte densité moyenne d'une tranche, en véh/km. */
  densiteMax: number;
  /** En km/h : moyenne (distance / temps), plus basse et plus haute moyenne d'une tranche. */
  vitesseMoy: number | null;
  vitesseMin: number | null;
  vitesseMax: number | null;
  /** Par voiture passée, en s. */
  perte: number;
  attente: number;
}

export interface TronconsSumoGeoJson {
  type: 'FeatureCollection';
  features: {
    type: 'Feature';
    id: number;
    properties: TronconSumo;
    geometry: { type: 'LineString'; coordinates: [number, number][] };
  }[];
}

// --- Options de SUMO et lancement d'essais ------------------------------------------------------

/** Option de SUMO, décrite par SUMO lui-même (`data/sumo/ville/options_sumo.py`). */
export interface OptionSumo {
  cle: string;
  type: 'BOOL' | 'INT' | 'FLOAT' | 'TIME' | 'STR' | 'STR[]' | 'FILE';
  /** Valeur par défaut de SUMO (texte, comme dans un .sumocfg). */
  defaut: string;
  /** Valeur de `ville.sumocfg`, si le projet la règle. */
  projet: string | null;
  /** Aide de SUMO, en anglais. */
  aide: string;
  /** Faux pour les fichiers, entrées, sorties, journal… tenus par le lanceur. */
  modifiable: boolean;
}

export interface OptionsSumo {
  /** « Eclipse SUMO sumo 1.27.1 ». */
  version: string;
  categories: { cle: string; libelle: string; options: OptionSumo[] }[];
}

const LonLatSumo = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);

/** « À cette heure, x voitures d'ici à là-bas » : départs tirés dans un cercle, arrivées dans un autre. */
export const FluxSumo = z
  .object({
    nom: z.string().trim().max(80).default(''),
    origine: LonLatSumo,
    destination: LonLatSumo,
    /** Rayon des deux cercles, en m. */
    rayon: z.number().min(50).max(5000).default(500),
    /** Départs répartis entre début et fin, en secondes depuis minuit. */
    debut: z.number().min(0).max(86_400),
    fin: z.number().min(0).max(86_400),
    voitures: z.number().int().min(1).max(50_000),
  })
  .refine((f) => f.fin > f.debut, { message: 'La fin du flux doit suivre son début', path: ['fin'] });
export type FluxSumo = z.infer<typeof FluxSumo>;

/** Réglages du scénario, préparés avant la simulation (demande, feux, itinéraires). */
export const ScenarioSumo = z.object({
  graine: z.number().int().min(0).max(1_000_000).default(42),
  /** En % de la demande de référence (28 000 voitures de 7 h à 8 h 30). */
  volume: z.number().min(1).max(300).default(100),
  retourSoir: z.boolean().default(true),
  /** Part des navetteurs qui sortent le midi (rentrer manger, restaurant), en %. */
  midi: z.number().min(0).max(100).default(20),
  /** Flux ajoutés à la main. */
  flux: z.array(FluxSumo).max(50).default([]),
  /** netconvert : programmes inventés ; adaptes : cycle et verts selon la demande ; coordonnes : + ondes vertes. */
  feux: z.enum(['netconvert', 'adaptes', 'coordonnes']).default('coordonnes'),
  /** depart : choisi en partant d'après le trafic ; reacheminement : recalculé en route ; vide : ville vide. */
  itineraire: z.enum(['depart', 'reacheminement', 'vide']).default('depart'),
  /** En s, pour le réacheminement en route. */
  periodeReacheminement: z.number().int().min(30).max(3600).default(120),
});
export type ScenarioSumo = z.infer<typeof ScenarioSumo>;

export const LancerEssaiSumo = z.object({
  nom: z.string().trim().min(1).max(80),
  description: z.string().trim().max(1000).default(''),
  scenario: ScenarioSumo,
  /** Options de SUMO modifiées, en texte comme dans un .sumocfg (`"time-to-teleport": "300"`). */
  options: z.record(z.string(), z.string().max(500)).default({}),
});
export type LancerEssaiSumo = z.infer<typeof LancerEssaiSumo>;

export type EtapeLancement = 'preparation' | 'simulation' | 'archivage' | 'fini' | 'erreur' | 'annule';

/** Avancement d'un lancement, envoyé en SSE pendant la journée simulée. */
export interface LancementSumo {
  id: string;
  nom: string;
  etape: EtapeLancement;
  /** Sous-étape en cours (« Feux coordonnés »), ou message d'erreur. */
  detail: string;
  /** Début et fin (ms depuis 1970). */
  debut: number;
  fin: number | null;
  /** Temps écoulé, en s. */
  ecoule: number;
  /** Plage simulée, en secondes depuis minuit (connue à partir de l'étape simulation). */
  debutSimule: number | null;
  finSimulee: number | null;
  /** Dernier pas écrit par SUMO dans summary.xml. */
  progression: {
    temps: number;
    charges: number;
    inseres: number;
    enRoute: number;
    aLArret: number;
    arrives: number;
    teleportations: number;
    /** En km/h. */
    vitesse: number;
  } | null;
  /** Estimation du temps restant pour la journée simulée, en s. */
  restant: number | null;
  /** Essai archivé, une fois fini. */
  essaiId: string | null;
  /** Fin du journal, en cas d'erreur. */
  journal: string | null;
}

export const ETAPES_ACTIVES: EtapeLancement[] = ['preparation', 'simulation', 'archivage'];
