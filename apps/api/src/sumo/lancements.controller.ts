import { Body, Controller, Delete, Get, Param, Post, Sse, type MessageEvent } from '@nestjs/common';
import { ETAPES_ACTIVES, LancerEssaiSumo, type LancementSumo, type OptionsSumo } from '@voirie/schema';
import { defer, interval, map, switchMap, takeWhile, startWith, type Observable } from 'rxjs';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { LancementsSumoService } from './lancements.service.js';

/** Fréquence du flux d'avancement : SUMO écrit summary.xml à chaque seconde simulée. */
const PERIODE_FLUX_MS = 1000;

@Controller('sumo')
export class LancementsSumoController {
  constructor(private readonly lancements: LancementsSumoService) {}

  /** GET /api/sumo/options : toutes les options de SUMO, par catégorie, pour le formulaire de lancement. */
  @Get('options')
  options(): Promise<OptionsSumo> {
    return this.lancements.options();
  }

  /** GET /api/sumo/lancements : lancements, du plus récent au plus ancien. */
  @Get('lancements')
  liste(): Promise<LancementSumo[]> {
    return this.lancements.liste();
  }

  /** POST /api/sumo/lancements : lance un essai (un seul à la fois, 409 sinon). */
  @Post('lancements')
  lancer(@Body(new ZodValidationPipe(LancerEssaiSumo)) demande: LancerEssaiSumo): Promise<LancementSumo> {
    return this.lancements.lancer(demande);
  }

  @Get('lancements/:id')
  lancement(@Param('id') id: string): Promise<LancementSumo> {
    return this.lancements.lire(id);
  }

  /**
   * GET /api/sumo/lancements/:id/flux (SSE) : l'avancement chaque seconde, jusqu'à la fin
   * (fini, erreur ou annulé), dernier état compris.
   */
  @Sse('lancements/:id/flux')
  flux(@Param('id') id: string): Observable<MessageEvent> {
    return interval(PERIODE_FLUX_MS).pipe(
      startWith(0),
      switchMap(() => defer(() => this.lancements.lire(id))),
      takeWhile((lancement) => ETAPES_ACTIVES.includes(lancement.etape), true),
      map((lancement) => ({ data: lancement })),
    );
  }

  /** DELETE /api/sumo/lancements/:id : arrête le lancement en cours. */
  @Delete('lancements/:id')
  annuler(@Param('id') id: string): Promise<LancementSumo> {
    return this.lancements.annuler(id);
  }
}
