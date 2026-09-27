import { Module } from '@nestjs/common';
import { ReseauController } from './reseau.controller.js';
import { ReseauService } from './reseau.service.js';

/** Réseau routier (nœuds, tronçons, liaisons voie à voie) et export SUMO — docs/RESEAU.md. */
@Module({
  controllers: [ReseauController],
  providers: [ReseauService],
})
export class ReseauModule {}
