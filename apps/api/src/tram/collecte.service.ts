import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DetecteurPassages } from './collecte.js';
import { HistoriqueTramService } from './historique.service.js';
import { TramService } from './tram.service.js';

/** Lecture du flux : assez fréquente pour dater les passages à ~10 s près. */
const PERIODE_MS = 10 * 1000;
const BILAN_MS = 10 * 60 * 1000;

/**
 * Collecte en continu les passages des rames (TRAM_COLLECTE=true), même sans personne sur la
 * carte : c'est l'historique qui fournit les durées réelles des tronçons et la fiabilité des
 * prévisions. Tourne dans l'API tant qu'il n'y a pas de worker (docs/ARCHITECTURE.md §8.2).
 */
@Injectable()
export class CollecteTramService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(CollecteTramService.name);
  private readonly detecteur = new DetecteurPassages();
  private minuterie?: NodeJS.Timeout;
  private enCours = false;
  private enregistres = 0;
  private dernierBilan = Date.now();

  constructor(
    private readonly config: ConfigService,
    private readonly tram: TramService,
    private readonly historique: HistoriqueTramService,
  ) {}

  get active(): boolean {
    return this.minuterie !== undefined;
  }

  onApplicationBootstrap() {
    if (this.config.get<string>('TRAM_COLLECTE') !== 'true') return;
    this.logger.log(`Collecte des passages tram toutes les ${PERIODE_MS / 1000} s`);
    this.minuterie = setInterval(() => void this.collecter(), PERIODE_MS);
    void this.collecter();
  }

  onApplicationShutdown() {
    clearInterval(this.minuterie);
    this.minuterie = undefined;
  }

  private async collecter() {
    if (this.enCours) return;
    this.enCours = true;
    try {
      const [reseau, flux] = await Promise.all([this.tram.lireReseauInterne(), this.tram.lireFlux()]);
      this.enregistres += await this.historique.enregistrer(this.detecteur.observer(reseau, flux));
      if (Date.now() - this.dernierBilan >= BILAN_MS) {
        this.logger.log(`${this.enregistres} passage(s) enregistré(s) en ${BILAN_MS / 60_000} min`);
        this.enregistres = 0;
        this.dernierBilan = Date.now();
      }
    } catch (erreur) {
      this.logger.warn(`Collecte tram : ${(erreur as Error).message}`);
    } finally {
      this.enCours = false;
    }
  }
}
