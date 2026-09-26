import { Controller, Get } from '@nestjs/common';
import { TramService } from './tram.service.js';

@Controller('tram')
export class TramController {
  constructor(private readonly tram: TramService) {}

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
}
