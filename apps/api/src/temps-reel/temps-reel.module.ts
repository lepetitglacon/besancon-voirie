import { Module } from '@nestjs/common';
import { TempsReelController } from './temps-reel.controller.js';
import { TempsReelService } from './temps-reel.service.js';

@Module({
  controllers: [TempsReelController],
  providers: [TempsReelService],
})
export class TempsReelModule {}
