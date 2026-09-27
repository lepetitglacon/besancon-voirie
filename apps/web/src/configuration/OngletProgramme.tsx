import { cleDegagement, proposerEtapes, type ContexteProgramme, type ResultatProgramme } from '@voirie/engine'
import type { PlanSaisi } from '@voirie/schema'
import { Chronogramme } from './Chronogramme'
import {
  basculerJour,
  basculerLigneEtape,
  changerMode,
  deplacerEtape,
  retirerEtape,
  JOURS,
  nouveauPlan,
  saisirDegagement,
} from './programme'

const MODES: Record<PlanSaisi['mode'], string> = {
  cycle: 'Cycle par étapes',
  jaune_clignotant: 'Jaune clignotant',
  eteint: 'Éteint',
}

const VITESSES = [1, 4, 10]

interface Props {
  contexte: ContexteProgramme
  plans: PlanSaisi[]
  onChanger: (plans: PlanSaisi[]) => void
  planActif: number
  onPlanActif: (index: number) => void
  /** Calcul du plan actif (null si ce n'est pas un plan à cycle). */
  resultat: ResultatProgramme | null
  instant: number
  onInstant: (t: number) => void
  vitesse: number | null
  onVitesse: (vitesse: number | null) => void
}

const secondes = (s: number) => `${Math.round(s * 10) / 10} s`

/** Étape 3 : plans de feux, programme par étapes, transitions et diagramme de feux. */
export function OngletProgramme({ contexte, plans, onChanger, planActif, onPlanActif, resultat, instant, onInstant, vitesse, onVitesse }: Props) {
  const plan = plans[planActif]
  const codes = contexte.lignes.map((l) => l.code)
  const enConflit = (a: string, b: string) => contexte.conflits.some(([x, y]) => (x === a && y === b) || (x === b && y === a))

  const changerPlan = (suivant: PlanSaisi) => onChanger(plans.map((p, i) => (i === planActif ? suivant : p)))

  if (contexte.lignes.length === 0) {
    return <p>Enregistrez d'abord les lignes de feux (onglet 2) : les étapes les mettent au vert.</p>
  }

  return (
    <>
      <div className="plans" role="tablist" aria-label="Plans de feux">
        {plans.map((p, i) => (
          <button key={i} role="tab" aria-selected={i === planActif} className={i === planActif ? 'actif' : undefined} onClick={() => onPlanActif(i)}>
            {p.code}
          </button>
        ))}
        <button
          onClick={() => {
            onChanger([...plans, nouveauPlan(plans, contexte)])
            onPlanActif(plans.length)
          }}
        >
          + Plan
        </button>
      </div>

      {!plan ? (
        <p className="discret">
          Un plan décrit le fonctionnement du carrefour sur des plages horaires : cycle par étapes le jour, jaune clignotant la nuit…
        </p>
      ) : (
        <>
          <section className="branche">
            <div className="branche-entete">
              <input
                className="code-plan"
                value={plan.code}
                aria-label="Nom du plan"
                onChange={(e) => changerPlan({ ...plan, code: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 32) })}
              />
              <select value={plan.mode} aria-label="Mode" onChange={(e) => changerPlan(changerMode(plan, e.target.value as PlanSaisi['mode'], contexte))}>
                {(Object.keys(MODES) as PlanSaisi['mode'][]).map((m) => (
                  <option key={m} value={m}>
                    {MODES[m]}
                  </option>
                ))}
              </select>
              <button
                className="danger"
                title="Supprimer le plan"
                onClick={() => {
                  onChanger(plans.filter((_, i) => i !== planActif))
                  onPlanActif(Math.max(0, planActif - 1))
                }}
              >
                ✕
              </button>
            </div>

            {plan.plages.map((plage, k) => (
              <div key={k} className="plage">
                <div className="jours" role="group" aria-label="Jours">
                  {JOURS.map(({ jour, lettre, nom }) => {
                    const actif = plage.jours === 'tous' || plage.jours.includes(jour)
                    return (
                      <button
                        key={jour}
                        title={nom}
                        aria-pressed={actif}
                        className={actif ? 'actif' : undefined}
                        onClick={() => changerPlan({ ...plan, plages: plan.plages.map((p, i) => (i === k ? basculerJour(p, jour) : p)) })}
                      >
                        {lettre}
                      </button>
                    )
                  })}
                </div>
                <input
                  type="time"
                  value={plage.de}
                  aria-label="Début"
                  onChange={(e) => e.target.value && changerPlan({ ...plan, plages: plan.plages.map((p, i) => (i === k ? { ...p, de: e.target.value } : p)) })}
                />
                →
                <input
                  type="time"
                  value={plage.a}
                  aria-label="Fin"
                  onChange={(e) => e.target.value && changerPlan({ ...plan, plages: plan.plages.map((p, i) => (i === k ? { ...p, a: e.target.value } : p)) })}
                />
                <button
                  className="lien"
                  title="Retirer la plage"
                  disabled={plan.plages.length === 1}
                  onClick={() => changerPlan({ ...plan, plages: plan.plages.filter((_, i) => i !== k) })}
                >
                  ✕
                </button>
              </div>
            ))}
            <div className="actions">
              <button className="lien" onClick={() => changerPlan({ ...plan, plages: [...plan.plages, { jours: 'tous', de: '00:00', a: '00:00' }] })}>
                + plage horaire
              </button>
              <span className="discret">de 00:00 à 00:00 : toute la journée</span>
            </div>
          </section>

          {plan.mode === 'cycle' && (
            <>
              <div className="actions">
                <label className="en-ligne">
                  jaune
                  <input
                    type="number"
                    min={2}
                    max={6}
                    value={plan.jaune_s}
                    onChange={(e) => changerPlan({ ...plan, jaune_s: Number(e.target.value) || 3 })}
                  />
                  s
                </label>
                <button
                  onClick={() => {
                    if (window.confirm('Remplacer les étapes par une proposition ?')) {
                      changerPlan({ ...plan, etapes: proposerEtapes(contexte.lignes, contexte.conflits) })
                    }
                  }}
                >
                  Proposer des étapes
                </button>
              </div>

              {resultat && (
                <>
                  <h3>
                    Diagramme de feux · cycle de {secondes(resultat.cycle_s)}
                  </h3>
                  <div className="lecture">
                    <button onClick={() => onVitesse(vitesse ? null : 1)} aria-pressed={vitesse !== null}>
                      {vitesse ? '⏸ Pause' : '▶ Lecture'}
                    </button>
                    {VITESSES.map((v) => (
                      <button key={v} className={vitesse === v ? 'actif' : undefined} onClick={() => onVitesse(v)}>
                        ×{v}
                      </button>
                    ))}
                    <span className="discret">t = {secondes(Math.floor(instant * 10) / 10)}</span>
                  </div>
                  <Chronogramme
                    chronologie={{ ...resultat, duree_s: resultat.cycle_s }}
                    lignes={contexte.lignes}
                    instant={instant}
                    onInstant={onInstant}
                  />
                  {resultat.controles.map((c) => (
                    <p key={c.message} className={c.niveau === 'erreur' ? 'etat-erreur' : 'a-enregistrer'}>
                      {c.message}
                    </p>
                  ))}
                </>
              )}


              <h3>Étapes</h3>
              {plan.etapes.map((etape, i) => {
                const calculee = resultat?.etapes.find((e) => e.index === i)
                const courante = calculee !== undefined && instant >= calculee.debut_s && instant < calculee.fin_s
                const transition = resultat?.transitions.find((tr) => tr.de === i)
                const inconnues = etape.lignes.filter((c) => !codes.includes(c))
                return (
                  <div key={i}>
                    <section className={courante ? 'etape courante' : 'etape'}>
                      <div className="branche-entete">
                        <button className="lien titre-etape" title="Placer le curseur sur cette étape" onClick={() => calculee && onInstant(calculee.debut_s)}>
                          Étape {i + 1}
                        </button>
                        {etape.hors_cycle && <span className="badge defaut">hors cycle</span>}
                        {etape.appel && !etape.hors_cycle && <span className="badge osm">sur appel {etape.appel}</span>}
                        <label className="en-ligne">
                          <input
                            type="number"
                            min={1}
                            max={300}
                            value={etape.duree_s}
                            aria-label={`Durée de l'étape ${i + 1}`}
                            onChange={(e) =>
                              changerPlan({
                                ...plan,
                                etapes: plan.etapes.map((x, j) => (j === i ? { ...x, duree_s: Math.max(1, Number(e.target.value) || 1) } : x)),
                              })
                            }
                          />
                          s
                        </label>
                        <span className="espace" />
                        <button title="Monter" disabled={i === 0} onClick={() => changerPlan(deplacerEtape(plan, i, -1))}>
                          ↑
                        </button>
                        <button title="Descendre" disabled={i === plan.etapes.length - 1} onClick={() => changerPlan(deplacerEtape(plan, i, 1))}>
                          ↓
                        </button>
                        <button
                          className="danger"
                          title="Supprimer l'étape"
                          disabled={plan.etapes.length === 1}
                          onClick={() => changerPlan(retirerEtape(plan, i))}
                        >
                          ✕
                        </button>
                      </div>
                      <div className="puces">
                        {[...codes, ...inconnues].map((code) => {
                          const auVert = etape.lignes.includes(code)
                          const bloquante = auVert ? undefined : etape.lignes.find((autre) => enConflit(code, autre))
                          const inconnue = inconnues.includes(code)
                          return (
                            <button
                              key={code}
                              className={inconnue ? 'puce inconnue' : auVert ? 'puce au-vert' : bloquante ? 'puce bloquee' : 'puce'}
                              aria-pressed={auVert}
                              disabled={bloquante !== undefined}
                              title={
                                inconnue
                                  ? `${code} n'existe plus : cliquer pour le retirer`
                                  : bloquante
                                    ? `${code} est en conflit avec ${bloquante}`
                                    : auVert
                                      ? `Retirer ${code} de l'étape`
                                      : `Mettre ${code} au vert`
                              }
                              onClick={() => changerPlan(basculerLigneEtape(plan, i, code, codes))}
                            >
                              {code}
                            </button>
                          )
                        })}
                      </div>
                    </section>
                    {transition && plan.etapes.length > 1 && (
                      <p className="transition-etapes discret">
                        ↓ transition {secondes(transition.duree_s)}
                        {transition.contrainte &&
                          ` · ${transition.contrainte.vers} attend ${transition.contrainte.de} : ${
                            transition.contrainte.jaune_s ? `jaune ${transition.contrainte.jaune_s} s + ` : ''
                          }dégagement ${transition.contrainte.rouge_s} s`}
                        {transition.vers !== i + 1 && ` · puis étape ${transition.vers + 1}`}
                      </p>
                    )}
                  </div>
                )
              })}
              <div className="actions">
                <button
                  onClick={() => changerPlan({ ...plan, etapes: [...plan.etapes, { lignes: [], duree_s: 20 }] })}
                  disabled={plan.etapes.length >= 16}
                >
                  + Étape
                </button>
              </div>

              <details className="degagements">
                <summary>Rouges de dégagement ({contexte.degagements.length})</summary>
                <p className="discret">
                  Calculés sur la géométrie : (trajet du dernier usager qui dégage + 6 m) / vitesse − trajet du premier qui
                  arrive / vitesse, à 10 m/s pour les véhicules et 1 m/s pour les piétons. Une valeur saisie remplace le calcul.
                </p>
                <table>
                  <tbody>
                    {contexte.degagements.map((d) => {
                      const cle = cleDegagement(d.de, d.vers)
                      const saisi = plan.degagements[cle]
                      return (
                        <tr key={cle}>
                          <th>
                            {d.de} → {d.vers}
                          </th>
                          <td
                            className="discret"
                            title={d.distances ? `dégage sur ${d.distances.sortant} m, arrive après ${d.distances.entrant} m` : 'valeur par défaut'}
                          >
                            calculé {d.rouge_s} s
                          </td>
                          <td>
                            <input
                              type="number"
                              min={0}
                              max={30}
                              placeholder={String(d.rouge_s)}
                              value={saisi ?? ''}
                              aria-label={`Rouge de dégagement ${d.de} vers ${d.vers}`}
                              onChange={(e) => changerPlan(saisirDegagement(plan, cle, e.target.value === '' ? null : Number(e.target.value)))}
                            />{' '}
                            s
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </details>
            </>
          )}
        </>
      )}
    </>
  )
}
