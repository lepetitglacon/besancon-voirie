import { Body, Controller, Get, Param, ParseUUIDPipe, Put, UseGuards } from '@nestjs/common';
import { ConfigurationBranches } from '@voirie/schema';
import { EditionGuard } from '../common/edition.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { BranchesService } from './branches.service.js';

@Controller('carrefours/:id/branches')
export class BranchesController {
  constructor(private readonly branches: BranchesService) {}

  @Get()
  lire(@Param('id', ParseUUIDPipe) id: string) {
    return this.branches.lire(id);
  }

  /** Proposition depuis OSM, non enregistrée. */
  @Get('detection')
  detecter(@Param('id', ParseUUIDPipe) id: string) {
    return this.branches.detecter(id);
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
