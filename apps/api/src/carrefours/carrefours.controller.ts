import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { BboxQuery, CreerCarrefour, ModifierCarrefour, NatureCarrefour, type Bbox } from '@voirie/schema';
import { z } from 'zod';
import { EditionGuard } from '../common/edition.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { CarrefoursService } from './carrefours.service.js';

const SuggestionNomQuery = z.object({
  feux: z
    .string()
    .transform((valeur) => valeur.split(','))
    .pipe(z.array(z.uuid()).min(1).max(80)),
  nature: NatureCarrefour.default('carrefour'),
});

@Controller('carrefours')
export class CarrefoursController {
  constructor(private readonly carrefours: CarrefoursService) {}

  /** GET /api/carrefours?bbox=minLon,minLat,maxLon,maxLat */
  @Get()
  dansEmprise(@Query('bbox', new ZodValidationPipe(BboxQuery)) bbox: Bbox) {
    return this.carrefours.dansEmprise(bbox);
  }

  /** GET /api/carrefours/suggestion-nom?feux=<uuid>,<uuid>&nature=carrefour */
  @Get('suggestion-nom')
  async suggestionNom(@Query(new ZodValidationPipe(SuggestionNomQuery)) { feux, nature }: z.infer<typeof SuggestionNomQuery>) {
    return { nom: await this.carrefours.suggererNom(feux, nature) };
  }

  @Post()
  @UseGuards(EditionGuard)
  creer(@Body(new ZodValidationPipe(CreerCarrefour)) creation: CreerCarrefour) {
    return this.carrefours.creer(creation);
  }

  @Patch(':id')
  @UseGuards(EditionGuard)
  modifier(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(ModifierCarrefour)) modification: ModifierCarrefour,
  ) {
    return this.carrefours.modifier(id, modification);
  }

  @Delete(':id')
  @HttpCode(204)
  @UseGuards(EditionGuard)
  supprimer(@Param('id', ParseUUIDPipe) id: string) {
    return this.carrefours.supprimer(id);
  }
}
