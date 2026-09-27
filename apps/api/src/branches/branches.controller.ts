import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, UseGuards } from '@nestjs/common';
import { ConfigurationBranches } from '@voirie/schema';
import { EditionGuard } from '../common/edition.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { BranchesService } from './branches.service.js';
import { IaService } from './ia/ia.service.js';

@Controller('carrefours/:id/branches')
export class BranchesController {
  constructor(
    private readonly branches: BranchesService,
    private readonly ia: IaService,
  ) {}

  @Get()
  lire(@Param('id', ParseUUIDPipe) id: string) {
    return this.branches.lire(id);
  }

  /** Proposition depuis OSM, non enregistrée. */
  @Get('detection')
  detecter(@Param('id', ParseUUIDPipe) id: string) {
    return this.branches.detecter(id);
  }

  /**
   * Proposition OSM corrigée par l'IA d'après l'orthophoto IGN, non enregistrée. Lance Claude
   * Code sur le serveur (1 à 3 min, payant) : réservé à l'édition.
   */
  @Post('detection-ia')
  @UseGuards(EditionGuard)
  detecterAvecIa(@Param('id', ParseUUIDPipe) id: string) {
    return this.ia.detecter(id);
  }

  @Put()
  @UseGuards(EditionGuard)
  enregistrer(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(ConfigurationBranches)) configuration: ConfigurationBranches,
  ) {
    return this.branches.enregistrer(id, configuration);
  }
}
