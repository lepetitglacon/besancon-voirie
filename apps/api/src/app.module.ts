import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CarrefoursModule } from './carrefours/carrefours.module.js';
import { DbModule } from './db/db.module.js';
import { HealthController } from './health/health.controller.js';
import { TramModule } from './tram/tram.module.js';

@Module({
  imports: [
    // Le .env de la racine du monorepo, puis un éventuel .env local à l'API.
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env', '../../.env'] }),
    DbModule,
    CarrefoursModule,
    TramModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
