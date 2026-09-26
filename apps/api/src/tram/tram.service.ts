import { Injectable, Logger } from '@nestjs/common';
import type { ReseauTram, TramsTempsReel } from '@voirie/schema';
import { GinkoClient } from './ginko.client.js';
import { construireReseauTram, type ReseauTramInterne } from './gtfs.js';
import { positionnerTrams } from './temps-reel.js';

/** Le GTFS est republié chaque nuit. */
const DUREE_RESEAU_MS = 24 * 3600 * 1000;
/** Le flux temps réel bouge toutes les quelques secondes : inutile de le relire plus souvent. */
const DUREE_TEMPS_REEL_MS = 10 * 1000;

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

@Injectable()
export class TramService {
  private readonly logger = new Logger(TramService.name);
  private readonly reseau = new Cache(DUREE_RESEAU_MS, () => this.chargerReseau());
  private readonly tempsReel = new Cache(DUREE_TEMPS_REEL_MS, () => this.chargerTempsReel());

  constructor(private readonly ginko: GinkoClient) {}

  async lireReseau(): Promise<ReseauTram> {
    return (await this.reseau.lire()).public;
  }

  lireTempsReel(): Promise<TramsTempsReel> {
    return this.tempsReel.lire();
  }

  private async chargerReseau(): Promise<ReseauTramInterne> {
    const debut = Date.now();
    const reseau = construireReseauTram(await this.ginko.telechargerGtfs());
    this.logger.log(
      `GTFS Ginko ${reseau.public.version} : ${reseau.public.parcours.length} parcours tram, ` +
        `${reseau.courses.size} courses (${Date.now() - debut} ms)`,
    );
    return reseau;
  }

  private async chargerTempsReel(): Promise<TramsTempsReel> {
    const [reseau, flux] = await Promise.all([this.reseau.lire(), this.ginko.lireTempsReel()]);
    return positionnerTrams(reseau, flux, Date.now());
  }
}
