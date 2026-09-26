import {
  preparerPolyligne,
  projeter,
  type Coordonnees,
  type Polyligne,
} from '@voirie/engine';
import type { ParcoursTram, ReseauTram } from '@voirie/schema';

/** Contenu texte des fichiers du GTFS, par nom (`stops.txt`…). */
export type FichiersGtfs = Record<string, string>;

/** GTFS `route_type` du tramway. */
const TYPE_TRAMWAY = '0';

/**
 * Lit un fichier CSV GTFS (champs entre guillemets possibles, pas de retour à la ligne dans
 * un champ). `garder` filtre les lignes sur leur premier champ avant de les découper : utile
 * pour `stop_times.txt` (plus de 500 000 lignes, dont quelques milliers pour le tram).
 */
export function lireCsv(
  texte: string,
  garder?: (premierChamp: string) => boolean,
): Array<Record<string, string>> {
  const lignes = texte.replace(/^﻿/, '').split(/\r?\n/);
  const entetes = decouper(lignes[0] ?? '').map((entete) => entete.trim());
  const lues: Array<Record<string, string>> = [];
  for (const ligne of lignes.slice(1)) {
    if (!ligne) continue;
    if (garder) {
      const virgule = ligne.indexOf(',');
      const premier = virgule < 0 ? ligne : ligne.slice(0, virgule);
      if (!garder(premier.replaceAll('"', ''))) continue;
    }
    const champs = decouper(ligne);
    lues.push(Object.fromEntries(entetes.map((entete, i) => [entete, champs[i] ?? ''])));
  }
  return lues;
}

function decouper(ligne: string): string[] {
  const champs: string[] = [];
  let champ = '';
  let entreGuillemets = false;
  for (let i = 0; i < ligne.length; i++) {
    const c = ligne[i];
    if (entreGuillemets) {
      if (c === '"' && ligne[i + 1] === '"') {
        champ += '"';
        i++;
      } else if (c === '"') entreGuillemets = false;
      else champ += c;
    } else if (c === '"') entreGuillemets = true;
    else if (c === ',') {
      champs.push(champ);
      champ = '';
    } else champ += c;
  }
  champs.push(champ);
  return champs;
}

/** `HH:MM:SS` GTFS (les heures peuvent dépasser 24) en secondes depuis minuit. */
export function secondesGtfs(heure: string): number {
  const [h = 0, m = 0, s = 0] = heure.split(':').map(Number);
  return h * 3600 + m * 60 + s;
}

export function mediane(valeurs: number[]): number | undefined {
  if (valeurs.length === 0) return undefined;
  const triees = [...valeurs].sort((a, b) => a - b);
  const milieu = triees.length >> 1;
  return triees.length % 2 ? triees[milieu] : (triees[milieu - 1]! + triees[milieu]!) / 2;
}

/** Clé d'un tronçon : parcours, arrêt de départ, arrêt d'arrivée. */
export function cleTroncon(parcours: string, depart: string, arrivee: string): string {
  return `${parcours}|${depart}|${arrivee}`;
}

export interface CourseTram {
  parcours: string;
  /** Arrêts desservis, triés par `stop_sequence`. */
  arrets: Array<{ sequence: number; arret: string }>;
}

/** Réseau tram prêt pour le calcul des positions. */
export interface ReseauTramInterne {
  /** Ce qui est servi au front. */
  public: ReseauTram;
  lignes: Map<string, Polyligne>;
  /** Parcours → arrêt → distance le long du tracé, en m. */
  distances: Map<string, Map<string, number>>;
  noms: Map<string, string>;
  courses: Map<string, CourseTram>;
  /** Durée médiane de chaque tronçon d'après les horaires théoriques, en s. */
  dureesTheoriques: Map<string, number>;
}

function plusFrequent(valeurs: string[]): string | undefined {
  const comptes = new Map<string, number>();
  for (const valeur of valeurs) comptes.set(valeur, (comptes.get(valeur) ?? 0) + 1);
  return [...comptes].sort((a, b) => b[1] - a[1])[0]?.[0];
}

function grouper<T>(elements: T[], cle: (element: T) => string): Map<string, T[]> {
  const groupes = new Map<string, T[]>();
  for (const element of elements) {
    const k = cle(element);
    const groupe = groupes.get(k);
    if (groupe) groupe.push(element);
    else groupes.set(k, [element]);
  }
  return groupes;
}

function lire(fichiers: FichiersGtfs, nom: string): string {
  const contenu = fichiers[nom];
  if (contenu === undefined) throw new Error(`GTFS incomplet : ${nom} manquant`);
  return contenu;
}

/**
 * Extrait du GTFS les lignes de tram, un parcours par ligne et par sens. Les variantes de
 * tracé d'un même sens (une par période de service chez Ginko) desservent les mêmes arrêts :
 * on garde la plus utilisée.
 */
export function construireReseauTram(fichiers: FichiersGtfs): ReseauTramInterne {
  const routes = new Map(
    lireCsv(lire(fichiers, 'routes.txt'))
      .filter((route) => route.route_type === TYPE_TRAMWAY)
      .map((route) => [route.route_id!, route]),
  );
  const trips = lireCsv(lire(fichiers, 'trips.txt')).filter((trip) => routes.has(trip.route_id!));
  const parcoursDeCourse = new Map(
    trips.map((trip) => [trip.trip_id!, `${trip.route_id}-${trip.direction_id || '0'}`]),
  );

  const horaires = grouper(
    lireCsv(lire(fichiers, 'stop_times.txt'), (course) => parcoursDeCourse.has(course)),
    (horaire) => horaire.trip_id!,
  );
  const courses = new Map<string, CourseTram>();
  for (const [course, lignes] of horaires) {
    courses.set(course, {
      parcours: parcoursDeCourse.get(course)!,
      arrets: lignes
        .map((horaire) => ({ sequence: Number(horaire.stop_sequence), arret: horaire.stop_id! }))
        .sort((a, b) => a.sequence - b.sequence),
    });
  }

  const stops = new Map(lireCsv(lire(fichiers, 'stops.txt')).map((stop) => [stop.stop_id!, stop]));
  const formesRetenues = new Map<string, string>();
  const tripsParParcours = grouper(trips, (trip) => parcoursDeCourse.get(trip.trip_id!)!);
  for (const [parcours, tripsDuParcours] of tripsParParcours) {
    const forme = plusFrequent(tripsDuParcours.map((trip) => trip.shape_id!).filter(Boolean));
    if (forme) formesRetenues.set(forme, parcours);
  }
  const points = grouper(
    lireCsv(lire(fichiers, 'shapes.txt'), (forme) => formesRetenues.has(forme)),
    (point) => point.shape_id!,
  );

  const reseau: ReseauTramInterne = {
    public: { parcours: [], version: lireCsv(fichiers['feed_info.txt'] ?? '')[0]?.feed_start_date ?? '' },
    lignes: new Map(),
    distances: new Map(),
    noms: new Map([...stops].map(([id, stop]) => [id, stop.stop_name ?? id])),
    courses,
    dureesTheoriques: new Map(),
  };

  for (const [forme, parcours] of formesRetenues) {
    const tripsDuParcours = tripsParParcours.get(parcours)!;
    const route = routes.get(tripsDuParcours[0]!.route_id!)!;
    const coordonnees = (points.get(forme) ?? [])
      .sort((a, b) => Number(a.shape_pt_sequence) - Number(b.shape_pt_sequence))
      .map((point): Coordonnees => [Number(point.shape_pt_lon), Number(point.shape_pt_lat)]);
    if (coordonnees.length < 2) continue;
    const ligne = preparerPolyligne(coordonnees);

    // Arrêts dans l'ordre de la course la plus longue, projetés un à un le long du tracé.
    const reference = tripsDuParcours
      .map((trip) => courses.get(trip.trip_id!))
      .filter((course) => course !== undefined)
      .sort((a, b) => b.arrets.length - a.arrets.length)[0];
    const distances = new Map<string, number>();
    const arrets: ParcoursTram['arrets'] = [];
    let dernier = 0;
    for (const { arret } of reference?.arrets ?? []) {
      const stop = stops.get(arret);
      if (!stop || distances.has(arret)) continue;
      const position: Coordonnees = [Number(stop.stop_lon), Number(stop.stop_lat)];
      dernier = projeter(ligne, position, dernier);
      distances.set(arret, dernier);
      arrets.push({ id: arret, nom: stop.stop_name ?? arret, distance: Math.round(dernier), coordonnees: position });
    }

    reseau.lignes.set(parcours, ligne);
    reseau.distances.set(parcours, distances);
    reseau.public.parcours.push({
      id: parcours,
      ligne: route.route_short_name ?? parcours,
      couleur: `#${route.route_color || '888888'}`,
      couleurTexte: `#${route.route_text_color || 'FFFFFF'}`,
      destination: plusFrequent(tripsDuParcours.map((trip) => trip.trip_headsign ?? '')) ?? '',
      coordonnees,
      arrets,
    });
  }
  reseau.public.parcours.sort((a, b) => a.id.localeCompare(b.id));

  // Durées théoriques des tronçons : horaires à la minute, d'où la médiane sur toutes les courses.
  const echantillons = new Map<string, number[]>();
  for (const [course, lignes] of horaires) {
    const parcours = parcoursDeCourse.get(course)!;
    const triees = [...lignes].sort((a, b) => Number(a.stop_sequence) - Number(b.stop_sequence));
    for (let i = 1; i < triees.length; i++) {
      const depart = triees[i - 1]!;
      const arrivee = triees[i]!;
      const duree = secondesGtfs(arrivee.arrival_time!) - secondesGtfs(depart.departure_time!);
      const cle = cleTroncon(parcours, depart.stop_id!, arrivee.stop_id!);
      const durees = echantillons.get(cle);
      if (durees) durees.push(duree);
      else echantillons.set(cle, [duree]);
    }
  }
  for (const [cle, durees] of echantillons) {
    const duree = mediane(durees);
    if (duree !== undefined && duree > 0) reseau.dureesTheoriques.set(cle, duree);
  }

  return reseau;
}
