import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BranchesModule } from './branches/branches.module.js';
import { CarrefoursModule } from './carrefours/carrefours.module.js';
import { DbModule } from './db/db.module.js';
import { FeuxModule } from './feux/feux.module.js';
import { HealthController } from './health/health.controller.js';
import { LignesModule } from './lignes/lignes.module.js';
import { ProgrammeModule } from './programme/programme.module.js';

@Module({
  imports: [
    // Le .env de la racine du monorepo, puis un éventuel .env local à l'API.
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env', '../../.env'] }),
    DbModule,
    CarrefoursModule,
    BranchesModule,
    LignesModule,
    ProgrammeModule,
    FeuxModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
