import { Badge, Box, HStack, IconButton, Stack, Tabs } from '@chakra-ui/react'
import type { ComponentProps } from 'react'
import { Aide, IconeFeu, Message, PanneauBas, Valeur } from '../ds'
import { OngletGraphe } from './OngletGraphe'
import { OngletLignes } from './OngletLignes'
import { hauteurPanneau, largeurPanneau, type Disposition } from './disposition'
import { OngletProgramme } from './OngletProgramme'

/** Onglets du plan de feux, dans l'ordre où on les remplit. */
export type Onglet = 'lignes' | 'programme' | 'graphe'

const ONGLETS: Array<{ valeur: Onglet; libelle: string }> = [
  { valeur: 'lignes', libelle: 'Lignes de feux' },
  { valeur: 'programme', libelle: 'Programme' },
  { valeur: 'graphe', libelle: 'Graphe et simulation' },
]

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
}

/** Le plan de feux d'un carrefour : lignes de feux, programme, graphe et simulation. */
export function PlanDeFeux(props: Props) {
  const { disposition, onglet, onOnglet, onFermer, lignesModifiees, programmeModifie, erreurProgramme, cycle, instant } = props
  const aDroite = disposition === 'droite'
  const onglets = (
    <Tabs.Root value={onglet} fitted={aDroite} flexBasis={aDroite ? '100%' : undefined} onValueChange={(e) => onOnglet(e.value as Onglet)}>
      <Tabs.List>
        {ONGLETS.map((o, i) => (
          <Tabs.Trigger key={o.valeur} value={o.valeur}>
            {aDroite ? `${i + 1}. ${o.libelle}` : o.libelle}
          </Tabs.Trigger>
        ))}
      </Tabs.List>
    </Tabs.Root>
  )

  return (
    <PanneauBas.Root
      cote={disposition}
      position="fixed"
      zIndex="2"
      {...(aDroite ? { top: '0', right: '0', bottom: '0', w: largeurPanneau } : { left: '0', right: '0', bottom: '0', h: hauteurPanneau })}
    >
      <PanneauBas.Entete titre={<HStack gap="2"><IconeFeu />Plan de feux</HStack>} flexWrap="wrap" rowGap="2">
        {!aDroite && onglets}
        {lignesModifiees && <Badge colorPalette="orange">Lignes non enregistrées</Badge>}
        {programmeModifie && <Badge colorPalette="orange">Programme non enregistré</Badge>}
        {erreurProgramme && <Badge colorPalette="red">Programme en erreur</Badge>}
        <Box flex="1" />
        {cycle > 0 && (
          <Valeur color="fg.secondary">
            t = {Math.floor(instant)} s / {Math.round(cycle)} s
          </Valeur>
        )}
        <IconButton aria-label="Fermer le plan de feux" title="Fermer (Tab)" onClick={onFermer}>
          ×
        </IconButton>
        {/* À droite, les onglets passent sous le titre : le panneau est trop étroit pour les deux. */}
        {aDroite && onglets}
      </PanneauBas.Entete>
      <PanneauBas.Corps css={{ containerType: 'inline-size' }}>
        {onglet === 'lignes' ? <CorpsLignes {...props} /> : <CorpsProgramme {...props} />}
      </PanneauBas.Corps>
    </PanneauBas.Root>
  )
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
  const { onglet, carrefourId, lignesModifiees, programmeModifie, contexte, programmeEnChargement, alertesProgramme, etapesDeduites } = props
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
          instant={instant}
          onInstant={onInstant}
          vitesse={vitesse}
          onVitesse={onVitesse}
        />
      )}
    </Stack>
  )
}
