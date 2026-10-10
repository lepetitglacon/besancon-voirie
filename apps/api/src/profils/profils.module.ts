import { Module } from '@nestjs/common';
import { ProfilsController } from './profils.controller.js';
import { ProfilsService } from './profils.service.js';

/** Profils en travers théoriques des tronçons, dessinés dans Streetmix — docs/integration-streetmix.md. */
@Module({
  controllers: [ProfilsController],
  providers: [ProfilsService],
})
export class ProfilsModule {}
