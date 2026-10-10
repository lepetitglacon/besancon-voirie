import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { MaturiteService } from './maturite.service.js';

/** Où en est chaque carrefour, niveau par niveau (docs/pipeline-donnees.md, étape 5). */
@Controller('carrefours')
export class MaturiteController {
  constructor(private readonly maturite: MaturiteService) {}

  /** GET /api/carrefours/maturite : tous les carrefours, du moins avancé au plus avancé. */
  @Get('maturite')
  tous() {
    return this.maturite.tous();
  }

  /** GET /api/carrefours/:id/maturite : constats d'un carrefour. */
  @Get(':id/maturite')
  un(@Param('id', ParseUUIDPipe) id: string) {
    return this.maturite.un(id);
  }
}
