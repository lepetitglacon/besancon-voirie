import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import 'maplibre-gl/dist/maplibre-gl.css'
import { MapProvider } from 'react-map-gl/maplibre'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import './index.css'
import { ErreurApi } from './api'
import App from './App.tsx'
import { CLE_SESSION } from './auth/session'
import { Fournisseur } from './ds'
import { PAGES } from './site/pages'
import { ReleveTerrain } from './terrain/ReleveTerrain'
import { Vitrine } from './vitrine'

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false } },
  // Session expirée ou révoquée pendant une saisie : on relit la session (menu, outils affichés).
  mutationCache: new MutationCache({
    onError: (erreur) => {
      if (erreur instanceof ErreurApi && erreur.statut === 401) void queryClient.invalidateQueries({ queryKey: CLE_SESSION })
    },
  }),
})


createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Fournisseur>
      <BrowserRouter>
        <Routes>
          <Route
            path={PAGES.designSystem.chemin}
            element={
              <Suspense>
                <Vitrine />
              </Suspense>
            }
          />
          <Route path="/vitrine" element={<Navigate to={PAGES.designSystem.chemin} replace />} />
          {/* Relevé devant le feu, sur le téléphone : sans la carte. */}
          <Route
            path="/terrain/:carrefourId"
            element={
              <QueryClientProvider client={queryClient}>
                <ReleveTerrain />
              </QueryClientProvider>
            }
          />
          {/* La carte, avec les pages du site (à propos, mentions…) ouvertes par-dessus. */}
          <Route
            path="*"
            element={
              <QueryClientProvider client={queryClient}>
                <MapProvider>
                  <App />
                </MapProvider>
              </QueryClientProvider>
            }
          />
        </Routes>
      </BrowserRouter>
    </Fournisseur>
  </StrictMode>,
)
