import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

/** Applique les migrations sur la base de test avant la suite e2e. */
export default async function setup() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL_TEST });
  try {
    await migrate(drizzle({ client: pool }), { migrationsFolder: './drizzle' });
  } finally {
    await pool.end();
  }
}
