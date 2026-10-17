import { Badge, Button, HStack, Stack } from '@chakra-ui/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  analyserReleve,
  debutsDeVert,
  planEnVigueur,
  vertsDansLeCycle,
  type ContexteProgramme,
  type Intervalle,
  type ResultatProgramme,
  type SaisieReleve,
} from '@voirie/engine'
import type { PlanEtapes, PlanSaisi, ReleveResume } from '@voirie/schema'
import { useState } from 'react'
import { api } from '../api'
import { Aide, Chiffre, Compteur, Message, Section, Selecteur } from '../ds'
import { Chronogramme } from './Chronogramme'
import { proposerCorrections, type Correction } from './corrections'
import { Lecture } from './Lecture'
import { etirerEtape } from './programme'
import { TimelineReleve } from './TimelineReleve'

interface Props {
  carrefourId: string
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

const STATUTS: Record<ReleveResume['statut'], { libelle: string; couleur: string }> = {
  en_attente: { libelle: 'à relire', couleur: 'gray' },
  valide: { libelle: 'validé', couleur: 'green' },
  rejete: { libelle: 'rejeté', couleur: 'red' },
}

/** Verts relevés décalés de `d` secondes dans le cycle, découpés s'ils passent sa fin. */
function decaler(mesures: Record<string, Intervalle[]>, d: number, cycle: number): Record<string, Intervalle[]> {
  if (d === 0) return mesures
  const modulo = (v: number) => ((v % cycle) + cycle) % cycle
  return Object.fromEntries(
    Object.entries(mesures).map(([ligne, intervalles]) => {
      // Un vert à cheval sur la fin du cycle est en deux morceaux : on part du premier, sur toute sa longueur.
      const longueur = intervalles.reduce((total, [a, b]) => total + b - a, 0)
      const debut = modulo(intervalles[0]![0] + d)
      const fin = debut + longueur
      return [ligne, fin <= cycle ? [[debut, fin] as Intervalle] : [[debut, cycle] as Intervalle, [0, fin - cycle] as Intervalle]]
    }),
  )
}

const date = (iso: string) => new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })

/** Étape 5 : relevés terrain superposés au programme, et les corrections qu'ils suggèrent pour le brouillon. */
export function OngletReleves(props: Props) {
  const { carrefourId } = props
  const releves = useQuery({ queryKey: ['releves', carrefourId], queryFn: () => api.relevesCarrefour(carrefourId) })
  const [choisi, setChoisi] = useState<string | null>(null)
  const id = choisi ?? releves.data?.[0]?.id ?? null

  if (releves.isPending) return <Aide>Chargement…</Aide>
  if (!releves.data?.length) {
    return (
      <Aide>
        Aucun relevé pour ce carrefour. Sur place, ouvrez « Relevé terrain » sur un téléphone : un appui à chaque changement de couleur,
        puis « Envoyer le relevé ».
      </Aide>
    )
  }

  return (
    <Stack gap="3">
      <Selecteur size="sm" w="full" valeur={id ?? ''} aria-label="Relevé comparé" onChange={setChoisi}>
        {releves.data.map((r) => (
          <option key={r.id} value={r.id}>
            {date(r.observe_le)}
            {r.pseudo ? ` · ${r.pseudo}` : ''} · {r.cycle_s ? `cycle ${r.cycle_s} s` : 'cycle non mesuré'} · {STATUTS[r.statut].libelle}
          </option>
        ))}
      </Selecteur>
      {id && <Comparaison key={id} releveId={id} {...props} />}
    </Stack>
  )
}

function Comparaison({ releveId, contexte, plans, onChanger, planActif, onPlanActif, resultat, instant, onInstant, vitesse, onVitesse }: Props & { releveId: string }) {
  const queryClient = useQueryClient()
  const detail = useQuery({ queryKey: ['releve', releveId], queryFn: () => api.releve(releveId) })
  /** Saisies recalées dans la timeline, pas encore enregistrées ; null : celles du relevé. */
  const [recalees, setRecalees] = useState<SaisieReleve[] | null>(null)
  /** Décalage du relevé sur le diagramme (s), pour l'aligner à l'œil. */
  const [decalage, setDecalage] = useState(0)
  const enregistrement = useMutation({
    mutationFn: (saisies: SaisieReleve[]) => api.corrigerReleve(releveId, saisies),
    onSuccess: (corrige) => {
      queryClient.setQueryData(['releve', releveId], corrige)
      setRecalees(null)
      return queryClient.invalidateQueries({ queryKey: ['releves'] })
    },
  })
  if (detail.isPending) return <Aide>Chargement du relevé…</Aide>
  if (detail.isError) return <Message ton="erreur">{detail.error.message}</Message>
  const releve = detail.data

  const plan = plans[planActif]
  const enVigueur = planEnVigueur(plans, Date.parse(releve.observe_le))
  const indexEnVigueur = enVigueur ? plans.indexOf(enVigueur) : -1
  const autrePlan = indexEnVigueur >= 0 && indexEnVigueur !== planActif && (
    <HStack gap="2">
      <Message ton="avertissement" flex="1">
        Le relevé a été fait sous le plan « {enVigueur!.code} », pas « {plan?.code} ».
      </Message>
      <Button size="xs" onClick={() => onPlanActif(indexEnVigueur)}>
        Comparer à « {enVigueur!.code} »
      </Button>
    </HStack>
  )
  if (!plan || plan.mode !== 'cycle' || !resultat) {
    return (
      <>
        {autrePlan}
        <Aide>Le plan « {plan?.code ?? '–'} » n'a pas de cycle par étapes : rien à comparer.</Aide>
      </>
    )
  }

  const codes = contexte.lignes.map((l) => l.code)
  const saisies = recalees ?? releve.saisies
  const synthese = analyserReleve(saisies, codes)
  // Calage : la ligne relevée le plus souvent, posée au début de son vert dans le programme.
  const reference = codes
    .filter((code) => (synthese.tops[code]?.length ?? 0) > 0 && (resultat.verts[code]?.length ?? 0) > 0)
    .sort((a, b) => synthese.tops[b]!.length - synthese.tops[a]!.length)[0]
  const debut = reference ? debutsDeVert(resultat.verts[reference]!, resultat.cycle_s)[0] : undefined
  const mesures = decaler(
    reference && debut !== undefined ? vertsDansLeCycle(saisies, { ligne: reference, debut_s: debut }, resultat.cycle_s) : {},
    decalage,
    resultat.cycle_s,
  )
  const { corrections, remarques } = proposerCorrections(plan, resultat, synthese)
  const appliquer = (aAppliquer: Correction[]) =>
    onChanger(plans.map((p, i) => (i === planActif && p.mode === 'cycle' ? aAppliquer.reduce<PlanEtapes>((q, c) => c.appliquer(q), p) : p)))

  return (
    <>
      {autrePlan}
      <HStack gap="2">
        <Chiffre valeur={synthese.cycle ? `${synthese.cycle.cycle_s} s` : '–'} libelle={synthese.cycle ? `relevé ± ${synthese.cycle.ecart_type_s} s` : 'relevé'} />
        <Chiffre valeur={`${Math.round(resultat.cycle_s * 10) / 10} s`} libelle={`plan « ${plan.code} »`} />
        <Chiffre valeur={synthese.cycle?.cycles ?? 0} libelle="cycles relevés" />
      </HStack>

      <Section libelle="Relevé, seconde par seconde">
        <TimelineReleve
          saisies={saisies}
          lignes={contexte.lignes.map((l) => ({ code: l.code, pieton: l.type === 'pieton' }))}
          onChanger={setRecalees}
        />
        {recalees && (
          <HStack gap="2">
            <Message ton="avertissement" flex="1">
              Relevé recalé, pas encore enregistré : la mesure et les corrections ci-dessous en tiennent déjà compte.
            </Message>
            <Button size="xs" variant="ghost" onClick={() => setRecalees(null)}>
              Annuler
            </Button>
            <Button size="xs" variant="solid" loading={enregistrement.isPending} onClick={() => enregistrement.mutate(recalees)}>
              Enregistrer le relevé
            </Button>
          </HStack>
        )}
        {enregistrement.error && <Message ton="erreur">{enregistrement.error.message}</Message>}
      </Section>

      <Section libelle="Programme et relevé superposés">
        <HStack gap="3" wrap="wrap">
          <Lecture instant={instant} vitesse={vitesse} onVitesse={onVitesse} />
          <HStack gap="1.5">
            <Aide>Décaler le relevé</Aide>
            <Compteur
              taille="xs"
              aria-label="Décalage du relevé sur le diagramme"
              min={-Math.round(resultat.cycle_s)}
              max={Math.round(resultat.cycle_s)}
              pas={0.5}
              unite="s"
              valeur={decalage}
              onChange={(v) => setDecalage(v ?? 0)}
            />
          </HStack>
        </HStack>
        <Chronogramme
          chronologie={{ ...resultat, duree_s: resultat.cycle_s }}
          lignes={contexte.lignes}
          instant={instant}
          onInstant={onInstant}
          mesures={mesures}
          onEtirer={(index, finActuelle, finVoulue) =>
            onChanger(plans.map((p, i) => (i === planActif && p.mode === 'cycle' ? etirerEtape(p, index, finActuelle, finVoulue) : p)))
          }
        />
        <Aide>
          Barres : le programme (tirer le bord d'une étape pour l'ajuster à la seconde, sur le brouillon). Cadres pointillés : les verts
          relevés
          {reference ? `, calés sur le début du vert de ${reference}` : ' (aucune ligne relevée à caler sur le programme)'}
          {decalage !== 0 && `, décalés de ${decalage} s`}.
        </Aide>
      </Section>

      <Section libelle={`Corrections proposées (${corrections.length})`}>
        {corrections.length === 0 && remarques.length === 0 && <Message ton="ok">Le relevé suit le programme à 2 s près.</Message>}
        {corrections.map((c) => (
          <HStack key={c.cle} gap="2">
            <Aide color="fg" flex="1">
              {c.message}
            </Aide>
            <Button size="xs" onClick={() => appliquer([c])}>
              Appliquer
            </Button>
          </HStack>
        ))}
        {corrections.length > 1 && (
          <Button size="xs" variant="solid" alignSelf="end" onClick={() => appliquer(corrections)}>
            Tout appliquer
          </Button>
        )}
        {remarques.map((r) => (
          <Message key={r} ton="avertissement">
            {r}
          </Message>
        ))}
        {corrections.length > 0 && <Aide>Appliquer modifie le brouillon du programme : à relire, puis Enregistrer.</Aide>}
      </Section>
      <Badge alignSelf="start" colorPalette={STATUTS[releve.statut].couleur}>
        Relevé {STATUTS[releve.statut].libelle}
      </Badge>
    </>
  )
}
