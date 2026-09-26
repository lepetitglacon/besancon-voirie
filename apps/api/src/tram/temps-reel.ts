import type { TramEnCirculation, TramsTempsReel } from '@voirie/schema';
import { cleTroncon, mediane, type ReseauTramInterne } from './gtfs.js';

/** Prévision de passage à un arrêt restant de la course. */
export interface PrevisionArret {
  sequence: number;
  arret: string;
  /** Arrivée prévue, en s epoch. */
  arrivee: number;
  /** Départ prévu, en s epoch (égal à l'arrivée chez Ginko). */
  depart: number;
}

/** Une course du flux GTFS-RT `tripUpdates`, réduite à ce qui sert ici. */
export interface CourseTempsReel {
  course: string;
  vehicule?: string;
  /** Arrêts restants, triés par séquence : les arrêts déjà desservis n'y figurent plus. */
  arrets: PrevisionArret[];
}

export interface FluxTempsReel {
  /** Instant de production du flux, en s epoch. */
  horodatage: number;
  courses: CourseTempsReel[];
}

/** Au-delà, une rame qui attend au terminus est considérée comme hors service. */
const ATTENTE_TERMINUS_MAX_S = 20 * 60;
/** Une prévision d'arrivée dépassée de plus que ça est jugée périmée. */
const PREVISION_PERIMEE_S = 5 * 60;
/** Vitesse de repli quand aucune durée n'est connue pour un tronçon (~22 km/h). */
const VITESSE_REPLI = 6;

/**
 * Durée de chaque tronçon d'après les prévisions du flux : la différence entre deux arrêts
 * consécutifs d'une même course, en médiane sur toutes les courses à venir. Plus fine que les
 * horaires théoriques, arrondis à la minute.
 */
export function dureesObservees(reseau: ReseauTramInterne, flux: FluxTempsReel): Map<string, number> {
  const echantillons = new Map<string, number[]>();
  for (const { course, arrets } of flux.courses) {
    const statique = reseau.courses.get(course);
    if (!statique) continue;
    const rangs = new Map(statique.arrets.map(({ sequence }, rang) => [sequence, rang]));
    for (let i = 1; i < arrets.length; i++) {
      const depart = arrets[i - 1]!;
      const arrivee = arrets[i]!;
      if (rangs.get(arrivee.sequence) !== (rangs.get(depart.sequence) ?? -2) + 1) continue;
      const duree = arrivee.arrivee - depart.depart;
      if (duree <= 0) continue;
      const cle = cleTroncon(statique.parcours, depart.arret, arrivee.arret);
      const durees = echantillons.get(cle);
      if (durees) durees.push(duree);
      else echantillons.set(cle, [duree]);
    }
  }
  return new Map([...echantillons].map(([cle, durees]) => [cle, mediane(durees)!]));
}

/**
 * Dernier état connu de chaque rame. Une rame enchaîne plusieurs courses dans le flux : on
 * retient celle qu'elle effectue (un arrêt déjà desservi), sinon la prochaine à partir, si
 * son départ est proche.
 */
export function positionnerTrams(
  reseau: ReseauTramInterne,
  flux: FluxTempsReel,
  maintenant_ms: number,
): TramsTempsReel {
  const maintenant = maintenant_ms / 1000;
  const durees = dureesObservees(reseau, flux);
  const retenus = new Map<string, TramEnCirculation>();

  for (const { course, vehicule, arrets } of flux.courses) {
    const statique = reseau.courses.get(course);
    const suivant = arrets[0];
    if (!statique || !suivant || suivant.arrivee < maintenant - PREVISION_PERIMEE_S) continue;
    const distances = reseau.distances.get(statique.parcours);
    const fin = distances?.get(suivant.arret);
    if (fin === undefined) continue;

    const rang = statique.arrets.findIndex(({ sequence }) => sequence === suivant.sequence);
    const precedent = rang > 0 ? statique.arrets[rang - 1]!.arret : undefined;
    const debut = precedent === undefined ? undefined : distances!.get(precedent);

    let candidat: TramEnCirculation;
    if (precedent !== undefined && debut !== undefined) {
      const cle = cleTroncon(statique.parcours, precedent, suivant.arret);
      candidat = {
        vehicule: vehicule ?? course,
        course,
        parcours: statique.parcours,
        etat: 'en_ligne',
        arretPrecedent: reseau.noms.get(precedent) ?? precedent,
        arretSuivant: reseau.noms.get(suivant.arret) ?? suivant.arret,
        debut,
        fin,
        duree:
          durees.get(cle) ??
          reseau.dureesTheoriques.get(cle) ??
          Math.max((fin - debut) / VITESSE_REPLI, 1),
        arrivee: suivant.arrivee * 1000,
      };
    } else {
      if (rang !== 0 || suivant.depart - maintenant > ATTENTE_TERMINUS_MAX_S) continue;
      candidat = {
        vehicule: vehicule ?? course,
        course,
        parcours: statique.parcours,
        etat: 'au_terminus',
        arretPrecedent: null,
        arretSuivant: reseau.noms.get(suivant.arret) ?? suivant.arret,
        debut: fin,
        fin,
        duree: 1,
        arrivee: suivant.depart * 1000,
      };
    }

    const actuel = retenus.get(candidat.vehicule);
    if (!actuel || prioritaire(candidat, actuel)) retenus.set(candidat.vehicule, candidat);
  }

  return {
    horodatage: flux.horodatage * 1000,
    trams: [...retenus.values()].sort(
      (a, b) => a.parcours.localeCompare(b.parcours) || a.debut - b.debut,
    ),
  };
}

function prioritaire(candidat: TramEnCirculation, actuel: TramEnCirculation): boolean {
  if (candidat.etat !== actuel.etat) return candidat.etat === 'en_ligne';
  return candidat.arrivee < actuel.arrivee;
}
