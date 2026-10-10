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
  CoupeTroncon,
  FichierSumo,
  FusionNoeuds,
  ModificationNoeud,
  ModificationPassage,
  ModificationTroncon,
  NouveauPassage,
  NouveauTroncon,
  SaisieLiaisons,
  SemisReseau,
  VarianteSumo,
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

  /**
   * POST /api/reseau/semer { reinitialiser? } : sème le réseau depuis OSM, une seule fois (409
   * ensuite) ; `reinitialiser` efface tout le réseau avant, corrections comprises.
   */
  @Post('semer')
  @UseGuards(EditionGuard)
  @HttpCode(200)
  semer(@Body(new ZodValidationPipe(SemisReseau)) { reinitialiser }: SemisReseau) {
    return this.reseau.semer(reinitialiser);
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

  /** POST /api/reseau/troncons/:id/couper { position, feux?, pieton? } : nouveau nœud au point le plus proche. */
  @Post('troncons/:id/couper')
  @UseGuards(EditionGuard)
  couper(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(CoupeTroncon)) coupe: CoupeTroncon) {
    return this.reseau.couper(id, coupe);
  }

  /** POST /api/reseau/noeuds/fusion { noeuds | carrefour, coeur?, position? } : réunit des nœuds en un seul. */
  @Post('noeuds/fusion')
  @UseGuards(EditionGuard)
  fusionnerNoeuds(@Body(new ZodValidationPipe(FusionNoeuds)) fusion: FusionNoeuds) {
    return this.reseau.fusionnerNoeuds(fusion);
  }

  /** PATCH /api/reseau/noeuds/:id : position, ligne d'arrêt à feux, passage piéton, carrefour. */
  @Patch('noeuds/:id')
  @UseGuards(EditionGuard)
  modifierNoeud(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(ModificationNoeud)) modification: ModificationNoeud) {
    return this.reseau.modifierNoeud(id, modification);
  }

  /** DELETE /api/reseau/noeuds/:id : retire un nœud entre deux tronçons de mêmes voies (ils fusionnent). */
  @Delete('noeuds/:id')
  @UseGuards(EditionGuard)
  @HttpCode(204)
  fusionner(@Param('id', ParseUUIDPipe) id: string) {
    return this.reseau.fusionner(id);
  }

  /** PUT /api/reseau/noeuds/:id/liaisons { liaisons: [...] | null } : liaisons voie à voie d'un nœud. */
  @Put('noeuds/:id/liaisons')
  @UseGuards(EditionGuard)
  enregistrerLiaisons(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(SaisieLiaisons)) saisie: SaisieLiaisons) {
    return this.reseau.enregistrerLiaisons(id, saisie);
  }

  /** POST /api/reseau/passages { points, type, troncons?, feux } : passage piéton tracé librement. */
  @Post('passages')
  @UseGuards(EditionGuard)
  creerPassage(@Body(new ZodValidationPipe(NouveauPassage)) passage: NouveauPassage) {
    return this.reseau.creerPassage(passage);
  }

  @Patch('passages/:id')
  @UseGuards(EditionGuard)
  modifierPassage(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(ModificationPassage)) modification: ModificationPassage) {
    return this.reseau.modifierPassage(id, modification);
  }

  @Delete('passages/:id')
  @UseGuards(EditionGuard)
  @HttpCode(204)
  supprimerPassage(@Param('id', ParseUUIDPipe) id: string) {
    return this.reseau.supprimerPassage(id);
  }

  /**
   * GET /api/reseau/sumo/reseau.nod.xml (edg, con, netccfg) [?bbox=…][&variante=theorique] : export
   * SUMO plain XML ; `theorique` prend les voies des profils Streetmix (docs/integration-streetmix.md).
   */
  @Get('sumo/:fichier')
  @Header('Content-Type', 'application/xml; charset=utf-8')
  exporter(
    @Param('fichier', new ZodValidationPipe(FichierSumo)) fichier: FichierSumo,
    @Query('bbox', new ZodValidationPipe(BboxQuery.optional())) bbox: Bbox | undefined,
    @Query('variante', new ZodValidationPipe(VarianteSumo.default('reel'))) variante: VarianteSumo,
  ) {
    return this.reseau.exporter(fichier, bbox, variante);
  }
}
