import { useQuery } from '@tanstack/react-query'
import type { Bbox } from '@voirie/schema'
import { useState } from 'react'
import { api } from './api'
import { CarteCarrefours } from './map/CarteCarrefours'
import { CoucheTrams } from './map/CoucheTrams'

/** Le flux Ginko est mis en cache 10 s par l'API. */
const RAFRAICHISSEMENT_TRAMS_MS = 15_000

function App() {
  const [bbox, setBbox] = useState<Bbox>()
  const sante = useQuery({ queryKey: ['sante'], queryFn: api.sante, retry: false })
  const carrefours = useQuery({
    queryKey: ['carrefours', bbox],
    queryFn: () => api.carrefours(bbox!),
    enabled: bbox !== undefined,
    placeholderData: (precedent) => precedent,
  })
  const [trams, setTrams] = useState(true)
  const reseauTram = useQuery({
    queryKey: ['tram', 'reseau'],
    queryFn: api.reseauTram,
    enabled: trams,
    staleTime: Infinity,
  })
  const tramsTempsReel = useQuery({
    queryKey: ['tram', 'temps-reel'],
    queryFn: api.tramsTempsReel,
    enabled: trams && reseauTram.isSuccess,
    refetchInterval: RAFRAICHISSEMENT_TRAMS_MS,
    placeholderData: (precedent) => precedent,
  })

  return (
    <>
      <CarteCarrefours carrefours={carrefours.data} onEmprise={setBbox}>
        {trams && reseauTram.data && (
          <CoucheTrams reseau={reseauTram.data} tempsReel={tramsTempsReel.data} />
        )}
      </CarteCarrefours>
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
        <label className="bascule">
          <input type="checkbox" checked={trams} onChange={(e) => setTrams(e.target.checked)} />
          Trams en temps réel
        </label>
        {trams && tramsTempsReel.data && (
          <p>
            {tramsTempsReel.data.trams.filter((t) => t.etat === 'en_ligne').length} rame(s) en ligne ·
            position estimée d'après les temps d'attente Ginko
          </p>
        )}
        {trams && (reseauTram.isError || tramsTempsReel.isError) && (
          <p className="etat-erreur">
            Trams indisponibles : {(reseauTram.error ?? tramsTempsReel.error)?.message}
          </p>
        )}
        <p className="avertissement">
          Outil citoyen indépendant, sans lien avec la Ville ou la Métropole. Données indicatives.
        </p>
      </aside>
    </>
  )
}

export default App
