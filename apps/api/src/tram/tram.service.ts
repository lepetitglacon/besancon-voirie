import { Injectable, Logger } from '@nestjs/common';
import type { BusTempsReel, ReseauBus, ReseauTram, TramsTempsReel } from '@voirie/schema';
import { GinkoClient } from './ginko.client.js';
import { cleTroncon, construireReseauBus, construireReseauTram, type ReseauTramInterne } from './gtfs.js';
import {
  creneauParis,
  HISTORIQUE_JOURS,
  HistoriqueTramService,
  PARCOURS_BUS,
  type ModeTransport,
} from './historique.service.js';
import {
  choisirTroncons,
  MemoireCourses,
  positionnerTrams,
  type CleHistorique,
  type FluxTempsReel,
  type HistoriqueCreneau,
} from './temps-reel.js';

/** Le GTFS est republié chaque nuit. */
const DUREE_RESEAU_MS = 24 * 3600 * 1000;
/** Le flux temps réel bouge toutes les quelques secondes : inutile de le relire plus souvent. */
const DUREE_TEMPS_REEL_MS = 10 * 1000;
/** Absence tolérée d'une course de bus dans le flux avant de la croire terminée. */
const ABSENCE_BUS_MAX_S = 120;
/** Les statistiques d'un créneau évoluent lentement. */
const DUREE_HISTORIQUE_MS = 10 * 60 * 1000;

/** Valeur mise en cache avec sa date de chargement ; une seule requête en vol à la fois. */
class Cache<T> {
  private entree?: { valeur: Promise<T>; chargee: number };

  constructor(
    private readonly duree_ms: number,
    private readonly charger: () => Promise<T>,
  ) {}

  lire(): Promise<T> {
    if (!this.entree || Date.now() - this.entree.chargee > this.duree_ms) {
      const valeur = this.charger();
      const entree = { valeur, chargee: Date.now() };
      this.entree = entree;
      // Un échec n'est pas mis en cache : la requête suivante réessaie.
      valeur.catch(() => {
        if (this.entree === entree) this.entree = undefined;
      });
    }
    return this.entree.valeur;
  }
}

/** Bus : historique regroupé par couple d'arrêts, toutes lignes confondues. */
export const cleTronconBus: CleHistorique = (_parcours, depart, arrivee) => cleTroncon(PARCOURS_BUS, depart, arrivee);

/** Réseaux tirés d'un même téléchargement du GTFS. */
interface Reseaux {
  tram: ReseauTramInterne;
  bus: ReseauTramInterne;
}

/**
 * Réseaux tram et bus Ginko, et position estimée des véhicules. Le flux temps réel est le même
 * pour les deux modes ; l'historique des passages ne concerne que le tram.
 */
@Injectable()
export class TramService {
  private readonly logger = new Logger(TramService.name);
  private readonly reseaux = new Cache(DUREE_RESEAU_MS, () => this.chargerReseaux());
  private readonly flux = new Cache(DUREE_TEMPS_REEL_MS, () => this.ginko.lireTempsReel());
  private readonly historique = new Cache(DUREE_HISTORIQUE_MS, () => this.chargerHistorique('tram'));
  private readonly historiqueBus = new Cache(DUREE_HISTORIQUE_MS, () => this.chargerHistorique('bus'));
  private readonly memoireBus = new MemoireCourses(ABSENCE_BUS_MAX_S);

  constructor(
    private readonly ginko: GinkoClient,
    private readonly historiqueTram: HistoriqueTramService,
  ) {}

  async lireReseau(): Promise<ReseauTram> {
    return (await this.reseaux.lire()).tram.public;
  }

  async lireReseauInterne(): Promise<ReseauTramInterne> {
    return (await this.reseaux.lire()).tram;
  }

  async lireReseauBus(): Promise<ReseauBus> {
    return (await this.reseaux.lire()).bus.public;
  }

  async lireReseauBusInterne(): Promise<ReseauTramInterne> {
    return (await this.reseaux.lire()).bus;
  }

  /** Flux GTFS-RT brut, partagé entre l'affichage et la collecte des passages. */
  lireFlux(): Promise<FluxTempsReel> {
    return this.flux.lire();
  }

  /** Flux complété des courses de bus omises depuis peu (MemoireCourses). */
  async lireFluxBus(): Promise<FluxTempsReel> {
    return this.memoireBus.completer(await this.flux.lire());
  }

  async lireTempsReel(): Promise<TramsTempsReel> {
    const [{ tram: reseau }, flux, historique] = await Promise.all([
      this.reseaux.lire(),
      this.flux.lire(),
      // Sans historique (base indisponible), on retombe sur les prévisions du flux.
      this.historique.lire().catch((erreur: Error) => {
        this.logger.warn(`Historique tram indisponible : ${erreur.message}`);
        return undefined;
      }),
    ]);
    return positionnerTrams(reseau, flux, Date.now(), historique);
  }

  /** Bus : comme le tram, l'historique des passages prime sur les prévisions du flux. */
  async lireBusTempsReel(): Promise<BusTempsReel> {
    const [{ bus: reseau }, flux, historique] = await Promise.all([
      this.reseaux.lire(),
      this.lireFluxBus(),
      this.historiqueBus.lire().catch((erreur: Error) => {
        this.logger.warn(`Historique bus indisponible : ${erreur.message}`);
        return undefined;
      }),
    ]);
    const { horodatage, trams, calibration } = positionnerTrams(reseau, flux, Date.now(), historique, cleTronconBus);
    return { horodatage, bus: trams, ...(calibration && { calibration }) };
  }

  private async chargerReseaux(): Promise<Reseaux> {
    const debut = Date.now();
    const fichiers = await this.ginko.telechargerGtfs();
    const reseaux = { tram: construireReseauTram(fichiers), bus: construireReseauBus(fichiers) };
    this.logger.log(
      `GTFS Ginko ${reseaux.tram.public.version} : ${reseaux.tram.public.parcours.length} parcours tram ` +
        `(${reseaux.tram.courses.size} courses), ${reseaux.bus.public.parcours.length} parcours bus ` +
        `(${reseaux.bus.courses.size} courses) en ${Date.now() - debut} ms`,
    );
    return reseaux;
  }

  private async chargerHistorique(mode: ModeTransport): Promise<HistoriqueCreneau> {
    const { typeJour, heure } = creneauParis(Date.now());
    const [creneau, journee, calibration] = await Promise.all([
      this.historiqueTram.troncons(typeJour, heure, HISTORIQUE_JOURS, mode),
      this.historiqueTram.troncons(typeJour, null, HISTORIQUE_JOURS, mode),
      this.historiqueTram.calibration(HISTORIQUE_JOURS, mode),
    ]);
    return {
      troncons: choisirTroncons(creneau, journee, mode === 'bus' ? cleTronconBus : cleTroncon),
      calibration,
    };
  }
}
