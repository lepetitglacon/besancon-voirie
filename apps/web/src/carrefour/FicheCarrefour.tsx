import { Badge, HStack, Stack, Text } from '@chakra-ui/react'
import { useQuery } from '@tanstack/react-query'
import { planEnVigueur, positionCycle } from '@voirie/engine'
import { typeLigne, type FicheCarrefour as Fiche, type FichePlan } from '@voirie/schema'
import { useEffect, useState, type ReactNode } from 'react'
import { api } from '../api'
import { Chronogramme } from '../configuration/Chronogramme'
import { Lecture } from '../configuration/Lecture'
import { SIGNAUX } from '../configuration/libelles'
import { Aide, Bascule, Chiffre, Message, Pastille, Segments, Valeur } from '../ds'
import { usePreference } from '../preferences'
import { useMaintenant } from '../tempsReel/useMaintenant'
import { libellePlage, NATURES, STATUTS } from './libelles'
import { PlanCarrefour } from './PlanCarrefour'

/** Thèmes de la fiche, dans la carte de gauche du mode Temps réel. */
type Theme = 'feux' | 'carrefour' | 'releves'
const THEMES: readonly string[] = ['feux', 'carrefour', 'releves'] satisfies Theme[]

const MODES: Record<FichePlan['mode'], string> = {
  cycle: 'cycle par étapes',
  jaune_clignotant: 'jaune clignotant',
  eteint: 'éteint',
}

const CONTROLEURS: Record<string, string> = {
  fixe: 'temps fixe',
  semi_actue: 'semi-actué',
  actue: 'actué',
}

const date = (iso: string) => new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })

interface Props {
  slug: string
  /** En tête du thème « Feux » : l'état des feux en temps réel. */
  maintenant: ReactNode
}

/**
 * Fiche d'un carrefour (`/carrefours/:slug`), rangée par thème : les feux (état maintenant, plans et
 * leur diagramme), le carrefour (plan, branches, lignes de feux), les relevés terrain.
 */
export function FicheCarrefour({ slug, maintenant }: Props) {
  const [themeLu, setTheme] = usePreference<Theme>('theme-fiche', 'feux')
  // Thème d'une version précédente (« maintenant », « plans ») : les feux.
  const theme: Theme = THEMES.includes(themeLu) ? themeLu : 'feux'
  const fiche = useQuery({ queryKey: ['fiche', slug], queryFn: () => api.fiche(slug) })
  const nombre = (n: number | undefined) => (n ? ` · ${n}` : '')
  /** Ligne de feux choisie (clic) ou survolée dans le thème Carrefour : le plan met ses liaisons en avant. */
  const [ligneChoisie, setLigneChoisie] = useState<string | null>(null)
  const [ligneSurvolee, setLigneSurvolee] = useState<string | null>(null)
  const ligne = ligneSurvolee ?? ligneChoisie

  return (
    <Stack gap="3">
      <Segments
        size="xs"
        aria-label="Thème de la fiche"
        valeur={theme}
        onChange={setTheme}
        options={[
          { valeur: 'feux', libelle: 'Feux' },
          { valeur: 'carrefour', libelle: 'Carrefour' },
          { valeur: 'releves', libelle: `Relevés${nombre(fiche.data?.releves.length)}` },
        ]}
      />
      {theme === 'feux' && maintenant}
      {fiche.isPending ? (
        <Aide>Chargement…</Aide>
      ) : fiche.isError ? (
        <Message ton="erreur">{fiche.error.message}</Message>
      ) : theme === 'feux' ? (
        <Plans fiche={fiche.data} />
      ) : theme === 'carrefour' ? (
        <Carrefour
          fiche={fiche.data}
          ligne={ligne}
          onChoisir={(code) => setLigneChoisie((actuelle) => (actuelle === code ? null : code))}
          onSurvoler={setLigneSurvolee}
        />
      ) : (
        <Releves fiche={fiche.data} />
      )}
    </Stack>
  )
}

function Plans({ fiche }: { fiche: Fiche }) {
  const maintenant = useMaintenant(true, 10_000)
  const enVigueur = planEnVigueur(fiche.plans, maintenant)
  if (fiche.plans.length === 0) {
    return <Aide>Programme pas encore saisi : il se déduit des relevés terrain, ou se saisit en mode Édition.</Aide>
  }
  return (
    <Stack gap="3" pt="3" borderTopWidth="1px" borderColor="border.muted">
      <Text textStyle="overline" color="fg.muted">
        Plans de feux
      </Text>
      {fiche.plans.map((plan) => (
        <Plan key={plan.code} plan={plan} lignes={fiche.lignes} enVigueur={plan.code === enVigueur?.code} />
      ))}
    </Stack>
  )
}

/** Un plan : plages, mode, et son diagramme de feux, lu au ralenti ou à l'heure réelle quand il est calé. */
function Plan({ plan, lignes, enVigueur }: { plan: FichePlan; lignes: Fiche['lignes']; enVigueur: boolean }) {
  const diagramme = plan.diagramme
  const decalage = plan.synchro?.decalage_s ?? null
  const [instant, setInstant] = useState(0)
  const [vitesse, setVitesse] = useState<number | null>(null)
  /** À l'heure réelle par défaut pour le plan en vigueur, s'il est calé. */
  const [heureReelle, setHeureReelle] = useState(enVigueur && decalage !== null)
  const cycle = diagramme?.cycle_s ?? 0

  useEffect(() => {
    if (cycle <= 0 || (!vitesse && !heureReelle)) return
    let precedent = performance.now()
    let image = requestAnimationFrame(function avancer(maintenant) {
      if (heureReelle && decalage !== null) setInstant(positionCycle(Date.now(), cycle, decalage))
      else setInstant((t) => (t + ((maintenant - precedent) / 1000) * (vitesse ?? 0)) % cycle)
      precedent = maintenant
      image = requestAnimationFrame(avancer)
    })
    return () => cancelAnimationFrame(image)
  }, [cycle, vitesse, heureReelle, decalage])

  return (
    <Stack gap="1.5" pb="3" borderBottomWidth="1px" borderColor="border.muted" _last={{ borderBottomWidth: 0, pb: 0 }}>
      <HStack gap="1.5" wrap="wrap">
        <Text textStyle="sm" fontWeight="semibold">
          « {plan.code} »
        </Text>
        {enVigueur && <Badge colorPalette="green">en vigueur</Badge>}
        {plan.synchro && plan.synchro.confiance !== 'inconnue' && (
          <Badge colorPalette={plan.synchro.confiance === 'synchronisee' ? 'green' : 'blue'}>
            {plan.synchro.confiance === 'synchronisee' ? 'calé' : 'calage estimé'}
          </Badge>
        )}
        <Text textStyle="xs" color="fg.secondary">
          {MODES[plan.mode]}
          {plan.cycle_s ? ` · ${Math.round(plan.cycle_s * 10) / 10} s` : ''}
        </Text>
      </HStack>
      <Aide>{plan.plages.map(libellePlage).join(' · ')}</Aide>
      {(plan.appels.length > 0 || plan.priorites.length > 0) && (
        <Aide>
          {plan.appels.length > 0 && `Sur appel : ${plan.appels.join(', ')}. `}
          {plan.priorites.length > 0 && `Priorité hors cycle : ${plan.priorites.join(', ')}.`}
        </Aide>
      )}
      {diagramme && (
        <>
          <HStack gap="3" wrap="wrap">
            {!heureReelle && <Lecture instant={instant} vitesse={vitesse} onVitesse={setVitesse} />}
            {decalage !== null && (
              <Bascule size="sm" coche={heureReelle} onChange={(coche) => (setHeureReelle(coche), setVitesse(null))}>
                Heure réelle
              </Bascule>
            )}
          </HStack>
          <Chronogramme
            chronologie={{ ...diagramme, duree_s: diagramme.cycle_s }}
            lignes={lignes.map((l) => ({ code: l.code, type: typeLigne(l.signal) }))}
            instant={instant}
            onInstant={(t) => (setHeureReelle(false), setInstant(t))}
          />
        </>
      )}
    </Stack>
  )
}

interface PropsCarrefour {
  fiche: Fiche
  /** Ligne de feux mise en avant sur le plan. */
  ligne: string | null
  onChoisir: (code: string) => void
  onSurvoler: (code: string | null) => void
}

function Carrefour({ fiche, ligne, onChoisir, onSurvoler }: PropsCarrefour) {
  const { carrefour, branches, lignes } = fiche
  const mode = carrefour.controleur.mode && CONTROLEURS[carrefour.controleur.mode]
  return (
    <Stack gap="3">
      <HStack gap="1.5" wrap="wrap">
        <Pastille couleur={`statut.${carrefour.statut}`} />
        <Text textStyle="xs" color="fg.secondary">
          {NATURES[carrefour.nature]} · programmation {STATUTS[carrefour.statut]}
        </Text>
        {carrefour.pres_tram && <Badge colorPalette="orange">Tram à proximité</Badge>}
        {mode && <Badge colorPalette="gray">Contrôleur {mode}</Badge>}
      </HStack>
      <HStack gap="2">
        <Chiffre valeur={carrefour.nb_feux} libelle="feux" />
        <Chiffre valeur={branches.length} libelle="branches" />
        <Chiffre valeur={lignes.length} libelle="lignes" />
      </HStack>
      <PlanCarrefour carrefourId={carrefour.id} ligne={ligne} onLigne={onChoisir} />

      {branches.length > 0 && (
        <Stack gap="1">
          <Text textStyle="overline" color="fg.muted">
            Branches
          </Text>
          {branches.map((b) => (
            <HStack key={b.code} gap="2" textStyle="xs" align="baseline">
              <Text fontWeight="semibold" minW="7">
                {b.code}
              </Text>
              <Text flex="1" truncate title={b.nom ?? undefined}>
                {b.nom ?? '–'}
              </Text>
              <Valeur color="fg.secondary" title="voies entrantes / sortantes · passages piétons">
                {b.entrantes}↘ {b.sortantes}↗{b.passages > 0 && ` · ${b.passages} passage${b.passages > 1 ? 's' : ''}`}
              </Valeur>
            </HStack>
          ))}
        </Stack>
      )}

      {lignes.length > 0 && (
        <Stack gap="1">
          <Text textStyle="overline" color="fg.muted">
            Lignes de feux
          </Text>
          <Aide>Survoler ou cliquer une ligne (ou un feu sur le plan) : le plan montre ses mouvements et ses feux.</Aide>
          {lignes.map((l) => (
            <HStack
              key={l.code}
              as="button"
              gap="2"
              textStyle="xs"
              align="baseline"
              textAlign="start"
              px="1.5"
              py="0.5"
              borderRadius="l1"
              cursor="pointer"
              bg={ligne === l.code ? 'brand.subtle' : undefined}
              _hover={{ bg: ligne === l.code ? 'brand.subtle' : 'bg.muted' }}
              aria-pressed={ligne === l.code}
              onClick={() => onChoisir(l.code)}
              onMouseEnter={() => onSurvoler(l.code)}
              onMouseLeave={() => onSurvoler(null)}
              onFocus={() => onSurvoler(l.code)}
              onBlur={() => onSurvoler(null)}
            >
              <Text fontWeight="semibold" minW="7">
                {l.code}
              </Text>
              <Text flex="1" truncate title={l.traverse ? `traverse ${l.traverse}` : l.mouvements.join(', ')}>
                {l.traverse ? `traverse ${l.traverse}` : l.mouvements.join(', ')}
              </Text>
              <Text color="fg.secondary">{SIGNAUX[l.signal].libelle}</Text>
            </HStack>
          ))}
        </Stack>
      )}
    </Stack>
  )
}

function Releves({ fiche }: { fiche: Fiche }) {
  if (fiche.releves.length === 0) return <Aide>Aucun relevé : « Relever » sur un téléphone, devant le feu.</Aide>
  return (
    <Stack gap="1.5">
      {fiche.releves.map((r) => (
        <HStack key={r.id} gap="2" textStyle="xs">
          <Text flex="1">
            {date(r.observe_le)}
            {r.pseudo && ` · ${r.pseudo}`}
          </Text>
          <Valeur>{r.cycle_s ? `${r.cycle_s} s · ${r.cycles_observes} cycles` : 'cycle non mesuré'}</Valeur>
          <Badge colorPalette={r.statut === 'valide' ? 'green' : 'gray'}>{r.statut === 'valide' ? 'validé' : 'à relire'}</Badge>
        </HStack>
      ))}
    </Stack>
  )
}
