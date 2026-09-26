import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Ports lus dans le .env à la racine du monorepo. Les variables d'environnement déjà
  // définies (fournies par le Worktree Manager, par exemple) restent prioritaires.
  const env = loadEnv(mode, '../..', '')
  const apiPort = env.API_PORT ?? '3000'

  return {
    plugins: [react()],
    // Optimisées dès le démarrage : évite les ré-optimisations en cours de route, qui laissent
    // le navigateur avec des morceaux périmés (react-map-gl importe maplibre-gl dynamiquement).
    optimizeDeps: { include: ['maplibre-gl', 'react-map-gl/maplibre'] },
    server: {
      port: Number(env.WEB_PORT ?? 5173),
      strictPort: true,
      proxy: {
        '/api': `http://localhost:${apiPort}`,
      },
    },
  }
})
