import { createReadStream } from 'node:fs';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ModificationProfil, NouveauProfil } from '@voirie/schema';
import type { z } from 'zod';
import { EditionGuard } from '../common/edition.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ProfilsService, type ImageRecue } from './profils.service.js';

/** PNG d'un profil : quelques centaines de Ko à l'échelle 2 ; au-delà, refusé. */
const TAILLE_IMAGE_MAX = 8 * 1024 * 1024;
const televersement = () => FileInterceptor('image', { limits: { fileSize: TAILLE_IMAGE_MAX, files: 1 } });

/** Champ `profil` d'un envoi multipart : du JSON, validé par le schéma zod. */
function lireChampProfil<T extends z.ZodType>(schema: T, brut: unknown): z.output<T> {
  if (typeof brut !== 'string') throw new BadRequestException('Champ « profil » manquant');
  let valeur: unknown;
  try {
    valeur = JSON.parse(brut);
  } catch {
    throw new BadRequestException('Champ « profil » : JSON invalide');
  }
  return new ZodValidationPipe(schema).transform(valeur);
}

/** Profils en travers théoriques (Streetmix) des tronçons — docs/integration-streetmix.md. */
@Controller('profils')
export class ProfilsController {
  constructor(private readonly profils: ProfilsService) {}

  /** GET /api/profils/troncon/:id : profil théorique du tronçon, profil estimé, voisins de la même rue. */
  @Get('troncon/:id')
  pourTroncon(@Param('id', ParseUUIDPipe) id: string) {
    return this.profils.pourTroncon(id);
  }

  @Get(':id')
  lire(@Param('id', ParseUUIDPipe) id: string) {
    return this.profils.lire(id);
  }

  /** GET /api/profils/:id/image?v=… : PNG du profil ; l'URL change à chaque nouvelle image. */
  @Get(':id/image')
  @Header('Content-Type', 'image/png')
  @Header('Cache-Control', 'public, max-age=31536000, immutable')
  async image(@Param('id', ParseUUIDPipe) id: string): Promise<StreamableFile> {
    return new StreamableFile(createReadStream(await this.profils.image(id)));
  }

  /** POST /api/profils (multipart : `profil` en JSON, `image` en PNG) : profil créé, tronçons rattachés. */
  @Post()
  @UseGuards(EditionGuard)
  @UseInterceptors(televersement())
  creer(@Body('profil') profil: unknown, @UploadedFile() image: ImageRecue | undefined) {
    return this.profils.creer(lireChampProfil(NouveauProfil, profil), image);
  }

  /** PUT /api/profils/:id (multipart) : nouvelle rue et nouvelle image ; d'autres tronçons peuvent s'y rattacher. */
  @Put(':id')
  @UseGuards(EditionGuard)
  @UseInterceptors(televersement())
  modifier(@Param('id', ParseUUIDPipe) id: string, @Body('profil') profil: unknown, @UploadedFile() image: ImageRecue | undefined) {
    return this.profils.modifier(id, lireChampProfil(ModificationProfil, profil), image);
  }

  /** DELETE /api/profils/:id/troncons/:troncon : le tronçon ne suit plus ce profil. */
  @Delete(':id/troncons/:troncon')
  @UseGuards(EditionGuard)
  @HttpCode(204)
  detacher(@Param('id', ParseUUIDPipe) id: string, @Param('troncon', ParseUUIDPipe) troncon: string) {
    return this.profils.detacher(id, troncon);
  }
}
