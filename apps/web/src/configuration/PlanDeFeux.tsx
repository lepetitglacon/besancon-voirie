import { Box, Button, HStack, IconButton, Stack, Tabs } from '@chakra-ui/react'
import type { ComponentProps } from 'react'
import { Link } from 'react-router'
import { Aide, IconeFeu, Message, PanneauBas, Pastille, Valeur } from '../ds'
import { BandeChronogramme } from './BandeChronogramme'
import { hauteurPanneau, largeurPanneau, type Disposition } from './disposition'
import { OngletGraphe } from './OngletGraphe'
import { OngletLignes } from './OngletLignes'
import { OngletProgramme } from './OngletProgramme'
import { etirerEtape } from './programme'

/** Onglets du plan de feux, dans l'ordre où on les remplit. */
export type Onglet = 'lignes' | 'programme' | 'graphe'

const ONGLETS: Array<{ valeur: Onglet; libelle: string }> = [
  { valeur: 'lignes', libelle: 'Lignes de feux' },
  { valeur: 'programme', libelle: 'Programme' },
  { valeur: 'graphe', libelle: 'Graphe et simulation' },
]

/** Où en est une étape du plan de feux, affiché sur son onglet. */
type EtatEtape = 'vide' | 'brouillon' | 'erreur' | 'enregistre'

const ETATS: Record<EtatEtape, { couleur: string; libelle: string }> = {
  vide: { couleur: 'fg.subtle', libelle: 'à faire' },
  brouillon: { couleur: 'feu.orange', libelle: 'non enregistré' },
  erreur: { couleur: 'feu.rouge', libelle: 'en erreur' },
  enregistre: { couleur: 'feu.vert', libelle: 'enregistré' },
}

function etatsEtapes({ lignesModifiees, alertesLignes, lignes, programmeModifie, erreurProgramme, plans }: Props): Record<Onglet, EtatEtape> {
  const programme: EtatEtape = erreurProgramme ? 'erreur' : programmeModifie ? 'brouillon' : plans.length > 0 ? 'enregistre' : 'vide'
  // Le graphe fait partie du programme : il n'est « fait » que si un plan sert des étapes à la demande.
  const aLaDemande = plans.some((p) => p.mode === 'cycle' && (p.arcs.length > 0 || p.etapes.some((e) => e.appel || e.hors_cycle)))
  return {
    lignes: alertesLignes.length > 0 ? 'erreur' : lignesModifiees ? 'brouillon' : lignes.lignes.length > 0 ? 'enregistre' : 'vide',
    programme,
    graphe: aLaDemande || programme === 'erreur' || programme === 'brouillon' ? programme : 'vide',
  }
}

type PropsLignes = ComponentProps<typeof OngletLignes>
type PropsProgramme = ComponentProps<typeof OngletProgramme>
type PropsGraphe = ComponentProps<typeof OngletGraphe>

interface Props {
  disposition: Disposition
  onglet: Onglet
  onOnglet: (onglet: Onglet) => void
  onFermer: () => void
  carrefourId: string
  /** Brouillons en cours : les étapes suivantes s'appuient sur la version enregistrée. */
  branchesModifiees: boolean
  lignesModifiees: boolean
  programmeModifie: boolean
  erreurProgramme: boolean

  // Lignes de feux.
  lignesEnChargement: boolean
  alertesLignes: string[]
  configuration: PropsLignes['configuration'] | undefined
  lignes: PropsLignes['brouillon']
  onLignes: PropsLignes['onChanger']
  ligneActive: PropsLignes['ligneActive']
  onLigneActive: PropsLignes['onActiver']

  // Programme et graphe : null tant que les lignes et la géométrie ne sont pas chargées.
  contexte: PropsProgramme['contexte'] | null
  programmeEnChargement: boolean
  alertesProgramme: string[]
  /** Les étapes du plan actif ont été reconstruites à partir du diagramme enregistré. */
  etapesDeduites: boolean
  plans: PropsProgramme['plans']
  onPlans: PropsProgramme['onChanger']
  planActif: number
  onPlanActif: (index: number) => void
  resultat: PropsProgramme['resultat']
  scenario: PropsGraphe['scenario']
  onScenario: PropsGraphe['onScenario']
  simulation: PropsGraphe['simulation']

  // Lecture du cycle ou de la simulation : `cycle` vaut 0 quand il n'y a rien à lire.
  cycle: number
  instant: number
  onInstant: (t: number) => void
  vitesse: number | null
  onVitesse: (vitesse: number | null) => void
  /** Hauteur de la bande du diagramme sous la carte (px), 0 sans bande. */
  onHauteurBande: (hauteur: number) => void
}

/** Le plan de feux d'un carrefour : lignes de feux, programme, graphe et simulation. */
export function PlanDeFeux(props: Props) {
  const { disposition, onglet, onOnglet, onFermer, cycle, instant } = props
  const aDroite = disposition === 'droite'
  const etats = etatsEtapes(props)
  const onglets = (
    <Tabs.Root value={onglet} fitted={aDroite} flexBasis={aDroite ? '100%' : undefined} onValueChange={(e) => onOnglet(e.value as Onglet)}>
      <Tabs.List>
        {ONGLETS.map((o, i) => (
          <Tabs.Trigger key={o.valeur} value={o.valeur} title={`${o.libelle} : ${ETATS[etats[o.valeur]].libelle}`}>
            <Pastille couleur={ETATS[etats[o.valeur]].couleur} />
            {i + 1}. {o.libelle}
          </Tabs.Trigger>
        ))}
      </Tabs.List>
    </Tabs.Root>
  )
  const suivant = ONGLETS[ONGLETS.findIndex((o) => o.valeur === onglet) + 1]

  return (
    <>
      <PanneauBas.Root
        cote={disposition}
        position="fixed"
        zIndex="2"
        {...(aDroite ? { top: '0', right: '0', bottom: '0', w: largeurPanneau } : { left: '0', right: '0', bottom: '0', h: hauteurPanneau })}
      >
        <PanneauBas.Entete titre={<HStack gap="2"><IconeFeu />Plan de feux</HStack>} flexWrap="wrap" rowGap="2">
          {!aDroite && onglets}
          <Box flex="1" />
          {cycle > 0 && (
            <Valeur color="fg.secondary">
              t = {Math.floor(instant)} s / {Math.round(cycle)} s
            </Valeur>
          )}
          <Button asChild size="xs" variant="ghost" title="Relever ce carrefour sur place, sur le téléphone">
            <Link to={`/terrain/${props.carrefourId}`}>Relevé terrain ↗</Link>
          </Button>
          <IconButton aria-label="Fermer le plan de feux" title="Fermer (Tab)" onClick={onFermer}>
            ×
          </IconButton>
          {/* À droite, les onglets passent sous le titre : le panneau est trop étroit pour les deux. */}
          {aDroite && onglets}
        </PanneauBas.Entete>
        <PanneauBas.Corps css={{ containerType: 'inline-size' }}>
          <Stack gap="4">
            {onglet === 'lignes' ? <CorpsLignes {...props} /> : <CorpsProgramme {...props} />}
            {suivant && (
              <Button variant="outline" size="sm" alignSelf="end" onClick={() => onOnglet(suivant.valeur)}>
                Étape suivante : {suivant.libelle} →
              </Button>
            )}
          </Stack>
        </PanneauBas.Corps>
      </PanneauBas.Root>
      {aDroite && <Bande {...props} />}
    </>
  )
}

/** Le diagramme de feux du plan actif (onglet Programme) ou la simulation (onglet Graphe), en bande sous la carte. */
function Bande({ onglet, contexte, plans, onPlans, planActif, resultat, simulation, scenario, instant, onInstant, vitesse, onVitesse, onHauteurBande }: Props) {
  const plan = plans[planActif]
  if (!contexte || plan?.mode !== 'cycle') return null
  const commun = { lignes: contexte.lignes, instant, onInstant, vitesse, onVitesse, onHauteur: onHauteurBande }
  const placement = { position: 'fixed', left: '0', bottom: '0', right: largeurPanneau, zIndex: '2' } as const
  if (onglet === 'programme' && resultat) {
    return (
      <BandeChronogramme
        {...placement}
        {...commun}
        titre={`Diagramme de feux · cycle de ${Math.round(resultat.cycle_s * 10) / 10} s`}
        chronologie={{ ...resultat, duree_s: resultat.cycle_s }}
        onEtirer={(index, finActuelle, finVoulue) =>
          onPlans(plans.map((p, i) => (i === planActif && p.mode === 'cycle' ? etirerEtape(p, index, finActuelle, finVoulue) : p)))
        }
      />
    )
  }
  if (onglet === 'graphe' && simulation) {
    return (
      <BandeChronogramme
        {...placement}
        {...commun}
        titre={`Simulation · ${Math.round(simulation.duree_s)} s`}
        chronologie={simulation}
        demandes={scenario.demandes}
      />
    )
  }
  return null
}

function CorpsLignes({ branchesModifiees, lignesEnChargement, alertesLignes, configuration, lignes, onLignes, ligneActive, onLigneActive }: Props) {
  return (
    <Stack gap="3">
      <Aide>
        Regroupez les mouvements par <strong>ligne de feux</strong> (les feux qui changent toujours ensemble) et indiquez les feux
        physiques qui les affichent.
      </Aide>
      {branchesModifiees && (
        <Message ton="avertissement">Les branches ont des modifications non enregistrées : les lignes utilisent la version enregistrée.</Message>
      )}
      {alertesLignes.map((alerte) => (
        <Message key={alerte} ton="erreur">
          {alerte}
        </Message>
      ))}
      {lignesEnChargement ? (
        <Aide>Chargement…</Aide>
      ) : (
        configuration && (
          <OngletLignes configuration={configuration} brouillon={lignes} onChanger={onLignes} ligneActive={ligneActive} onActiver={onLigneActive} />
        )
      )}
    </Stack>
  )
}

function CorpsProgramme(props: Props) {
  const { disposition, onglet, carrefourId, lignesModifiees, programmeModifie, contexte, programmeEnChargement, alertesProgramme, etapesDeduites } = props
  const { plans, onPlans, planActif, onPlanActif, resultat, scenario, onScenario, simulation, instant, onInstant, vitesse, onVitesse } = props
  return (
    <Stack gap="3">
      <Aide>
        {onglet === 'programme' ? (
          <>
            Découpez le cycle en <strong>étapes</strong> : les lignes au vert ensemble, et pendant combien de temps. Le jaune et les rouges
            de dégagement s'ajoutent entre les étapes.
          </>
        ) : (
          <>
            Le <strong>graphe des étapes</strong> décrit les feux à la demande : étapes servies sur appel (bouton piéton, boucle), étapes
            prioritaires hors cycle (tram). La simulation le déroule sur un scénario.
          </>
        )}
      </Aide>
      {lignesModifiees && (
        <Message ton="avertissement">Les lignes ont des modifications non enregistrées : le programme utilise la version enregistrée.</Message>
      )}
      {!programmeModifie && etapesDeduites && <Aide>Étapes reconstruites à partir du diagramme de feux enregistré.</Aide>}
      {!programmeModifie &&
        alertesProgramme.map((alerte) => (
          <Message key={alerte} ton="erreur">
            {alerte}
          </Message>
        ))}
      {programmeEnChargement || !contexte ? (
        <Aide>Chargement…</Aide>
      ) : onglet === 'graphe' ? (
        <OngletGraphe
          contexte={contexte}
          plans={plans}
          onChanger={onPlans}
          planActif={planActif}
          onPlanActif={onPlanActif}
          scenario={scenario}
          onScenario={onScenario}
          simulation={simulation}
          diagrammeEnBande={disposition === 'droite'}
          instant={instant}
          onInstant={onInstant}
          vitesse={vitesse}
          onVitesse={onVitesse}
        />
      ) : (
        <OngletProgramme
          carrefourId={carrefourId}
          modifie={programmeModifie}
          contexte={contexte}
          plans={plans}
          onChanger={onPlans}
          planActif={planActif}
          onPlanActif={onPlanActif}
          resultat={resultat}
          diagrammeEnBande={disposition === 'droite'}
          instant={instant}
          onInstant={onInstant}
          vitesse={vitesse}
          onVitesse={onVitesse}
        />
      )}
    </Stack>
  )
}
