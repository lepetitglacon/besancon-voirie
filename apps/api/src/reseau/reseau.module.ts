import { Module } from '@nestjs/common';
import { RaccordementsController, ReseauController } from './reseau.controller.js';
import { ReseauService } from './reseau.service.js';

/** Réseau routier hors carrefours, raccordements aux carrefours et export SUMO — docs/RESEAU.md. */
@Module({
  controllers: [ReseauController, RaccordementsController],
  providers: [ReseauService],
})
export class ReseauModule {}
