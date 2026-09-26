import { useQuery } from '@tanstack/react-query'
import type { Bbox, TypeJour } from '@voirie/schema'
import { useState, type ReactNode } from 'react'
import { api } from './api'
import { CarteCarrefours } from './map/CarteCarrefours'
import { CouchePertes } from './map/CouchePertes'
import { CoucheTrams, type CouchesTram } from './map/CoucheTrams'
import type { OptionsFond } from './map/FondDeCarte'
import { usePreference } from './preferences'
import { PALIERS_PERTE } from './tram/pertes'

/** Le flux Ginko est mis en cache 10 s par l'API. */
const RAFRAICHISSEMENT_TRAMS_MS = 15_000

/** « Carte » : la vue grand public. « Données brutes » : toutes les couches, une par une. */
type Mode = 'carte' | 'brut'

interface CouchesBrutes extends CouchesTram {
  carrefours: boolean
  /** Temps perdu par tronçon, tiré de l'historique des passages. */
  pertes: boolean
}

const FOND_DEFAUT: OptionsFond = { fond: 'satellite', relief3d: false, batiments: false }
const COUCHES_BRUTES_DEFAUT: CouchesBrutes = {
  carrefours: true,
  lignes: true,
  arrets: true,
  zones: true,
  rames: true,
  pertes: true,
}

/** Type de jour de la date donnée (heure locale du navigateur). */
function typeJour(date: Date): TypeJour {
  const jour = date.getDay()
  return jour === 6 ? 'samedi' : jour === 0 ? 'dimanche' : 'semaine'
}

function Case({ coche, onChange, children }: { coche: boolean; onChange: (coche: boolean) => void; children: ReactNode }) {
  return (
    <label className="bascule">
      <input type="checkbox" checked={coche} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
  )
}

function App() {
  const [bbox, setBbox] = useState<Bbox>()
  const [mode, setMode] = usePreference<Mode>('mode', 'carte')
  const [fond, setFond] = usePreference<OptionsFond>('fond', FOND_DEFAUT)
  const [trams, setTrams] = usePreference<boolean>('trams', true)
  const [brut, setBrut] = usePreference<CouchesBrutes>('couches-brutes', COUCHES_BRUTES_DEFAUT)
  const [creneau, setCreneau] = useState<{ typeJour: TypeJour; heure: number | null }>(() => ({
    typeJour: typeJour(new Date()),
    heure: new Date().getHours(),
  }))

  const couchesTram: CouchesTram =
    mode === 'carte' ? { lignes: trams, arrets: trams, zones: trams, rames: trams } : brut
  const tramAffiche = Object.values(couchesTram).some(Boolean)
  const pertes = mode === 'brut' && brut.pertes

  const sante = useQuery({ queryKey: ['sante'], queryFn: api.sante, retry: false })
  const carrefours = useQuery({
    queryKey: ['carrefours', bbox],
    queryFn: () => api.carrefours(bbox!),
    enabled: bbox !== undefined,
    placeholderData: (precedent) => precedent,
  })
  const reseauTram = useQuery({
    queryKey: ['tram', 'reseau'],
    queryFn: api.reseauTram,
    enabled: tramAffiche || pertes,
    staleTime: Infinity,
  })
  const tramsTempsReel = useQuery({
    queryKey: ['tram', 'temps-reel'],
    queryFn: api.tramsTempsReel,
    enabled: (couchesTram.rames || couchesTram.zones) && reseauTram.isSuccess,
    refetchInterval: RAFRAICHISSEMENT_TRAMS_MS,
    placeholderData: (precedent) => precedent,
  })
  const historique = useQuery({
    queryKey: ['tram', 'historique', creneau],
    queryFn: () => api.historiqueTroncons(creneau.typeJour, creneau.heure),
    enabled: pertes,
    placeholderData: (precedent) => precedent,
  })
  const etatHistorique = useQuery({
    queryKey: ['tram', 'historique', 'etat'],
    queryFn: api.historiqueEtat,
    enabled: mode === 'brut',
    refetchInterval: 60_000,
  })

  const basculer = (couche: keyof CouchesBrutes) => (coche: boolean) =>
    setBrut((couches) => ({ ...couches, [couche]: coche }))
  const enLigne = tramsTempsReel.data?.trams.filter((t) => t.etat === 'en_ligne').length

  return (
    <>
      <CarteCarrefours
        carrefours={carrefours.data}
        afficherCarrefours={mode === 'carte' || brut.carrefours}
        fond={fond}
        onEmprise={setBbox}
      >
        {pertes && reseauTram.data && historique.data && (
          <CouchePertes reseau={reseauTram.data} historique={historique.data} />
        )}
        {tramAffiche && reseauTram.data && (
          <CoucheTrams reseau={reseauTram.data} tempsReel={tramsTempsReel.data} couches={couchesTram} />
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

        <div className="onglets" role="tablist">
          <button role="tab" aria-selected={mode === 'carte'} onClick={() => setMode('carte')}>
            Carte
          </button>
          <button role="tab" aria-selected={mode === 'brut'} onClick={() => setMode('brut')}>
            Données brutes
          </button>
        </div>

        {mode === 'carte' ? (
          <>
            {carrefours.data && <p>{carrefours.data.features.length} carrefour(s) dans la vue</p>}
            <Case coche={trams} onChange={setTrams}>
              Trams en temps réel
            </Case>
            {trams && enLigne !== undefined && (
              <p>{enLigne} rame(s) en ligne · position estimée d'après les temps d'attente Ginko</p>
            )}
          </>
        ) : (
          <>
            <Case coche={brut.carrefours} onChange={basculer('carrefours')}>
              Carrefours à feux{carrefours.data && ` (${carrefours.data.features.length} dans la vue)`}
            </Case>
            <Case coche={brut.lignes} onChange={basculer('lignes')}>
              Tram : lignes (GTFS)
            </Case>
            <Case coche={brut.arrets} onChange={basculer('arrets')}>
              Tram : arrêts
            </Case>
            <Case coche={brut.rames} onChange={basculer('rames')}>
              Tram : rames, position estimée{enLigne !== undefined && ` (${enLigne} en ligne)`}
            </Case>
            <Case coche={brut.zones} onChange={basculer('zones')}>
              Tram : zones probables
            </Case>
            <Case coche={brut.pertes} onChange={basculer('pertes')}>
              Tram : temps perdu par tronçon
            </Case>
            {brut.pertes && (
              <>
                <div className="creneau">
                  <select
                    aria-label="Type de jour"
                    value={creneau.typeJour}
                    onChange={(e) => setCreneau((c) => ({ ...c, typeJour: e.target.value as TypeJour }))}
                  >
                    <option value="semaine">Semaine</option>
                    <option value="samedi">Samedi</option>
                    <option value="dimanche">Dimanche</option>
                  </select>
                  <select
                    aria-label="Heure"
                    value={creneau.heure ?? ''}
                    onChange={(e) =>
                      setCreneau((c) => ({ ...c, heure: e.target.value === '' ? null : Number(e.target.value) }))
                    }
                  >
                    <option value="">Toute la journée</option>
                    {Array.from({ length: 24 }, (_, h) => (
                      <option key={h} value={h}>
                        {h} h – {h + 1} h
                      </option>
                    ))}
                  </select>
                </div>
                <ul className="legende">
                  {PALIERS_PERTE.map((palier) => (
                    <li key={palier.libelle}>
                      <span className="pastille" style={{ background: palier.couleur }} />
                      {palier.libelle}
                    </li>
                  ))}
                </ul>
                <p>
                  Durée habituelle moins durée quand ça roule bien.
                  {historique.data && ` ${historique.data.troncons.length} tronçon(s) observé(s).`}
                </p>
              </>
            )}
            {etatHistorique.data && (
              <p>
                Historique : {etatHistorique.data.passages.toLocaleString('fr-FR')} passage(s)
                {etatHistorique.data.premier &&
                  ` depuis le ${new Date(etatHistorique.data.premier).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}`}
                {!etatHistorique.data.collecteActive && ' · collecte arrêtée (TRAM_COLLECTE)'}
              </p>
            )}
          </>
        )}

        {(reseauTram.isError || tramsTempsReel.isError) && (
          <p className="etat-erreur">
            Trams indisponibles : {(reseauTram.error ?? tramsTempsReel.error)?.message}
          </p>
        )}

        <fieldset className="fond">
          <legend>Fond de carte</legend>
          <div className="choix-fond">
            <label>
              <input
                type="radio"
                name="fond"
                checked={fond.fond === 'satellite'}
                onChange={() => setFond((options) => ({ ...options, fond: 'satellite' }))}
              />
              Satellite
            </label>
            <label>
              <input
                type="radio"
                name="fond"
                checked={fond.fond === 'plan'}
                onChange={() => setFond((options) => ({ ...options, fond: 'plan' }))}
              />
              Plan
            </label>
          </div>
          <Case coche={fond.batiments} onChange={(batiments) => setFond((options) => ({ ...options, batiments }))}>
            Bâtiments
          </Case>
          <Case coche={fond.relief3d} onChange={(relief3d) => setFond((options) => ({ ...options, relief3d }))}>
            3D (plus gourmand)
          </Case>
        </fieldset>

        <p className="avertissement">
          Outil citoyen indépendant, sans lien avec la Ville ou la Métropole. Données indicatives.
        </p>
      </aside>
    </>
  )
}

export default App
