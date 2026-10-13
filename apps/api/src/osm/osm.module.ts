import { Module } from '@nestjs/common';
import { OsmController } from './osm.controller.js';
import { OsmService } from './osm.service.js';

@Module({
  controllers: [OsmController],
  providers: [OsmService],
})
export class OsmModule {}
