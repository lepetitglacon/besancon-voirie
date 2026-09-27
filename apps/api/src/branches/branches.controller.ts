import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, UseGuards } from '@nestjs/common';
import { ConfigurationBranches } from '@voirie/schema';
import { EditionGuard } from '../common/edition.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { BranchesService } from './branches.service.js';
import { FileIaService } from './ia/file-ia.service.js';

@Controller('carrefours/:id/branches')
export class BranchesController {
  constructor(
    private readonly branches: BranchesService,
    private readonly fileIa: FileIaService,
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
   * Met le carrefour dans la file des propositions « OSM + IA » (Claude Code sur le serveur,
   * ~1 min et payant par analyse) : réservé à l'édition. Suivi et résultat : /api/analyses-ia.
   */
  @Post('detection-ia')
  @HttpCode(202)
  @UseGuards(EditionGuard)
  demanderDetectionIa(@Param('id', ParseUUIDPipe) id: string) {
    return this.fileIa.demander(id);
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
