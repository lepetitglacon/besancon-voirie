import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { LonLat } from '@voirie/engine'
import type { Branche, BranchesCarrefour, CarrefourResume, Connexion, FeuResume } from '@voirie/schema'
import { useEffect, useImperativeHandle, useMemo, useState, type Ref } from 'react'
import { api } from '../api'
import type { ModeEdition } from './calque/CalqueCarrefour'
import { basculerConnexion, deplacerPoignee, type Brouillon, type Poignee } from './modele'
import { OngletBranches } from './OngletBranches'
import { OngletLignes, type BrouillonLignes } from './OngletLignes'

/** Références stables : un `[]` littéral relancerait les effets de synchronisation à chaque rendu. */
const AUCUNE_BRANCHE: Branche[] = []
const AUCUNE_CONNEXION: Connexion[] = []
const AUCUN_FEU: string[] = []

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
}

type Onglet = 'branches' | 'lignes'

/** Ce que le parent peut demander au panneau : relayer un clic sur un feu de la carte. */
export interface PanneauConfigurationHandle {
  clicFeu: (feu: FeuResume) => void
  deplacerPoignee: (poignee: Poignee, position: LonLat) => void
  connecter: (de: string, vers: string) => void
}

interface Props {
  ref?: Ref<PanneauConfigurationHandle>
  carrefour: CarrefourResume
  onAffichage: (affichage: AffichageConfiguration) => void
  onFermer: () => void
}

export function PanneauConfiguration({ ref, carrefour, onAffichage, onFermer }: Props) {
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
    onSuccess: (resultat) => {
      queryClient.setQueryData(['lignes', carrefour.id], resultat)
      setBrouillonLignes(null)
      setLigneActive(null)
    },
  })

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
  useEffect(
    () =>
      onAffichage({ branches, connexions: configuration.connexions, mode: modeCarte, feuxSurlignes, connexionsSurlignees }),
    [branches, configuration.connexions, modeCarte, feuxSurlignes, connexionsSurlignees, onAffichage],
  )

  const modifie = brouillonBranches !== null || brouillonLignes !== null
  const erreur = [detection, enregistrementBranches, enregistrementLignes].find((m) => m.error)?.error

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
          2. Lignes de feux
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
      ) : (
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
