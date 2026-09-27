import {
  arcsDuGraphe,
  degagementsRetenus,
  validerGraphe,
  type ContexteProgramme,
  type Demande,
  type ResultatSimulation,
} from '@voirie/engine'
import type { PlanEtapes, PlanSaisi } from '@voirie/schema'
import { useState } from 'react'
import { Chronogramme } from './Chronogramme'
import { GrapheEtapes } from './GrapheEtapes'
import { ajouterArc, ajouterPriorite, basculerHorsCycle, changerAppel, modifierArc, retirerArc } from './programme'

export interface Scenario {
  demandes: Demande[]
  duree_s: number
}

const VITESSES = [1, 4, 10]

interface Props {
  contexte: ContexteProgramme
  plans: PlanSaisi[]
  onChanger: (plans: PlanSaisi[]) => void
  planActif: number
  onPlanActif: (index: number) => void
  scenario: Scenario
  onScenario: (scenario: Scenario) => void
  simulation: ResultatSimulation | null
  instant: number
  onInstant: (t: number) => void
  vitesse: number | null
  onVitesse: (vitesse: number | null) => void
}

const secondes = (s: number) => `${Math.round(s * 10) / 10} s`

/** Étape 4 : graphe des étapes (appels, priorité tram) et simulation d'un scénario de demandes. */
export function OngletGraphe(props: Props) {
  const { contexte, plans, onChanger, planActif, onPlanActif, scenario, onScenario, simulation, instant, onInstant, vitesse, onVitesse } = props
  const [lignePriorite, setLignePriorite] = useState('')
  const plan = plans[planActif]
  const codes = contexte.lignes.map((l) => l.code)
  const vehicules = contexte.lignes.filter((l) => l.type !== 'pieton').map((l) => l.code)

  if (plans.length === 0) return <p>Créez d'abord un plan à cycle dans l'onglet 3 : le graphe relie ses étapes.</p>

  const selecteur = (
    <div className="plans" role="tablist" aria-label="Plans de feux">
      {plans.map((p, i) => (
        <button key={i} role="tab" aria-selected={i === planActif} className={i === planActif ? 'actif' : undefined} onClick={() => onPlanActif(i)}>
          {p.code}
        </button>
      ))}
    </div>
  )
  if (!plan || plan.mode !== 'cycle') {
    return (
      <>
        {selecteur}
        <p className="discret">Ce plan n'a pas de cycle : pas de graphe d'étapes.</p>
      </>
    )
  }

  const changerPlan = (suivant: PlanEtapes) => onChanger(plans.map((p, i) => (i === planActif ? suivant : p)))
  const entree = {
    ...contexte,
    etapes: plan.etapes,
    jaune_s: plan.jaune_s,
    degagements: degagementsRetenus(contexte.degagements, plan.degagements),
  }
  const arcs = arcsDuGraphe(entree, plan.arcs)
  const controles = validerGraphe(plan.etapes, plan.arcs, codes)
  const enCours = simulation?.etapes.find((e) => instant >= e.debut_s && instant < e.fin_s)
  const derniereTransition = simulation?.transitions.filter((t) => t.debut_s <= instant).at(-1)
  const etapeLue = enCours?.index ?? (derniereTransition ? derniereTransition.vers : null)
  const changerDemande = (k: number, demande: Demande) =>
    onScenario({ ...scenario, demandes: scenario.demandes.map((d, j) => (j === k ? demande : d)) })

  return (
    <>
      {selecteur}
      <GrapheEtapes
        etapes={plan.etapes}
        arcs={arcs}
        courante={etapeLue}
        arcCourant={derniereTransition ? { de: derniereTransition.de, vers: derniereTransition.vers } : null}
      />
      <p className="discret note-legende">
        — suite du cycle · <span className="legende-saut">- - saut d'une étape sur appel</span> ·{' '}
        <span className="legende-demande">— arc sur demande (priorité)</span> · durée de la transition sur chaque arc
      </p>
      {controles.map((c) => (
        <p key={c.message} className={c.niveau === 'erreur' ? 'etat-erreur' : 'a-enregistrer'}>
          {c.message}
        </p>
      ))}

      <h3>Étapes</h3>
      <table className="table-graphe">
        <tbody>
          {plan.etapes.map((etape, i) => (
            <tr key={i}>
              <th>É{i + 1}</th>
              <td>{etape.lignes.join(' ') || '—'}</td>
              <td>
                <select
                  value={etape.appel ?? ''}
                  disabled={etape.hors_cycle}
                  aria-label={`Appel de l'étape ${i + 1}`}
                  onChange={(e) => changerPlan(changerAppel(plan, i, e.target.value || null))}
                >
                  <option value="">toujours servie</option>
                  {etape.lignes.map((code) => (
                    <option key={code} value={code}>
                      sur appel {code}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <label className="en-ligne">
                  <input type="checkbox" checked={etape.hors_cycle ?? false} disabled={i === 0} onChange={() => changerPlan(basculerHorsCycle(plan, i))} />
                  hors cycle
                </label>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="actions">
        <select value={lignePriorite} onChange={(e) => setLignePriorite(e.target.value)} aria-label="Ligne prioritaire">
          <option value="">ligne prioritaire…</option>
          {vehicules.map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </select>
        <button disabled={!lignePriorite || plan.etapes.length >= 16} onClick={() => changerPlan(ajouterPriorite(plan, lignePriorite))}>
          Ajouter une étape prioritaire
        </button>
      </div>
      <p className="discret">
        Crée une étape hors cycle pour la ligne (tram, bus), atteinte depuis chaque étape du cycle dès sa demande en
        écourtant l'étape en cours après son vert minimal ; le cycle reprend ensuite après l'étape interrompue (ou
        suit un arc sans condition ajouté ci-dessous). Ses lignes compatibles se cochent dans l'onglet 3.
      </p>

      <h3>Arcs ajoutés ({plan.arcs.length})</h3>
      {plan.arcs.map((arc, k) => (
        <div key={k} className="arc-saisi">
          <select value={arc.de} aria-label="Depuis" onChange={(e) => changerPlan(modifierArc(plan, k, { de: Number(e.target.value) }))}>
            {plan.etapes.map((_, i) => (
              <option key={i} value={i}>
                É{i + 1}
              </option>
            ))}
          </select>
          →
          <select value={arc.vers} aria-label="Vers" onChange={(e) => changerPlan(modifierArc(plan, k, { vers: Number(e.target.value) }))}>
            {plan.etapes.map((_, i) => (
              <option key={i} value={i}>
                É{i + 1}
              </option>
            ))}
          </select>
          <select
            value={arc.demande ?? ''}
            aria-label="Condition"
            onChange={(e) => changerPlan(modifierArc(plan, k, { demande: e.target.value || null }))}
          >
            <option value="">sans condition</option>
            {codes.map((code) => (
              <option key={code} value={code}>
                si {code} demandé
              </option>
            ))}
          </select>
          <label className="en-ligne" title="Écourter l'étape de départ dès son vert minimal">
            <input
              type="checkbox"
              checked={arc.anticipe}
              disabled={arc.demande === null}
              onChange={(e) => changerPlan(modifierArc(plan, k, { anticipe: e.target.checked }))}
            />
            écourte
          </label>
          <button className="lien" title="Retirer l'arc" onClick={() => changerPlan(retirerArc(plan, k))}>
            ✕
          </button>
        </div>
      ))}
      <div className="actions">
        <button onClick={() => changerPlan(ajouterArc(plan, { de: 0, vers: Math.min(1, plan.etapes.length - 1), demande: codes[0] ?? null, anticipe: false }))}>
          + Arc
        </button>
      </div>

      <h3>Simulation</h3>
      <p className="discret">
        Déroule le graphe à partir du début de l'étape 1 avec des demandes : appui sur un bouton piéton, détection d'un
        véhicule, arrivée d'un tram. Une demande attend que sa ligne passe au vert.
      </p>
      {scenario.demandes.map((demande, k) => (
        <div key={k} className="arc-saisi">
          <select value={demande.ligne} aria-label="Ligne demandée" onChange={(e) => changerDemande(k, { ...demande, ligne: e.target.value })}>
            {codes.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
          demandé à
          <input
            type="number"
            min={0}
            max={scenario.duree_s}
            value={demande.t}
            aria-label="Instant de la demande"
            onChange={(e) => changerDemande(k, { ...demande, t: Math.max(0, Number(e.target.value) || 0) })}
          />
          s
          <button className="lien" title="Retirer la demande" onClick={() => onScenario({ ...scenario, demandes: scenario.demandes.filter((_, j) => j !== k) })}>
            ✕
          </button>
        </div>
      ))}
      <div className="actions">
        <button onClick={() => onScenario({ ...scenario, demandes: [...scenario.demandes, { ligne: codes[0] ?? '', t: Math.round(instant) }] })}>
          + Demande
        </button>
        <label className="en-ligne">
          sur
          <input
            type="number"
            min={30}
            max={900}
            value={scenario.duree_s}
            onChange={(e) => onScenario({ ...scenario, duree_s: Math.min(900, Math.max(30, Number(e.target.value) || 30)) })}
          />
          s
        </label>
      </div>

      {simulation && simulation.etapes.length > 0 && (
        <>
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
          <Chronogramme chronologie={simulation} lignes={contexte.lignes} instant={instant} onInstant={onInstant} demandes={scenario.demandes} />
          {simulation.attentes.length > 0 && (
            <table className="table-graphe">
              <thead>
                <tr>
                  <th>Demande</th>
                  <th>à</th>
                  <th>attente du vert</th>
                </tr>
              </thead>
              <tbody>
                {simulation.attentes.map((a, k) => (
                  <tr key={k}>
                    <th>{a.ligne}</th>
                    <td>{secondes(a.t)}</td>
                    <td>{a.attente_s === null ? 'pas servie' : secondes(a.attente_s)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <ul className="mouvements">
            {simulation.evenements.map((e, k) => (
              <li key={k}>
                <button className="lien" onClick={() => onInstant(e.t)}>
                  {secondes(e.t)}
                </button>{' '}
                {e.message}
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  )
}
