import { Controller, Get, Query } from '@nestjs/common';
import {
  HistoriqueTronconsQuery,
  type EtatHistoriqueTram,
  type HistoriqueTroncons,
} from '@voirie/schema';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { CollecteTramService } from './collecte.service.js';
import { creneauParis, HistoriqueTramService } from './historique.service.js';
import { TramService } from './tram.service.js';

@Controller('tram')
export class TramController {
  constructor(
    private readonly tram: TramService,
    private readonly historique: HistoriqueTramService,
    private readonly collecte: CollecteTramService,
  ) {}

  /** GET /api/tram/reseau : tracés et arrêts des lignes de tram (GTFS Ginko). */
  @Get('reseau')
  reseau() {
    return this.tram.lireReseau();
  }

  /** GET /api/tram/temps-reel : dernier tronçon connu et arrivée prévue de chaque rame. */
  @Get('temps-reel')
  tempsReel() {
    return this.tram.lireTempsReel();
  }

  /** GET /api/tram/historique/troncons?typeJour=semaine&heure=8&jours=28 : durées observées. */
  @Get('historique/troncons')
  async troncons(
    @Query(new ZodValidationPipe(HistoriqueTronconsQuery)) query: HistoriqueTronconsQuery,
  ): Promise<HistoriqueTroncons> {
    const typeJour = query.typeJour ?? creneauParis(Date.now()).typeJour;
    const heure = query.heure ?? null;
    return {
      typeJour,
      heure,
      jours: query.jours,
      troncons: await this.historique.troncons(typeJour, heure, query.jours),
    };
  }

  /** GET /api/tram/historique/etat : volume de l'historique et état de la collecte. */
  @Get('historique/etat')
  async etat(): Promise<EtatHistoriqueTram> {
    return { collecteActive: this.collecte.active('tram'), ...(await this.historique.volume('tram')) };
  }
}

@Controller('bus')
export class BusController {
  constructor(
    private readonly tram: TramService,
    private readonly historique: HistoriqueTramService,
    private readonly collecte: CollecteTramService,
  ) {}

  /** GET /api/bus/reseau : tracés et arrêts des lignes de bus, un parcours par tracé (GTFS Ginko). */
  @Get('reseau')
  reseau() {
    return this.tram.lireReseauBus();
  }

  /** GET /api/bus/temps-reel : dernier tronçon connu et arrivée prévue de chaque bus. */
  @Get('temps-reel')
  tempsReel() {
    return this.tram.lireBusTempsReel();
  }

  /** GET /api/bus/historique/etat : volume de l'historique des bus et état de la collecte. */
  @Get('historique/etat')
  async etat(): Promise<EtatHistoriqueTram> {
    return { collecteActive: this.collecte.active('bus'), ...(await this.historique.volume('bus')) };
  }
}
