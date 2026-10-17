import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { AjoutTops, BboxQuery, type Bbox } from '@voirie/schema';
import { EditionGuard } from '../common/edition.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { TempsReelService } from './temps-reel.service.js';

@Controller()
export class TempsReelController {
  constructor(private readonly tempsReel: TempsReelService) {}

  /** GET /api/temps-reel/feux?bbox=… : de quoi rejouer les feux des carrefours programmés. */
  @Get('temps-reel/feux')
  feux(@Query('bbox', new ZodValidationPipe(BboxQuery)) bbox: Bbox) {
    return this.tempsReel.feux(bbox);
  }

  /** GET /api/temps-reel/carrefours/:id : la même chose pour un carrefour, même sans plan (relevé terrain). */
  @Get('temps-reel/carrefours/:id')
  carrefour(@Param('id', ParseUUIDPipe) id: string) {
    return this.tempsReel.carrefour(id);
  }

  @Get('carrefours/:id/tops')
  tops(@Param('id', ParseUUIDPipe) id: string) {
    return this.tempsReel.tops(id);
  }

  /** POST /api/carrefours/:id/tops { ligne, instants } : débuts de vert relevés sur place. */
  @Post('carrefours/:id/tops')
  @UseGuards(EditionGuard)
  ajouter(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(AjoutTops)) ajout: AjoutTops) {
    return this.tempsReel.ajouterTops(id, ajout);
  }

  @Delete('carrefours/:id/tops/:top')
  @UseGuards(EditionGuard)
  supprimer(@Param('id', ParseUUIDPipe) id: string, @Param('top', ParseUUIDPipe) top: string) {
    return this.tempsReel.supprimerTop(id, top);
  }
}
