import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DetecteurPassages } from './collecte.js';
import { HistoriqueTramService, type ModeTransport } from './historique.service.js';
import { TramService } from './tram.service.js';

/** Lecture du flux : assez fréquente pour dater les passages à ~10 s près. */
const PERIODE_MS = 10 * 1000;
const BILAN_MS = 10 * 60 * 1000;

/**
 * Collecte en continu les passages des rames (TRAM_COLLECTE=true) et des bus (BUS_COLLECTE,
 * comme TRAM_COLLECTE s'il est absent), même sans personne sur la carte : c'est l'historique
 * qui fournit les durées réelles des tronçons et la fiabilité des prévisions. Une seule lecture
 * du flux sert aux deux modes. Tourne dans l'API tant qu'il n'y a pas de worker
 * (docs/ARCHITECTURE.md §8.2).
 */
@Injectable()
export class CollecteTramService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(CollecteTramService.name);
  private readonly detecteurs: Record<ModeTransport, DetecteurPassages> = {
    tram: new DetecteurPassages(),
    bus: new DetecteurPassages(),
  };
  private modes: ModeTransport[] = [];
  private minuterie?: NodeJS.Timeout;
  private enCours = false;
  private enregistres: Record<ModeTransport, number> = { tram: 0, bus: 0 };
  private dernierBilan = Date.now();

  constructor(
    private readonly config: ConfigService,
    private readonly tram: TramService,
    private readonly historique: HistoriqueTramService,
  ) {}

  /** Collecte en cours pour ce mode. */
  active(mode: ModeTransport = 'tram'): boolean {
    return this.minuterie !== undefined && this.modes.includes(mode);
  }

  onApplicationBootstrap() {
    const tram = this.config.get<string>('TRAM_COLLECTE') === 'true';
    const bus = (this.config.get<string>('BUS_COLLECTE') ?? String(tram)) === 'true';
    this.modes = [...(tram ? ['tram' as const] : []), ...(bus ? ['bus' as const] : [])];
    if (this.modes.length === 0) return;
    this.logger.log(`Collecte des passages (${this.modes.join(', ')}) toutes les ${PERIODE_MS / 1000} s`);
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
      for (const mode of this.modes) {
        const [reseau, flux] =
          mode === 'tram'
            ? await Promise.all([this.tram.lireReseauInterne(), this.tram.lireFlux()])
            : await Promise.all([this.tram.lireReseauBusInterne(), this.tram.lireFluxBus()]);
        const passages = this.detecteurs[mode].observer(reseau, flux);
        this.enregistres[mode] += await this.historique.enregistrer(passages, mode);
      }
      if (Date.now() - this.dernierBilan >= BILAN_MS) {
        const bilan = this.modes.map((mode) => `${this.enregistres[mode]} ${mode}`).join(', ');
        this.logger.log(`Passages enregistrés en ${BILAN_MS / 60_000} min : ${bilan}`);
        this.enregistres = { tram: 0, bus: 0 };
        this.dernierBilan = Date.now();
      }
    } catch (erreur) {
      this.logger.warn(`Collecte des passages : ${(erreur as Error).message}`);
    } finally {
      this.enCours = false;
    }
  }
}
