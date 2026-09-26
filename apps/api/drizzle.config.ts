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
  dbCredentials: { url: process.env.DATABASE_URL! },
  // Ignore les tables internes de PostGIS (spatial_ref_sys…) lors des introspections.
  extensionsFilters: ['postgis'],
});
