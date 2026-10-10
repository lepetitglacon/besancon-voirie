import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { LancerEssaiSumo, OptionSumo, ScenarioSumo } from '@voirie/schema'
import { Accordion, Badge, Box, Button, Field, HStack, IconButton, Input, Stack, Text, Textarea } from '@chakra-ui/react'
import { memo, useDeferredValue, useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { Aide, Bascule, Message, Section, Selecteur } from '../ds'
import { EditeurFlux } from './EditeurFlux'
import { etatSumo, useEtatSumo } from './etat'

const SCENARIO_DEFAUT: ScenarioSumo = {
  graine: 42,
  volume: 100,
  retourSoir: true,
  midi: 20,
  flux: [],
  feux: 'coordonnes',
  itineraire: 'depart',
  periodeReacheminement: 120,
}

const NOMBRE: Record<OptionSumo['type'], RegExp | null> = {
  BOOL: null,
  INT: /^-?\d+$/,
  FLOAT: /^-?\d+(\.\d+)?$/,
  TIME: /^-?\d+(\.\d+)?$/,
  STR: null,
  'STR[]': null,
  FILE: null,
}

/** Valeur d'une option avant modification : celle de ville.sumocfg, sinon celle de SUMO. */
const initiale = (option: OptionSumo) => option.projet ?? option.defaut

function optionInvalide(option: OptionSumo, valeur: string): boolean {
  const motif = NOMBRE[option.type]
  return motif !== null && !motif.test(valeur.trim())
}

interface Props {
  /** Réglages de départ (ceux d'un essai déjà lancé), ou les valeurs par défaut. */
  depart: LancerEssaiSumo | null
  /** Un lancement tourne déjà : on peut préparer le suivant, pas le lancer. */
  occupe: boolean
  onLance: () => void
  onAnnuler: () => void
}

/** Formulaire de lancement d'un essai : scénario, puis toutes les options de SUMO par catégorie. */
export function FormulaireLancement({ depart, occupe, onLance, onAnnuler }: Props) {
  const queryClient = useQueryClient()
  const catalogue = useQuery({ queryKey: ['sumo-options'], queryFn: api.optionsSumo, staleTime: Infinity })
  const [nom, setNom] = useState(depart ? `${depart.nom} (variante)` : '')
  const [description, setDescription] = useState(depart?.description ?? '')
  // Essai lancé avant l'ajout d'un réglage : valeur par défaut pour celui-ci.
  const [scenario, setScenario] = useState<ScenarioSumo>({ ...SCENARIO_DEFAUT, ...depart?.scenario })
  const [options, setOptions] = useState<Record<string, string>>(depart?.options ?? {})
  const [recherche, setRecherche] = useState('')
  const filtre = useDeferredValue(recherche.trim().toLowerCase())
  const [ouvertes, setOuvertes] = useState<string[]>(['scenario'])
  // Les flux vivent dans le store pendant que le formulaire est ouvert : la carte les dessine.
  const flux = useEtatSumo((e) => e.flux)
  useEffect(() => {
    etatSumo.modifier({ flux: depart?.scenario.flux ?? [], choixPoint: null })
    return () => etatSumo.modifier({ flux: [], choixPoint: null })
  }, [depart])
  const fluxInvalides = flux.some((f) => f.fin <= f.debut)

  const categories = useMemo(() => {
    const modifiables = (catalogue.data?.categories ?? [])
      .map((c) => ({ ...c, options: c.options.filter((o) => o.modifiable) }))
      .filter((c) => c.options.length > 0)
    if (!filtre) return modifiables
    return modifiables
      .map((c) => ({
        ...c,
        options: c.options.filter((o) => o.cle.toLowerCase().includes(filtre) || o.aide.toLowerCase().includes(filtre)),
      }))
      .filter((c) => c.options.length > 0)
  }, [catalogue.data, filtre])
  const parCle = useMemo(
    () => new Map((catalogue.data?.categories ?? []).flatMap((c) => c.options).map((o) => [o.cle, o])),
    [catalogue.data],
  )
  const invalides = Object.entries(options).filter(([cle, v]) => {
    const option = parCle.get(cle)
    return option !== undefined && optionInvalide(option, v)
  })

  const lancer = useMutation({
    mutationFn: () =>
      api.lancerEssaiSumo({ nom: nom.trim(), description: description.trim(), scenario: { ...scenario, flux }, options }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['sumo-lancements'] })
      onLance()
    },
  })

  const modifier = (option: OptionSumo, valeur: string) =>
    setOptions((actuelles) => {
      const { [option.cle]: _ancienne, ...autres } = actuelles
      // Revenir à la valeur initiale efface la modification.
      return valeur === initiale(option) ? autres : { ...autres, [option.cle]: valeur }
    })
  const changerScenario = <K extends keyof ScenarioSumo>(cle: K, valeur: ScenarioSumo[K]) =>
    setScenario((s) => ({ ...s, [cle]: valeur }))

  // En recherche, toutes les catégories trouvées sont ouvertes.
  const valeurAccordeon = filtre ? categories.map((c) => c.cle) : ouvertes
  const nbModifiees = Object.keys(options).length

  return (
    <Stack gap="3" minH="0">
      <Field.Root required>
        <Field.Label textStyle="xs">Nom de l'essai</Field.Label>
        <Input size="sm" value={nom} onChange={(e) => setNom(e.currentTarget.value)} placeholder="Feux coordonnés, demande +20 %" />
      </Field.Root>
      <Field.Root>
        <Field.Label textStyle="xs">Description</Field.Label>
        <Textarea size="sm" rows={2} value={description} onChange={(e) => setDescription(e.currentTarget.value)} />
      </Field.Root>

      <Input
        size="sm"
        type="search"
        placeholder="Chercher une option SUMO (teleport, rerouting, lanechange…)"
        value={recherche}
        onChange={(e) => setRecherche(e.currentTarget.value)}
      />

      <Box overflowY="auto" minH="0" mx="-1" px="1">
        <Accordion.Root
          multiple
          lazyMount
          size="sm"
          variant="plain"
          value={valeurAccordeon}
          onValueChange={(e) => !filtre && setOuvertes(e.value)}
        >
          {!filtre && (
            <Accordion.Item value="scenario">
              <Accordion.ItemTrigger>
                <Text flex="1" textStyle="sm" fontWeight="semibold">
                  Scénario
                </Text>
                <Accordion.ItemIndicator />
              </Accordion.ItemTrigger>
              <Accordion.ItemContent>
                <Accordion.ItemBody>
                  <Scenario scenario={scenario} onChanger={changerScenario} />
                </Accordion.ItemBody>
              </Accordion.ItemContent>
            </Accordion.Item>
          )}
          {categories.map((categorie) => {
            const modifiees = categorie.options.filter((o) => o.cle in options).length
            return (
              <Accordion.Item key={categorie.cle} value={categorie.cle}>
                <Accordion.ItemTrigger>
                  <Text flex="1" textStyle="sm" fontWeight="semibold">
                    {categorie.libelle}{' '}
                    <Box as="span" color="fg.muted" fontWeight="normal">
                      ({categorie.options.length})
                    </Box>
                  </Text>
                  {modifiees > 0 && (
                    <Badge size="xs" colorPalette="blue">
                      {modifiees} modifiée(s)
                    </Badge>
                  )}
                  <Accordion.ItemIndicator />
                </Accordion.ItemTrigger>
                <Accordion.ItemContent>
                  <Accordion.ItemBody>
                    <Stack gap="2.5">
                      {categorie.options.map((option) => (
                        <ChampOption
                          key={option.cle}
                          option={option}
                          valeur={options[option.cle] ?? initiale(option)}
                          modifiee={option.cle in options}
                          onChanger={modifier}
                        />
                      ))}
                    </Stack>
                  </Accordion.ItemBody>
                </Accordion.ItemContent>
              </Accordion.Item>
            )
          })}
        </Accordion.Root>
        {filtre && categories.length === 0 && <Aide>Aucune option ne correspond.</Aide>}
        {catalogue.isError && <Message ton="erreur">Options de SUMO indisponibles : {catalogue.error.message}</Message>}
        {catalogue.data && (
          <Aide mt="2">
            {catalogue.data.version}. Fichiers, sorties, journal et TraCI sont réglés par le lanceur. Aides de SUMO, en anglais.
          </Aide>
        )}
      </Box>

      {lancer.isError && <Message ton="erreur">{lancer.error.message}</Message>}
      {invalides.length > 0 && <Message ton="erreur">Valeur invalide : {invalides.map(([cle]) => cle).join(', ')}</Message>}
      <HStack justify="space-between">
        <Aide>{nbModifiees ? `${nbModifiees} option(s) SUMO modifiée(s)` : 'Options SUMO du projet'}</Aide>
        <HStack gap="1.5">
          <Button size="xs" variant="ghost" onClick={onAnnuler}>
            Annuler
          </Button>
          <Button
            size="xs"
            loading={lancer.isPending}
            disabled={occupe || !nom.trim() || invalides.length > 0 || fluxInvalides}
            title={occupe ? 'Un essai est déjà en cours' : undefined}
            onClick={() => lancer.mutate()}
          >
            Lancer l'essai
          </Button>
        </HStack>
      </HStack>
    </Stack>
  )
}

interface PropsScenario {
  scenario: ScenarioSumo
  onChanger: <K extends keyof ScenarioSumo>(cle: K, valeur: ScenarioSumo[K]) => void
}

/** Réglages préparés avant la simulation : demande, retour, feux, itinéraires. */
function Scenario({ scenario, onChanger }: PropsScenario) {
  return (
    <Stack gap="2.5">
      <Field.Root>
        <Field.Label textStyle="xs">Demande du matin (% de 28 000 voitures, 7 h – 8 h 30)</Field.Label>
        <Input
          size="xs"
          type="number"
          min={1}
          max={300}
          step={5}
          value={scenario.volume}
          onChange={(e) => onChanger('volume', Number(e.currentTarget.value) || 1)}
        />
      </Field.Root>
      <Bascule coche={scenario.retourSoir} onChange={(v) => onChanger('retourSoir', v)}>
        Retour le soir (trajet inverse, 9 h 30 plus tard)
      </Bascule>
      <Field.Root>
        <Field.Label textStyle="xs">Sorties du midi (% des navetteurs, 12 h – 14 h)</Field.Label>
        <Input
          size="xs"
          type="number"
          min={0}
          max={100}
          step={5}
          value={scenario.midi}
          onChange={(e) => onChanger('midi', Math.min(100, Math.max(0, Number(e.currentTarget.value) || 0)))}
        />
        <Field.HelperText textStyle="2xs">Moitié rentre manger chez soi, moitié à 400 m – 2 km du travail ; retour 45 min à 1 h 15 plus tard.</Field.HelperText>
      </Field.Root>
      <Field.Root>
        <Field.Label textStyle="xs">Feux</Field.Label>
        <Selecteur size="xs" aria-label="Feux" valeur={scenario.feux} onChange={(v) => onChanger('feux', v as ScenarioSumo['feux'])}>
          <option value="netconvert">Inventés par netconvert</option>
          <option value="adaptes">Adaptés à la demande (Webster)</option>
          <option value="coordonnes">Adaptés et coordonnés (ondes vertes)</option>
        </Selecteur>
      </Field.Root>
      <Field.Root>
        <Field.Label textStyle="xs">Choix d'itinéraire</Field.Label>
        <Selecteur
          size="xs"
          aria-label="Choix d'itinéraire"
          valeur={scenario.itineraire}
          onChange={(v) => onChanger('itineraire', v as ScenarioSumo['itineraire'])}
        >
          <option value="depart">Au départ, d'après le trafic, puis gardé</option>
          <option value="reacheminement">Recalculé en route (GPS)</option>
          <option value="vide">Calculé sur la ville vide</option>
        </Selecteur>
      </Field.Root>
      {scenario.itineraire === 'reacheminement' && (
        <Field.Root>
          <Field.Label textStyle="xs">Recalcul toutes les (s)</Field.Label>
          <Input
            size="xs"
            type="number"
            min={30}
            max={3600}
            step={30}
            value={scenario.periodeReacheminement}
            onChange={(e) => onChanger('periodeReacheminement', Number(e.currentTarget.value) || 120)}
          />
        </Field.Root>
      )}
      <Field.Root>
        <Field.Label textStyle="xs">Graine aléatoire</Field.Label>
        <Input
          size="xs"
          type="number"
          min={0}
          value={scenario.graine}
          onChange={(e) => onChanger('graine', Math.max(0, Math.round(Number(e.currentTarget.value) || 0)))}
        />
      </Field.Root>
      <Section libelle="Flux ajoutés à la main">
        <EditeurFlux />
      </Section>
    </Stack>
  )
}

interface PropsChamp {
  option: OptionSumo
  valeur: string
  modifiee: boolean
  onChanger: (option: OptionSumo, valeur: string) => void
}

/** Une option de SUMO : champ selon son type, aide, valeur par défaut, retour à la valeur initiale. */
const ChampOption = memo(function ChampOption({ option, valeur, modifiee, onChanger }: PropsChamp) {
  const invalide = optionInvalide(option, valeur)
  return (
    <Stack gap="0.5" ps="2" borderLeftWidth="2px" borderColor={modifiee ? 'blue.solid' : 'transparent'}>
      <HStack gap="1.5" justify="space-between">
        <Text fontFamily="mono" textStyle="xs" fontWeight={modifiee ? 'semibold' : 'normal'} wordBreak="break-all">
          {option.cle}
        </Text>
        {modifiee && (
          <IconButton
            size="2xs"
            variant="ghost"
            aria-label={`Remettre ${option.cle} à ${initiale(option) || '(vide)'}`}
            title="Remettre la valeur initiale"
            onClick={() => onChanger(option, initiale(option))}
          >
            ↺
          </IconButton>
        )}
      </HStack>
      {option.type === 'BOOL' ? (
        <Bascule size="sm" aria-label={option.cle} coche={valeur === 'true'} onChange={(coche) => onChanger(option, String(coche))}>
          <Aide as="span">{valeur === 'true' ? 'oui' : 'non'}</Aide>
        </Bascule>
      ) : (
        <Input
          size="xs"
          aria-label={option.cle}
          fontFamily={option.type === 'STR' || option.type === 'STR[]' ? undefined : 'mono'}
          inputMode={NOMBRE[option.type] ? 'decimal' : undefined}
          value={valeur}
          aria-invalid={invalide}
          borderColor={invalide ? 'red.solid' : undefined}
          onChange={(e) => onChanger(option, e.currentTarget.value)}
        />
      )}
      {option.aide && <Aide>{option.aide}</Aide>}
      <Aide textStyle="2xs">
        {option.type} · SUMO : {option.defaut || '(vide)'}
        {option.projet !== null && ` · projet : ${option.projet}`}
      </Aide>
    </Stack>
  )
})
