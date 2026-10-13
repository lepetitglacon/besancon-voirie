import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

try {
  process.loadEnvFile('../../.env');
} catch {
  // Variables déjà présentes dans l'environnement (CI).
}

const databaseUrlTest = process.env.DATABASE_URL_TEST;
if (!databaseUrlTest) throw new Error('DATABASE_URL_TEST manquant (voir .env.example)');

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    globalSetup: ['./test/global-setup.ts'],
    // Prioritaire sur le .env chargé par ConfigModule : l'API testée pointe sur la base de test,
    // édition autorisée, sans collecte tram (elle interrogerait Ginko en continu) ni analyse IA
    // (la file reste en attente : pas de Claude ni d'orthophoto pendant les tests), ni voies OSM
    // chargées à la demande (les jeux de test les fournissent).
    env: { DATABASE_URL: databaseUrlTest, EDITION_LOCALE: 'true', TRAM_COLLECTE: 'false', IA_PARALLELE: '0', OSM_VOIES_A_LA_DEMANDE: 'false' },
    fileParallelism: false,
  },
});
