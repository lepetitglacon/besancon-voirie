import { cleVoie, flechesParVoie, mouvementsDepuisConnexions, type LonLat } from '@voirie/engine'
import type { SensVoie, TypeVoie } from '@voirie/schema'
import type { ModeEdition } from './calque/CalqueCarrefour'
import { DIRECTIONS, FLECHES } from './libelles'
import {
  ajouterVoie,
  basculerConnexion,
  basculerTraversee,
  changerTypeVoie,
  couleursVoies,
  regenererVoies,
  renommerBranche,
  retirerVoie,
  supprimerBranche,
  voiesDe,
  type Brouillon,
} from './modele'

const TYPES: Record<TypeVoie, string> = { generale: 'générale', bus: 'bus', velo: 'vélo', tram: 'tram' }
const symbole = new Map(FLECHES.map((f) => [f.direction, f.symbole]))

interface Props {
  brouillon: Brouillon
  centre: LonLat
  sources: Record<string, 'osm' | 'defaut'>
  mode: ModeEdition
  onMode: (mode: ModeEdition) => void
  onChanger: (brouillon: Brouillon) => void
}

/** Étape 1 : branches, voies calées sur la photo, passages piétons et connexions entre voies. */
export function OngletBranches({ brouillon, centre, sources, mode, onMode, onChanger }: Props) {
  const { branches, connexions } = brouillon
  const fleches = flechesParVoie(branches, connexions)
  const mouvements = mouvementsDepuisConnexions(branches, connexions)
  const couleurs = couleursVoies(branches)
  const sansConnexion = branches.flatMap((b) =>
    voiesDe(b, 'entrante')
      .filter((v) => !connexions.some((c) => c.de === cleVoie(b.code, 'entrante', v.rang)))
      .map((v) => `${b.code}, voie entrante ${v.rang + 1}`),
  )

  if (branches.length === 0) {
    return <p>Aucune branche. Lancez la détection depuis OpenStreetMap, puis calez les voies sur la photo.</p>
  }

  return (
    <>
      <div className="modes" role="radiogroup" aria-label="Mode d'édition sur la carte">
        <button role="radio" aria-checked={mode === 'ajuster'} className={mode === 'ajuster' ? 'actif' : undefined} onClick={() => onMode('ajuster')}>
          ✥ Ajuster les voies
        </button>
        <button role="radio" aria-checked={mode === 'connecter'} className={mode === 'connecter' ? 'actif' : undefined} onClick={() => onMode('connecter')}>
          ⤳ Connecter
        </button>
      </div>
      {mode !== 'feux' && (
        <p className="discret">
          {mode === 'ajuster'
            ? 'Faites glisser les extrémités des voies et des passages piétons pour les caler sur le marquage de la photo (fond de carte « Satellite »).'
            : 'Glissez du point coloré d’une voie entrante vers le point blanc d’une voie sortante. Refaire le même geste retire la connexion.'}
        </p>
      )}

      {branches.map((branche, index) => (
        <section key={index} className="branche">
          <div className="branche-entete">
            <input
              className="code"
              value={branche.code}
              aria-label="Code de la branche"
              onChange={(e) => {
                const code = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4)
                if (code && !branches.some((b) => b.code === code)) onChanger(renommerBranche(brouillon, branche.code, code))
              }}
            />
            <input
              value={branche.nom ?? ''}
              placeholder="Nom de la rue"
              aria-label="Nom de la rue"
              onChange={(e) =>
                onChanger({
                  ...brouillon,
                  branches: branches.map((b) => (b.code === branche.code ? { ...b, nom: e.target.value || null } : b)),
                })
              }
            />
            <button className="danger" title="Supprimer la branche" onClick={() => onChanger(supprimerBranche(brouillon, branche.code))}>
              ✕
            </button>
          </div>

          {(['entrante', 'sortante'] as SensVoie[]).map((sens) => (
            <div key={sens} className="branche-ligne">
              <span className="discret libelle-sens">{sens === 'entrante' ? 'Entrantes' : 'Sortantes'}</span>
              <button onClick={() => onChanger(retirerVoie(brouillon, branche.code, sens))} disabled={voiesDe(branche, sens).length === 0}>
                −
              </button>
              <button onClick={() => onChanger(ajouterVoie(brouillon, branche.code, sens, centre))} disabled={voiesDe(branche, sens).length >= 8}>
                +
              </button>
              <div className="voies">
                {voiesDe(branche, sens).map((voie) => {
                  const cle = cleVoie(branche.code, sens, voie.rang)
                  return (
                    <label key={cle} className="voie" style={{ borderColor: couleurs.get(cle) }} title={`Voie ${voie.rang + 1}`}>
                      {sens === 'entrante' && (
                        <strong className="fleches-deduites">
                          {(fleches[cle] ?? []).map((d) => symbole.get(d)).join('') || '∅'}
                        </strong>
                      )}
                      <select
                        value={voie.type}
                        aria-label={`Type de la voie ${voie.rang + 1}`}
                        onChange={(e) => onChanger(changerTypeVoie(brouillon, branche.code, sens, voie.rang, e.target.value as TypeVoie))}
                      >
                        {(Object.keys(TYPES) as TypeVoie[]).map((t) => (
                          <option key={t} value={t}>
                            {TYPES[t]}
                          </option>
                        ))}
                      </select>
                    </label>
                  )
                })}
              </div>
            </div>
          ))}

          <div className="actions">
            <label className="en-ligne">
              <input
                type="checkbox"
                checked={branche.traversee !== null}
                onChange={() => onChanger(basculerTraversee(brouillon, branche.code, centre))}
              />
              passage piéton
            </label>
            <button onClick={() => onChanger(regenererVoies(brouillon, branche.code, centre))} title="Remettre les voies à leur position proposée">
              Replacer
            </button>
            {sources[branche.code] && (
              <span className={sources[branche.code] === 'osm' ? 'badge osm' : 'badge defaut'}>
                {sources[branche.code] === 'osm' ? 'connexions d’après OSM' : 'connexions par défaut, à vérifier'}
              </span>
            )}
          </div>
        </section>
      ))}

      <h3>Connexions ({connexions.length})</h3>
      <ul className="mouvements">
        {connexions.map((c) => (
          <li key={`${c.de}>${c.vers}`}>
            <span className="pastille-voie" style={{ background: couleurs.get(c.de) }} /> {c.de} → {c.vers}{' '}
            <button className="lien" onClick={() => onChanger(basculerConnexion(brouillon, c.de, c.vers))}>
              retirer
            </button>
          </li>
        ))}
      </ul>

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
      {sansConnexion.length > 0 && <p className="a-enregistrer">Voies entrantes sans connexion : {sansConnexion.join(' ; ')}</p>}
    </>
  )
}
