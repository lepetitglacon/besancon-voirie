import { defineConfig } from 'drizzle-kit';

try {
  process.loadEnvFile('../../.env');
} catch {
  // Pas de .env : on s'appuie sur les variables d'environnement déjà présentes.
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  // Migrations préfixées par leur horodatage (20260927143000_nom.sql) plutôt que par un
  // numéro : deux branches ne se disputent plus le même numéro. Voir CLAUDE.md, « Migrations ».
  migrations: { prefix: 'timestamp' },
  dbCredentials: { url: process.env.DATABASE_URL! },
  // Ignore les tables internes de PostGIS (spatial_ref_sys…) lors des introspections.
  extensionsFilters: ['postgis'],
});
