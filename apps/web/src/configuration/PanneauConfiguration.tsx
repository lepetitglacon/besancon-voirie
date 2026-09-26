import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { calculerMouvements } from '@voirie/engine'
import type { Branche, CarrefourResume, Mouvement, SensBranche } from '@voirie/schema'
import { useEffect, useState } from 'react'
import { api } from '../api'

const FLECHES: Array<{ direction: Mouvement; symbole: string; titre: string }> = [
  { direction: 'demi_tour', symbole: '↶', titre: 'Demi-tour' },
  { direction: 'gauche', symbole: '←', titre: 'Tourne-à-gauche' },
  { direction: 'tout_droit', symbole: '↑', titre: 'Tout droit' },
  { direction: 'droite', symbole: '→', titre: 'Tourne-à-droite' },
]

const DIRECTIONS: Record<Mouvement, string> = {
  gauche: 'à gauche',
  tout_droit: 'tout droit',
  droite: 'à droite',
  demi_tour: 'demi-tour',
}

/** Référence stable : un `[]` littéral relancerait l'effet de synchronisation à chaque rendu. */
const AUCUNE_BRANCHE: Branche[] = []

interface Props {
  carrefour: CarrefourResume
  /** Branches en cours d'édition, dessinées sur la carte par le parent. */
  onBrouillon: (branches: Branche[]) => void
  onFermer: () => void
}

export function PanneauConfiguration({ carrefour, onBrouillon, onFermer }: Props) {
  const queryClient = useQueryClient()
  const [brouillon, setBrouillon] = useState<Branche[] | null>(null)
  const [sources, setSources] = useState<Record<string, 'osm' | 'defaut'>>({})
  const [modifie, setModifie] = useState(false)

  const enregistrees = useQuery({
    queryKey: ['branches', carrefour.id],
    queryFn: () => api.branches(carrefour.id),
  })

  const branches = brouillon ?? enregistrees.data?.branches ?? AUCUNE_BRANCHE
  useEffect(() => onBrouillon(branches), [branches, onBrouillon])

  const changer = (suivantes: Branche[]) => {
    setBrouillon(suivantes)
    setModifie(true)
  }
  const changerBranche = (index: number, branche: Branche) =>
    changer(branches.map((b, i) => (i === index ? branche : b)))

  const detection = useMutation({
    mutationFn: () => api.detecterBranches(carrefour.id),
    onSuccess: (proposition) => {
      setBrouillon(proposition.branches)
      setSources(proposition.sources)
      setModifie(true)
    },
  })

  const enregistrement = useMutation({
    mutationFn: () => api.enregistrerBranches(carrefour.id, { branches }),
    onSuccess: async (resultat) => {
      queryClient.setQueryData(['branches', carrefour.id], resultat)
      setBrouillon(null)
      setModifie(false)
    },
  })

  const detecter = () => {
    if (branches.length === 0 || window.confirm('Remplacer les branches actuelles par la proposition OSM ?')) {
      detection.mutate()
    }
  }

  const { mouvements, alertes } = calculerMouvements(branches)

  return (
    <div className="configuration">
      <h2>Configuration · {carrefour.nom}</h2>
      <p>
        <strong>Étape 1 : branches et voies.</strong> Vérifiez chaque rue qui arrive au carrefour et les
        flèches de ses voies, de gauche à droite en arrivant.
      </p>

      <div className="actions">
        <button onClick={detecter} disabled={detection.isPending}>
          {detection.isPending ? 'Détection…' : 'Détecter depuis OSM'}
        </button>
        <button
          className="principal"
          onClick={() => enregistrement.mutate()}
          disabled={!modifie || enregistrement.isPending}
        >
          {enregistrement.isPending ? 'Enregistrement…' : 'Enregistrer'}
        </button>
        <button
          onClick={() => {
            if (!modifie || window.confirm('Abandonner les modifications non enregistrées ?')) onFermer()
          }}
        >
          Fermer
        </button>
      </div>
      {detection.error && <p className="etat-erreur">{detection.error.message}</p>}
      {enregistrement.error && <p className="etat-erreur">{enregistrement.error.message}</p>}
      {modifie && <p className="a-enregistrer">Modifications non enregistrées</p>}

      {enregistrees.isPending && <p>Chargement…</p>}
      {!enregistrees.isPending && branches.length === 0 && (
        <p>Aucune branche. Lancez la détection depuis OpenStreetMap, puis corrigez la proposition.</p>
      )}

      {branches.map((branche, index) => (
        <CarteBranche
          key={`${index}-${branche.osm_way_id ?? 'manuelle'}`}
          branche={branche}
          source={sources[branche.code]}
          onChanger={(b) => changerBranche(index, b)}
          onSupprimer={() => changer(branches.filter((_, i) => i !== index))}
        />
      ))}

      {branches.length > 0 && (
        <>
          <h3>Mouvements déduits ({mouvements.length})</h3>
          <ul className="mouvements">
            {mouvements.map((m) => (
              <li key={`${m.origine}>${m.destination}`}>
                <strong>
                  {m.origine} → {m.destination}
                </strong>{' '}
                {DIRECTIONS[m.direction]} · voie{m.voies.length > 1 ? 's' : ''} {m.voies.map((v) => v + 1).join(', ')}
              </li>
            ))}
          </ul>
          {alertes.map((a) => (
            <p key={`${a.branche}-${a.rang}-${a.direction}`} className="etat-erreur">
              {a.branche}, voie {a.rang + 1} : flèche « {DIRECTIONS[a.direction]} » sans sortie correspondante
            </p>
          ))}
        </>
      )}
    </div>
  )
}

interface PropsBranche {
  branche: Branche
  source: 'osm' | 'defaut' | undefined
  onChanger: (branche: Branche) => void
  onSupprimer: () => void
}

function CarteBranche({ branche, source, onChanger, onSupprimer }: PropsBranche) {
  const entrante = branche.sens !== 'sortant'

  const changerSens = (sens: SensBranche) =>
    onChanger({
      ...branche,
      sens,
      voies:
        sens === 'sortant'
          ? []
          : branche.voies.length > 0
            ? branche.voies
            : [{ rang: 0, mouvements: ['gauche', 'tout_droit', 'droite'], type: 'generale' }],
    })

  const basculerFleche = (rang: number, direction: Mouvement) =>
    onChanger({
      ...branche,
      voies: branche.voies.map((v) =>
        v.rang !== rang
          ? v
          : {
              ...v,
              mouvements: v.mouvements.includes(direction)
                ? v.mouvements.filter((d) => d !== direction)
                : [...v.mouvements, direction],
            },
      ),
    })

  return (
    <section className="branche">
      <div className="branche-entete">
        <input
          className="code"
          value={branche.code}
          aria-label="Code de la branche"
          onChange={(e) => onChanger({ ...branche, code: e.target.value.toUpperCase().slice(0, 4) })}
        />
        <input
          value={branche.nom ?? ''}
          placeholder="Nom de la rue"
          aria-label="Nom de la rue"
          onChange={(e) => onChanger({ ...branche, nom: e.target.value || null })}
        />
        <button className="danger" title="Supprimer la branche" onClick={onSupprimer}>
          ✕
        </button>
      </div>
      <div className="branche-ligne">
        <select value={branche.sens} onChange={(e) => changerSens(e.target.value as SensBranche)}>
          <option value="double">Double sens</option>
          <option value="entrant">Entrant seulement</option>
          <option value="sortant">Sortant seulement</option>
        </select>
        <span className="discret">{Math.round(branche.azimut)}°</span>
        {branche.sens !== 'entrant' && (
          <label className="en-ligne">
            voies sortantes
            <input
              type="number"
              min={0}
              max={9}
              value={branche.voies_sortantes}
              onChange={(e) => onChanger({ ...branche, voies_sortantes: Number(e.target.value) })}
            />
          </label>
        )}
      </div>

      {entrante && (
        <>
          <div className="voies">
            {branche.voies.map((voie) => (
              <div key={voie.rang} className="voie" title={`Voie ${voie.rang + 1}`}>
                {FLECHES.map(({ direction, symbole, titre }) => (
                  <button
                    key={direction}
                    className={voie.mouvements.includes(direction) ? 'fleche active' : 'fleche'}
                    title={titre}
                    aria-pressed={voie.mouvements.includes(direction)}
                    onClick={() => basculerFleche(voie.rang, direction)}
                  >
                    {symbole}
                  </button>
                ))}
              </div>
            ))}
          </div>
          <div className="actions">
            <button
              onClick={() =>
                onChanger({
                  ...branche,
                  voies: [...branche.voies, { rang: branche.voies.length, mouvements: ['tout_droit'], type: 'generale' }],
                })
              }
              disabled={branche.voies.length >= 10}
            >
              + voie
            </button>
            <button
              onClick={() => onChanger({ ...branche, voies: branche.voies.slice(0, -1) })}
              disabled={branche.voies.length <= 1}
            >
              − voie
            </button>
            {source && (
              <span className={source === 'osm' ? 'badge osm' : 'badge defaut'}>
                {source === 'osm' ? 'flèches OSM' : 'flèches par défaut, à vérifier'}
              </span>
            )}
          </div>
        </>
      )}
    </section>
  )
}
