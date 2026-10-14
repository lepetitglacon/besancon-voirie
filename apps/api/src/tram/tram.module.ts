import { Module } from '@nestjs/common';
import { CollecteTramService } from './collecte.service.js';
import { GinkoClient } from './ginko.client.js';
import { HistoriqueTramService } from './historique.service.js';
import { BusController, TramController } from './tram.controller.js';
import { TramService } from './tram.service.js';

@Module({
  controllers: [TramController, BusController],
  providers: [GinkoClient, TramService, HistoriqueTramService, CollecteTramService],
})
export class TramModule {}
