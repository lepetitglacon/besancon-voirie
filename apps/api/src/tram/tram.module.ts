import { Module } from '@nestjs/common';
import { GinkoClient } from './ginko.client.js';
import { TramController } from './tram.controller.js';
import { TramService } from './tram.service.js';

@Module({
  controllers: [TramController],
  providers: [GinkoClient, TramService],
})
export class TramModule {}
