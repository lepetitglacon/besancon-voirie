import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import 'maplibre-gl/dist/maplibre-gl.css'
import { MapProvider } from 'react-map-gl/maplibre'
import './index.css'
import App from './App.tsx'
import { Fournisseur } from './ds'

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false } },
})

/** Vitrine du design system, en développement seulement : http://localhost:5173/vitrine */
const Vitrine = import.meta.env.DEV ? lazy(() => import('./vitrine/Vitrine')) : null

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Fournisseur>
      {Vitrine && window.location.pathname === '/vitrine' ? (
        <Suspense>
          <Vitrine />
        </Suspense>
      ) : (
        <QueryClientProvider client={queryClient}>
          <MapProvider>
            <App />
          </MapProvider>
        </QueryClientProvider>
      )}
    </Fournisseur>
  </StrictMode>,
)
