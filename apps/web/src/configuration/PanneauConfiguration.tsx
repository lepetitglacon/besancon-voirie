import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  calculerProgramme,
  contexteProgramme,
  degagementsRetenus,
  etatLigne,
  simulerGraphe,
  validerGraphe,
  type LonLat,
} from '@voirie/engine'
import type {
  Branche,
  BranchesCarrefour,
  CarrefourResume,
  Connexion,
  FeuResume,
  FeuxGeoJson,
  PlanSaisi,
} from '@voirie/schema'
import { useEffect, useImperativeHandle, useMemo, useState, type Ref } from 'react'
import { api } from '../api'
import type { ModeEdition } from './calque/CalqueCarrefour'
import type { EtatFeu } from './calque/elements'
import { basculerConnexion, deplacerPoignee, type Brouillon, type Poignee } from './modele'
import { OngletBranches } from './OngletBranches'
import { OngletLignes, type BrouillonLignes } from './OngletLignes'
import { OngletGraphe, type Scenario } from './OngletGraphe'
import { OngletProgramme } from './OngletProgramme'
import { feuxDesLignes, geometrieEnregistree, lignesPourMoteur, plansSaisis } from './programme'

/** Références stables : un `[]` littéral relancerait les effets de synchronisation à chaque rendu. */
const AUCUNE_BRANCHE: Branche[] = []
const AUCUNE_CONNEXION: Connexion[] = []
const AUCUN_FEU: string[] = []
const AUCUNE_LIGNE: never[] = []

/** Ce qui s'enregistre : sans les champs déduits (sens des branches). */
const pourEnregistrer = (brouillon: Brouillon) => ({
  branches: brouillon.branches.map((b) => {
    const { sens: _sens, ...branche } = b as Branche & { sens?: unknown }
    return branche
  }),
  connexions: brouillon.connexions,
})

/** Ce que la carte doit dessiner pendant la configuration. */
export interface AffichageConfiguration {
  branches: Branche[]
  connexions: Connexion[]
  /** null : dessin seul (onglet des lignes), sans poignées. */
  mode: ModeEdition | null
  feuxSurlignes: string[]
  /** Connexions de la ligne de feux active (« de>vers »), mises en avant sur la carte. */
  connexionsSurlignees: string[]
  /** Lecture du programme : couleur du feu de chaque connexion et passage piéton. */
  feux: { connexions: ReadonlyMap<string, EtatFeu>; traversees: ReadonlyMap<string, EtatFeu> } | null
}

type Onglet = 'branches' | 'lignes' | 'programme' | 'graphe'

/** Ce que le parent peut demander au panneau : relayer un clic sur un feu de la carte. */
export interface PanneauConfigurationHandle {
  clicFeu: (feu: FeuResume) => void
  deplacerPoignee: (poignee: Poignee, position: LonLat) => void
  connecter: (de: string, vers: string) => void
}

interface Props {
  ref?: Ref<PanneauConfigurationHandle>
  carrefour: CarrefourResume
  /** Feux du carrefour (pour compter ceux posés sur leur mât). */
  feuxCarrefour: FeuxGeoJson['features'] | undefined
  onAffichage: (affichage: AffichageConfiguration) => void
  onFermer: () => void
}

export function PanneauConfiguration({ ref, carrefour, feuxCarrefour, onAffichage, onFermer }: Props) {
  const queryClient = useQueryClient()
  const [onglet, setOnglet] = useState<Onglet>('branches')

  // ── Étape 1 : branches ──
  const branchesEnregistrees = useQuery({
    queryKey: ['branches', carrefour.id],
    queryFn: () => api.branches(carrefour.id),
  })
  const [brouillonBranches, setBrouillonBranches] = useState<Brouillon | null>(null)
  const [sources, setSources] = useState<Record<string, 'osm' | 'defaut'>>({})
  const [mode, setMode] = useState<ModeEdition>('ajuster')
  const enregistre: BranchesCarrefour | undefined = branchesEnregistrees.data
  const configuration: Brouillon = useMemo(
    () => brouillonBranches ?? { branches: enregistre?.branches ?? AUCUNE_BRANCHE, connexions: enregistre?.connexions ?? AUCUNE_CONNEXION },
    [brouillonBranches, enregistre],
  )
  const branches = configuration.branches
  const centre: LonLat = enregistre?.centre ?? [0, 0]

  const detection = useMutation({
    mutationFn: () => api.detecterBranches(carrefour.id),
    onSuccess: (proposition) => {
      setBrouillonBranches({ branches: proposition.branches, connexions: proposition.connexions })
      setSources(proposition.sources)
    },
  })
  const enregistrementBranches = useMutation({
    mutationFn: () => api.enregistrerBranches(carrefour.id, pourEnregistrer(configuration)),
    onSuccess: async (resultat) => {
      queryClient.setQueryData(['branches', carrefour.id], resultat)
      setBrouillonBranches(null)
      await queryClient.invalidateQueries({ queryKey: ['lignes', carrefour.id] })
      await queryClient.invalidateQueries({ queryKey: ['programme', carrefour.id] })
    },
  })

  // ── Étape 2 : lignes de feux ──
  const lignesEnregistrees = useQuery({
    queryKey: ['lignes', carrefour.id],
    queryFn: () => api.lignes(carrefour.id),
  })
  const [brouillonLignes, setBrouillonLignes] = useState<BrouillonLignes | null>(null)
  const lignesEnregistreesData = lignesEnregistrees.data
  const lignes: BrouillonLignes = useMemo(
    () =>
      brouillonLignes ?? {
        lignes: lignesEnregistreesData?.lignes ?? [],
        conflits_admis: lignesEnregistreesData?.conflits_admis ?? [],
      },
    [brouillonLignes, lignesEnregistreesData],
  )
  const [ligneActive, setLigneActive] = useState<string | null>(null)

  const enregistrementLignes = useMutation({
    mutationFn: () => api.enregistrerLignes(carrefour.id, lignes),
    onSuccess: async (resultat) => {
      queryClient.setQueryData(['lignes', carrefour.id], resultat)
      setBrouillonLignes(null)
      setLigneActive(null)
      await queryClient.invalidateQueries({ queryKey: ['programme', carrefour.id] })
    },
  })

  // ── Étape 3 : programme par étapes (s'appuie sur les lignes enregistrées) ──
  const programmeEnregistre = useQuery({
    queryKey: ['programme', carrefour.id],
    queryFn: () => api.programme(carrefour.id),
  })
  const [brouillonProgramme, setBrouillonProgramme] = useState<PlanSaisi[] | null>(null)
  const programmeData = programmeEnregistre.data
  const plans: PlanSaisi[] = useMemo(
    () => brouillonProgramme ?? plansSaisis(programmeData?.plans ?? AUCUNE_LIGNE),
    [brouillonProgramme, programmeData],
  )
  const [planActif, setPlanActif] = useState(0)
  const [instant, setInstant] = useState(0)
  /** Vitesse de lecture du cycle (×1, ×4…), null à l'arrêt. */
  const [vitesse, setVitesse] = useState<number | null>(null)
  const lignesFeux = lignesEnregistreesData?.lignes ?? AUCUNE_LIGNE
  const contexte = useMemo(
    () =>
      enregistre && lignesEnregistreesData
        ? contexteProgramme(lignesPourMoteur(lignesEnregistreesData.lignes), geometrieEnregistree(enregistre), lignesEnregistreesData.conflits_admis)
        : null,
    [enregistre, lignesEnregistreesData],
  )
  const plan = plans[planActif]
  const resultat = useMemo(
    () =>
      contexte && plan?.mode === 'cycle' && plan.etapes.length > 0
        ? calculerProgramme({
            ...contexte,
            etapes: plan.etapes,
            jaune_s: plan.jaune_s,
            degagements: degagementsRetenus(contexte.degagements, plan.degagements),
          })
        : null,
    [contexte, plan],
  )

  // ── Étape 4 : graphe des étapes et simulation d'un scénario de demandes ──
  const [scenario, setScenario] = useState<Scenario>({ demandes: [], duree_s: 240 })
  const simulation = useMemo(
    () =>
      onglet === 'graphe' && contexte && plan?.mode === 'cycle' && plan.etapes.length > 0
        ? simulerGraphe({
            ...contexte,
            etapes: plan.etapes,
            jaune_s: plan.jaune_s,
            degagements: degagementsRetenus(contexte.degagements, plan.degagements),
            arcs: plan.arcs,
            demandes: scenario.demandes,
            duree_s: scenario.duree_s,
          })
        : null,
    [onglet, contexte, plan, scenario],
  )
  const erreurGraphe =
    contexte && plan?.mode === 'cycle'
      ? validerGraphe(plan.etapes, plan.arcs, contexte.lignes.map((l) => l.code)).some((c) => c.niveau === 'erreur')
      : false

  // Ce que lisent le curseur et la carte : le cycle calculé (onglet 3) ou la simulation (onglet 4).
  const chronologie =
    onglet === 'programme' && resultat ? { ...resultat, duree_s: resultat.cycle_s } : onglet === 'graphe' ? simulation : null
  const cycle = chronologie?.duree_s ?? 0
  const instantCycle = cycle > 0 ? instant % cycle : 0
  const erreurProgramme = (resultat?.controles.some((c) => c.niveau === 'erreur') ?? false) || erreurGraphe

  const enregistrementProgramme = useMutation({
    mutationFn: () => api.enregistrerProgramme(carrefour.id, { plans }),
    onSuccess: (resultat) => {
      queryClient.setQueryData(['programme', carrefour.id], resultat)
      setBrouillonProgramme(null)
    },
  })

  // Lecture du cycle : le curseur avance en temps réel (multiplié par la vitesse).
  useEffect(() => {
    if (!vitesse || cycle <= 0) return
    let precedent = performance.now()
    let image = requestAnimationFrame(function avancer(maintenant) {
      const ecoule = (maintenant - precedent) / 1000
      precedent = maintenant
      setInstant((t) => (t + ecoule * vitesse) % cycle)
      image = requestAnimationFrame(avancer)
    })
    return () => cancelAnimationFrame(image)
  }, [vitesse, cycle, onglet])

  // Actions venues de la carte : clic sur un feu (lignes), glisser-déposer (branches).
  useImperativeHandle(
    ref,
    () => ({
      deplacerPoignee: (poignee, position) => setBrouillonBranches(deplacerPoignee(configuration, poignee, position)),
      connecter: (de, vers) => setBrouillonBranches(basculerConnexion(configuration, de, vers)),
      clicFeu: (feu) => {
        if (onglet !== 'lignes' || !ligneActive || feu.carrefour_id !== carrefour.id) return
        setBrouillonLignes({
          ...lignes,
          lignes: lignes.lignes.map((l) =>
            l.code !== ligneActive
              ? l
              : { ...l, feux: l.feux.includes(feu.id) ? l.feux.filter((f) => f !== feu.id) : [...l.feux, feu.id] },
          ),
        })
      },
    }),
    [onglet, ligneActive, lignes, carrefour.id, configuration],
  )

  // Ce que la carte doit montrer.
  const feuxSurlignes =
    onglet === 'lignes' && ligneActive ? (lignes.lignes.find((l) => l.code === ligneActive)?.feux ?? AUCUN_FEU) : AUCUN_FEU
  const modeCarte = onglet === 'branches' ? mode : null
  const mouvementsActifs =
    onglet === 'lignes' && ligneActive ? lignes.lignes.find((l) => l.code === ligneActive)?.mouvements : undefined
  const connexionsSurlignees = useMemo(
    () =>
      mouvementsActifs
        ? configuration.connexions
            .filter((c) => mouvementsActifs.includes(`${c.de.split(':')[0]}>${c.vers.split(':')[0]}`))
            .map((c) => `${c.de}>${c.vers}`)
        : AUCUN_FEU,
    [mouvementsActifs, configuration.connexions],
  )
  // État de chaque ligne à l'instant lu, résumé en une chaîne : la carte n'est redessinée
  // que lorsqu'un feu change de couleur, pas à chaque image de la lecture.
  const etatsLignes = chronologie ? lignesFeux.map((l) => etatLigne(chronologie, l.code, instantCycle)).join(',') : ''
  const connexionsEnregistrees = enregistre?.connexions ?? AUCUNE_CONNEXION
  const feux = useMemo(() => {
    if (!etatsLignes) return null
    const etats = etatsLignes.split(',') as EtatFeu[]
    return feuxDesLignes(new Map(lignesFeux.map((l, i) => [l.code, etats[i]!])), lignesFeux, connexionsEnregistrees)
  }, [etatsLignes, lignesFeux, connexionsEnregistrees])

  useEffect(
    () =>
      onAffichage({ branches, connexions: configuration.connexions, mode: modeCarte, feuxSurlignes, connexionsSurlignees, feux }),
    [branches, configuration.connexions, modeCarte, feuxSurlignes, connexionsSurlignees, feux, onAffichage],
  )

  const feuxPlaces = feuxCarrefour?.filter((f) => f.properties.position_manuelle).length ?? 0
  const modifie = brouillonBranches !== null || brouillonLignes !== null || brouillonProgramme !== null
  const erreur = [detection, enregistrementBranches, enregistrementLignes, enregistrementProgramme].find((m) => m.error)?.error

  return (
    <div className="configuration">
      <h2>Configuration · {carrefour.nom}</h2>
      <div className="onglets" role="tablist">
        <button role="tab" aria-selected={onglet === 'branches'} onClick={() => setOnglet('branches')}>
          1. Branches
        </button>
        <button
          role="tab"
          aria-selected={onglet === 'lignes'}
          onClick={() => {
            setOnglet('lignes')
            setLigneActive(null)
          }}
        >
          2. Lignes
        </button>
        <button role="tab" aria-selected={onglet === 'programme'} onClick={() => setOnglet('programme')}>
          3. Programme
        </button>
        <button
          role="tab"
          aria-selected={onglet === 'graphe'}
          onClick={() => {
            setOnglet('graphe')
            setInstant(0)
          }}
        >
          4. Graphe
        </button>
      </div>

      {onglet === 'branches' ? (
        <>
          <p>
            Calez les voies de chaque rue sur la photo aérienne, puis reliez les voies entrantes aux voies sortantes.
          </p>
          <div className="actions">
            <button
              onClick={() => {
                if (branches.length === 0 || window.confirm('Remplacer les branches actuelles par la proposition OSM ?')) {
                  detection.mutate()
                }
              }}
              disabled={detection.isPending}
            >
              {detection.isPending ? 'Détection…' : 'Détecter depuis OSM'}
            </button>
            <button
              className="principal"
              onClick={() => enregistrementBranches.mutate()}
              disabled={brouillonBranches === null || enregistrementBranches.isPending}
            >
              Enregistrer les branches
            </button>
          </div>
          {brouillonBranches && <p className="a-enregistrer">Branches non enregistrées</p>}
          <div className="placement-feux">
            <button
              aria-pressed={mode === 'feux'}
              className={mode === 'feux' ? 'actif' : undefined}
              onClick={() => setMode(mode === 'feux' ? 'ajuster' : 'feux')}
            >
              ⚑ Placer les feux
            </button>
            <span className="discret">
              {feuxPlaces === 0
                ? 'Feux à leur position OSM'
                : `${feuxPlaces} feu${feuxPlaces > 1 ? 'x' : ''} sur ${feuxCarrefour?.length ?? 0} posé${feuxPlaces > 1 ? 's' : ''} sur leur mât`}
            </span>
          </div>
          {mode === 'feux' && (
            <p className="discret">
              OSM place les feux au milieu de la chaussée : faites glisser chacun jusqu’à son mât sur la photo
              (enregistré dès que vous lâchez). La position OSM reste conservée : le point creux relié par des
              pointillés, sur lequel un clic remet le feu.
            </p>
          )}
          {branchesEnregistrees.isPending ? (
            <p>Chargement…</p>
          ) : (
            <OngletBranches
              brouillon={configuration}
              centre={centre}
              sources={sources}
              mode={mode}
              onMode={setMode}
              onChanger={setBrouillonBranches}
            />
          )}
        </>
      ) : onglet === 'lignes' ? (
        <>
          <p>
            Regroupez les mouvements par <strong>ligne de feux</strong> (les feux qui changent toujours ensemble) et
            indiquez les feux physiques qui les affichent.
          </p>
          {brouillonBranches && (
            <p className="a-enregistrer">Les branches ont des modifications non enregistrées : les lignes utilisent la version enregistrée.</p>
          )}
          <div className="actions">
            <button
              className="principal"
              onClick={() => enregistrementLignes.mutate()}
              disabled={brouillonLignes === null || enregistrementLignes.isPending}
            >
              Enregistrer les lignes
            </button>
          </div>
          {brouillonLignes && <p className="a-enregistrer">Lignes non enregistrées</p>}
          {lignesEnregistrees.data?.alertes.map((alerte) => (
            <p key={alerte} className="etat-erreur">
              {alerte}
            </p>
          ))}
          {lignesEnregistrees.isPending ? (
            <p>Chargement…</p>
          ) : (
            enregistre && (
            <OngletLignes
              configuration={enregistre}
              brouillon={lignes}
              onChanger={setBrouillonLignes}
              ligneActive={ligneActive}
              onActiver={setLigneActive}
            />
            )
          )}
        </>
      ) : (
        <>
          {onglet === 'programme' ? (
            <p>
              Découpez le cycle en <strong>étapes</strong> : les lignes au vert ensemble, et pendant combien de temps. Le
              jaune et les rouges de dégagement s'ajoutent entre les étapes.
            </p>
          ) : (
            <p>
              Le <strong>graphe des étapes</strong> décrit les feux à la demande : étapes servies sur appel (bouton
              piéton, boucle), étapes prioritaires hors cycle (tram). La simulation le déroule sur un scénario.
            </p>
          )}
          {brouillonLignes && (
            <p className="a-enregistrer">Les lignes ont des modifications non enregistrées : le programme utilise la version enregistrée.</p>
          )}
          <div className="actions">
            <button
              className="principal"
              onClick={() => enregistrementProgramme.mutate()}
              disabled={brouillonProgramme === null || erreurProgramme || enregistrementProgramme.isPending}
            >
              Enregistrer le programme
            </button>
          </div>
          {brouillonProgramme && <p className="a-enregistrer">Programme non enregistré</p>}
          {!brouillonProgramme && programmeData?.plans[planActif]?.etapes_deduites && (
            <p className="discret">Étapes reconstruites à partir du diagramme de feux enregistré.</p>
          )}
          {!brouillonProgramme &&
            programmeData?.alertes.map((alerte) => (
              <p key={alerte} className="etat-erreur">
                {alerte}
              </p>
            ))}
          {programmeEnregistre.isPending || !contexte ? (
            <p>Chargement…</p>
          ) : onglet === 'graphe' ? (
            <OngletGraphe
              contexte={contexte}
              plans={plans}
              onChanger={setBrouillonProgramme}
              planActif={planActif}
              onPlanActif={(index) => {
                setPlanActif(index)
                setInstant(0)
              }}
              scenario={scenario}
              onScenario={setScenario}
              simulation={simulation}
              instant={instantCycle}
              onInstant={setInstant}
              vitesse={vitesse}
              onVitesse={setVitesse}
            />
          ) : (
            <OngletProgramme
              contexte={contexte}
              plans={plans}
              onChanger={setBrouillonProgramme}
              planActif={planActif}
              onPlanActif={(index) => {
                setPlanActif(index)
                setInstant(0)
              }}
              resultat={resultat}
              instant={instantCycle}
              onInstant={setInstant}
              vitesse={vitesse}
              onVitesse={setVitesse}
            />
          )}
        </>
      )}

      {erreur && <p className="etat-erreur">{erreur.message}</p>}

      <div className="actions">
        <button
          onClick={() => {
            if (!modifie || window.confirm('Abandonner les modifications non enregistrées ?')) onFermer()
          }}
        >
          Fermer
        </button>
      </div>
    </div>
  )
}
