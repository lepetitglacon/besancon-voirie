import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import 'maplibre-gl/dist/maplibre-gl.css'
import { MapProvider } from 'react-map-gl/maplibre'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import './index.css'
import App from './App.tsx'
import { Fournisseur } from './ds'
import { PAGES } from './site/pages'
import { Vitrine } from './vitrine'

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false } },
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
