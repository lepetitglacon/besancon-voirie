import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, UseGuards } from '@nestjs/common';
import { CorrectionReleve, EnvoiReleve, ValidationReleve } from '@voirie/schema';
import { EditionGuard } from '../common/edition.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { RelevesService } from './releves.service.js';

@Controller()
export class RelevesController {
  constructor(private readonly releves: RelevesService) {}

  /** POST /api/releves : relevé terrain, anonyme, enregistré en attente de modération. */
  @Post('releves')
  @HttpCode(202)
  recevoir(@Body(new ZodValidationPipe(EnvoiReleve)) envoi: EnvoiReleve) {
    return this.releves.recevoir(envoi);
  }

  @Get('releves/:id')
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.releves.detail(id);
  }

  /** PUT /api/releves/:id { saisies } : relevé recalé à la seconde ; synthèse refaite. */
  @Put('releves/:id')
  @UseGuards(EditionGuard)
  corriger(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(CorrectionReleve)) { saisies }: CorrectionReleve) {
    return this.releves.corriger(id, saisies);
  }

  /** POST /api/releves/:id/valider { plan? } : le programme relevé remplace le plan ; relevé validé. */
  @Post('releves/:id/valider')
  @HttpCode(200)
  @UseGuards(EditionGuard)
  valider(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(ValidationReleve)) { plan }: ValidationReleve) {
    return this.releves.valider(id, plan);
  }

  @Get('carrefours/:id/releves')
  duCarrefour(@Param('id', ParseUUIDPipe) id: string) {
    return this.releves.duCarrefour(id);
  }
}
