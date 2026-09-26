import { cleVoie, matriceConflits, mouvementsNonCommandes, proposerLignes, type GeometrieCarrefour } from '@voirie/engine'
import { typeLigne, type BranchesCarrefour, type LigneFeux, type Signal } from '@voirie/schema'
import { useMemo } from 'react'
import { DIRECTIONS, SIGNAUX } from './libelles'
import { MatriceConflits } from './MatriceConflits'

export interface BrouillonLignes {
  lignes: LigneFeux[]
  conflits_admis: Array<[string, string]>
}

interface Props {
  /** Configuration enregistrée : les lignes s'appuient sur elle, pas sur un brouillon. */
  configuration: BranchesCarrefour
  brouillon: BrouillonLignes
  onChanger: (brouillon: BrouillonLignes) => void
  /** Ligne dont on choisit les feux physiques sur la carte. */
  ligneActive: string | null
  onActiver: (code: string | null) => void
}

const cle = (m: { origine: string; destination: string }) => `${m.origine}>${m.destination}`

function codeLibre(signal: Signal, lignes: LigneFeux[]): string {
  const prefixe = SIGNAUX[signal].prefixe
  const pris = new Set(lignes.map((l) => l.code))
  let n = 1
  while (pris.has(`${prefixe}${n}`)) n++
  return `${prefixe}${n}`
}

/** Étape 2 : lignes de feux, feux physiques, matrice des conflits. */
export function OngletLignes({ configuration, brouillon, onChanger, ligneActive, onActiver }: Props) {
  const { branches, mouvements } = configuration
  const { lignes, conflits_admis } = brouillon
  const geometrie: GeometrieCarrefour = useMemo(
    () => ({
      centre: configuration.centre,
      connexions: configuration.connexions,
      voies: new Map(branches.flatMap((b) => b.voies.map((v) => [cleVoie(b.code, v.sens, v.rang), v.geom] as const))),
      traversees: new Map(branches.flatMap((b) => (b.traversee ? [[b.code, b.traversee] as const] : []))),
    }),
    [configuration, branches],
  )
  const avecTraversee = branches.filter((b) => b.traversee)
  const pourConflits = lignes.map((l) => ({ ...l, type: typeLigne(l.signal) }))
  const conflits = matriceConflits(pourConflits, geometrie, conflits_admis)
  const nonCommandes = mouvementsNonCommandes(mouvements, pourConflits)
  const directionDe = new Map(mouvements.map((m) => [cle(m), m.direction]))
  const commandePar = new Map(lignes.flatMap((l) => l.mouvements.map((c) => [c, l.code] as const)))

  const changerLignes = (suivantes: LigneFeux[]) => onChanger({ ...brouillon, lignes: suivantes })
  const changerLigne = (index: number, ligne: LigneFeux) =>
    changerLignes(lignes.map((l, i) => (i === index ? ligne : l)))

  const ajouter = (signal: Signal) =>
    changerLignes([
      ...lignes,
      {
        code: codeLibre(signal, lignes),
        signal,
        mouvements: [],
        traverse: signal === 'R12' ? (avecTraversee[0]?.code ?? null) : null,
        feux: [],
      },
    ])

  const basculerAdmis = (a: string, b: string) => {
    const deja = conflits_admis.some(([x, y]) => (x === a && y === b) || (x === b && y === a))
    onChanger({
      ...brouillon,
      conflits_admis: deja
        ? conflits_admis.filter(([x, y]) => !((x === a && y === b) || (x === b && y === a)))
        : [...conflits_admis, [a, b]],
    })
  }

  if (branches.length === 0) {
    return <p>Enregistrez d'abord les branches du carrefour (onglet 1) : les lignes commandent leurs mouvements.</p>
  }

  return (
    <>
      <div className="actions">
        <button onClick={() => ajouter('R11v')}>+ Véhicules</button>
        <button onClick={() => ajouter('R12')}>+ Piétons</button>
        <button onClick={() => ajouter('R13c')}>+ Vélos</button>
        <button onClick={() => ajouter('R17')}>+ Tram/bus</button>
        {lignes.length === 0 && (
          <button
            onClick={() =>
              changerLignes(
                proposerLignes(mouvements).map((l) => ({ ...l, signal: 'R11v' as const, traverse: null, feux: [] })),
              )
            }
          >
            Proposer une ligne par branche entrante
          </button>
        )}
      </div>

      {lignes.map((ligne, index) => {
        const pieton = ligne.signal === 'R12'
        const active = ligneActive === ligne.code
        return (
          <section key={index} className={active ? 'ligne active' : 'ligne'}>
            <div className="branche-entete">
              <input
                className="code"
                value={ligne.code}
                aria-label="Code de la ligne"
                onChange={(e) => {
                  const code = e.target.value.toUpperCase().slice(0, 4)
                  if (active) onActiver(code)
                  changerLigne(index, { ...ligne, code })
                }}
              />
              <select
                value={ligne.signal}
                onChange={(e) => {
                  const signal = e.target.value as Signal
                  const devientPieton = signal === 'R12'
                  changerLigne(index, {
                    ...ligne,
                    signal,
                    mouvements: devientPieton ? [] : ligne.mouvements,
                    traverse: devientPieton ? (ligne.traverse ?? avecTraversee[0]?.code ?? null) : null,
                  })
                }}
              >
                {(Object.keys(SIGNAUX) as Signal[]).map((signal) => (
                  <option key={signal} value={signal}>
                    {SIGNAUX[signal].libelle}
                  </option>
                ))}
              </select>
              <button className="danger" title="Supprimer la ligne" onClick={() => changerLignes(lignes.filter((_, i) => i !== index))}>
                ✕
              </button>
            </div>

            {pieton ? (
              <label className="en-ligne">
                passage piéton de la branche
                <select
                  value={ligne.traverse ?? ''}
                  onChange={(e) => changerLigne(index, { ...ligne, traverse: e.target.value })}
                >
                  {avecTraversee.map((b) => (
                    <option key={b.code} value={b.code}>
                      {b.code} · {b.nom ?? 'sans nom'}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <div className="choix-mouvements">
                {mouvements.map((m) => {
                  const c = cle(m)
                  const autre = commandePar.get(c)
                  const pris = autre !== undefined && autre !== ligne.code
                  return (
                    <label key={c} className={pris ? 'pris' : undefined}>
                      <input
                        type="checkbox"
                        checked={ligne.mouvements.includes(c)}
                        disabled={pris}
                        onChange={(e) =>
                          changerLigne(index, {
                            ...ligne,
                            mouvements: e.target.checked
                              ? [...ligne.mouvements, c]
                              : ligne.mouvements.filter((x) => x !== c),
                          })
                        }
                      />
                      {m.origine}→{m.destination} <span className="discret">{DIRECTIONS[m.direction]}</span>
                      {pris && <span className="discret"> ({autre})</span>}
                    </label>
                  )
                })}
              </div>
            )}

            <div className="actions">
              <button className={active ? 'actif' : undefined} onClick={() => onActiver(active ? null : ligne.code)}>
                {active ? 'Terminer le choix des feux' : 'Choisir les feux sur la carte'}
              </button>
              <span className="discret">{ligne.feux.length} feu(x) physique(s)</span>
            </div>
            {active && <p className="discret">Cliquez sur les feux du carrefour qui affichent {ligne.code}.</p>}
          </section>
        )
      })}

      {nonCommandes.length > 0 && lignes.length > 0 && (
        <p className="a-enregistrer">
          Mouvements sans ligne de feux : {nonCommandes.map((c) => `${c} (${DIRECTIONS[directionDe.get(c)!]})`).join(', ')}
        </p>
      )}

      {lignes.length > 1 && (
        <>
          <h3>Conflits entre lignes</h3>
          <MatriceConflits codes={lignes.map((l) => l.code)} conflits={conflits} onBasculerAdmis={basculerAdmis} />
        </>
      )}
    </>
  )
}
