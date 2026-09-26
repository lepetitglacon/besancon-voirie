import { sql, type SQL } from 'drizzle-orm';
import type { Db } from './db.module.js';

/** Transaction Drizzle : mêmes méthodes que `Db`. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type Executeur = Db | Tx;

/** Tableau d'uuid déjà validés (zod), passé comme un seul paramètre `uuid[]`. */
export function uuids(ids: readonly string[]): SQL {
  return sql`${`{${ids.join(',')}}`}::uuid[]`;
}

/** Les tables osm_* n'existent qu'après un premier `pnpm osm:import`. */
export async function tableExiste(db: Executeur, table: string): Promise<boolean> {
  const { rows } = await db.execute<{ existe: boolean }>(sql`SELECT to_regclass(${table}) IS NOT NULL AS existe`);
  return rows[0]?.existe ?? false;
}
