import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, type Db } from '../db/db.module.js';

@Controller('health')
export class HealthController {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  @Get()
  async health() {
    try {
      const { rows } = await this.db.execute<{ postgis: string; pgrouting: string }>(
        sql`SELECT postgis_lib_version() AS postgis, pgr_version() AS pgrouting`,
      );
      return { status: 'ok', db: rows[0] };
    } catch {
      throw new ServiceUnavailableException({ status: 'erreur', message: 'Base de données injoignable' });
    }
  }
}
