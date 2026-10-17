import { Controller, Get, Param } from '@nestjs/common';
import { FicheService } from './fiche.service.js';

/**
 * GET /api/carrefours/:slug : la fiche d'un carrefour. Le module est importé après CarrefoursModule :
 * GET /api/carrefours/suggestion-nom, déclaré avant, reste prioritaire.
 */
@Controller('carrefours')
export class FicheController {
  constructor(private readonly fiche: FicheService) {}

  @Get(':slug')
  lire(@Param('slug') slug: string) {
    return this.fiche.lire(slug);
  }
}
