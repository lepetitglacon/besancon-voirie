import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Bbox, CarrefourResume, FeuResume } from '@voirie/schema'
import { useState } from 'react'
import { api } from './api'
import { PanneauEdition, type Edition } from './edition/PanneauEdition'
import { CarteCarrefours } from './map/CarteCarrefours'

function App() {
  const queryClient = useQueryClient()
  const [bbox, setBbox] = useState<Bbox>()
  const [edition, setEdition] = useState<Edition | null>(null)

  const sante = useQuery({ queryKey: ['sante'], queryFn: api.sante, retry: false })
  const carrefours = useQuery({
    queryKey: ['carrefours', bbox],
    queryFn: () => api.carrefours(bbox!),
    enabled: bbox !== undefined,
    placeholderData: (precedent) => precedent,
  })
  const feux = useQuery({
    queryKey: ['feux', bbox],
    queryFn: () => api.feux(bbox!),
    enabled: bbox !== undefined,
    placeholderData: (precedent) => precedent,
  })

  const rafraichir = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['carrefours'] }),
      queryClient.invalidateQueries({ queryKey: ['feux'] }),
    ])

  const enregistrer = useMutation({
    mutationFn: ({ edition, nom }: { edition: Edition; nom: string | null }) => {
      const donnees = { nature: edition.nature, feux: edition.selection, ...(nom ? { nom } : {}) }
      return edition.carrefourId
        ? api.modifierCarrefour(edition.carrefourId, donnees)
        : api.creerCarrefour(donnees)
    },
    onSuccess: async () => {
      setEdition(null)
      await rafraichir()
    },
  })

  const supprimer = useMutation({
    mutationFn: (carrefour: CarrefourResume) => api.supprimerCarrefour(carrefour.id),
    onSuccess: rafraichir,
    onError: (erreur) => window.alert(erreur.message),
  })

  const demarrer = (nouvelle: Edition) => {
    enregistrer.reset()
    setEdition(nouvelle)
  }

  const basculerFeu = (feu: FeuResume) => {
    if (!edition) return
    if (feu.carrefour_id && feu.carrefour_id !== edition.carrefourId) return
    const selection = edition.selection.includes(feu.id)
      ? edition.selection.filter((id) => id !== feu.id)
      : [...edition.selection, feu.id]
    setEdition({ ...edition, selection })
  }

  /** Ajoute les feux d'un rectangle : seulement ceux qui sont libres ou déjà à ce carrefour. */
  const ajouterFeux = (couverts: FeuResume[]) => {
    if (!edition) return
    const eligibles = couverts
      .filter((feu) => !feu.carrefour_id || feu.carrefour_id === edition.carrefourId)
      .map((feu) => feu.id)
    setEdition({ ...edition, selection: [...new Set([...edition.selection, ...eligibles])] })
  }

  const modifier = (carrefour: CarrefourResume) =>
    demarrer({
      carrefourId: carrefour.id,
      selection: (feux.data?.features ?? []).filter((f) => f.properties.carrefour_id === carrefour.id).map((f) => f.id),
      nature: carrefour.nature,
      nomSaisi: carrefour.nom,
      modeRectangle: false,
    })

  const feuxLibres = feux.data?.features.filter((f) => f.properties.carrefour_id === null).length

  return (
    <>
      <CarteCarrefours
        carrefours={carrefours.data}
        feux={feux.data}
        edition={
          edition && {
            selection: edition.selection,
            carrefourId: edition.carrefourId,
            modeRectangle: edition.modeRectangle,
          }
        }
        onEmprise={setBbox}
        onBasculerFeu={basculerFeu}
        onAjouterFeux={ajouterFeux}
        onComposerDepuis={(feu) =>
          demarrer({
            carrefourId: null,
            selection: [feu.id],
            nature: feu.type === 'pieton' ? 'traversee_pietonne' : 'carrefour',
            nomSaisi: null,
            modeRectangle: false,
          })
        }
        onModifier={modifier}
        onSupprimer={(carrefour) => {
          if (window.confirm(`Supprimer « ${carrefour.nom} » ? Ses feux redeviendront libres.`)) {
            supprimer.mutate(carrefour)
          }
        }}
      />
      <aside className="panneau">
        <h1>Besançon Voirie</h1>
        <p>Inventaire citoyen des feux tricolores.</p>
        {sante.isSuccess && (
          <p className="etat-ok">
            API connectée · PostGIS {sante.data.db.postgis} · pgRouting {sante.data.db.pgrouting}
          </p>
        )}
        {sante.isError && <p className="etat-erreur">API injoignable</p>}

        {edition ? (
          <PanneauEdition
            edition={edition}
            enregistrement={{ enCours: enregistrer.isPending, erreur: enregistrer.error?.message ?? null }}
            onChanger={setEdition}
            onEnregistrer={(nom) => enregistrer.mutate({ edition, nom })}
            onAnnuler={() => setEdition(null)}
          />
        ) : (
          <>
            {carrefours.data && <p>{carrefours.data.features.length} carrefour(s) dans la vue</p>}
            {feuxLibres !== undefined && <p>{feuxLibres} feu(x) à regrouper dans la vue (zoomer pour les voir)</p>}
            <div className="actions">
              <button
                className="principal"
                onClick={() =>
                  demarrer({ carrefourId: null, selection: [], nature: 'carrefour', nomSaisi: null, modeRectangle: true })
                }
              >
                Composer un carrefour
              </button>
            </div>
          </>
        )}

        <p className="avertissement">
          Outil citoyen indépendant, sans lien avec la Ville ou la Métropole. Données indicatives.
        </p>
      </aside>
    </>
  )
}

export default App
