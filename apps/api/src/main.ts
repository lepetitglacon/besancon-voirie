import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // Derrière nginx (Docker) ou le proxy Vite : IP réelle pour le throttler, cookies Secure.
  app.set('trust proxy', 'loopback, uniquelocal');
  app.use(cookieParser());
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
  await app.listen(app.get(ConfigService).get<number>('API_PORT', 3000));
}
await bootstrap();
