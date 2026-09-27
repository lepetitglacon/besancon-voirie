import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  BboxQuery,
  FichierSumo,
  ModificationTroncon,
  NouveauTroncon,
  SaisieLiaisons,
  type Bbox,
} from '@voirie/schema';
import { EditionGuard } from '../common/edition.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ReseauService } from './reseau.service.js';

@Controller('reseau')
export class ReseauController {
  constructor(private readonly reseau: ReseauService) {}

  /** GET /api/reseau?bbox=minLon,minLat,maxLon,maxLat : tronçons et nœuds de l'emprise. */
  @Get()
  dansEmprise(@Query('bbox', new ZodValidationPipe(BboxQuery)) bbox: Bbox) {
    return this.reseau.dansEmprise(bbox);
  }

  /** POST /api/reseau/generer : (re)crée les tronçons OSM, garde ceux corrigés à la main. */
  @Post('generer')
  @UseGuards(EditionGuard)
  @HttpCode(200)
  generer() {
    return this.reseau.generer();
  }

  @Post('troncons')
  @UseGuards(EditionGuard)
  creer(@Body(new ZodValidationPipe(NouveauTroncon)) nouveau: NouveauTroncon) {
    return this.reseau.creer(nouveau);
  }

  @Patch('troncons/:id')
  @UseGuards(EditionGuard)
  modifier(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(ModificationTroncon)) modification: ModificationTroncon) {
    return this.reseau.modifier(id, modification);
  }

  @Delete('troncons/:id')
  @UseGuards(EditionGuard)
  @HttpCode(204)
  supprimer(@Param('id', ParseUUIDPipe) id: string) {
    return this.reseau.supprimer(id);
  }

  /** PUT /api/reseau/noeuds/:id/liaisons { liaisons: [...] | null } : liaisons voie à voie d'un nœud. */
  @Put('noeuds/:id/liaisons')
  @UseGuards(EditionGuard)
  enregistrerLiaisons(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(SaisieLiaisons)) saisie: SaisieLiaisons) {
    return this.reseau.enregistrerLiaisons(id, saisie);
  }

  /** GET /api/reseau/sumo/reseau.nod.xml (edg, con, netccfg) [?bbox=…] : export SUMO plain XML. */
  @Get('sumo/:fichier')
  @Header('Content-Type', 'application/xml; charset=utf-8')
  exporter(
    @Param('fichier', new ZodValidationPipe(FichierSumo)) fichier: FichierSumo,
    @Query('bbox', new ZodValidationPipe(BboxQuery.optional())) bbox: Bbox | undefined,
  ) {
    return this.reseau.exporter(fichier, bbox);
  }
}
