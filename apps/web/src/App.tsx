import { useQuery } from '@tanstack/react-query'
import type { Bbox } from '@voirie/schema'
import { useState } from 'react'
import { api } from './api'
import { CarteCarrefours } from './map/CarteCarrefours'

function App() {
  const [bbox, setBbox] = useState<Bbox>()
  const sante = useQuery({ queryKey: ['sante'], queryFn: api.sante, retry: false })
  const carrefours = useQuery({
    queryKey: ['carrefours', bbox],
    queryFn: () => api.carrefours(bbox!),
    enabled: bbox !== undefined,
    placeholderData: (precedent) => precedent,
  })

  return (
    <>
      <CarteCarrefours carrefours={carrefours.data} onEmprise={setBbox} />
      <aside className="panneau">
        <h1>Besançon Voirie</h1>
        <p>Inventaire citoyen des feux tricolores.</p>
        {sante.isSuccess && (
          <p className="etat-ok">
            API connectée · PostGIS {sante.data.db.postgis} · pgRouting {sante.data.db.pgrouting}
          </p>
        )}
        {sante.isError && <p className="etat-erreur">API injoignable</p>}
        {carrefours.data && <p>{carrefours.data.features.length} carrefour(s) dans la vue</p>}
        <p className="avertissement">
          Outil citoyen indépendant, sans lien avec la Ville ou la Métropole. Données indicatives.
        </p>
      </aside>
    </>
  )
}

export default App
