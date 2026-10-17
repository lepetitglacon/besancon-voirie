import { Badge, Button, HStack, Stack, Table, Text } from '@chakra-ui/react'
import { planEnVigueur, positionCycle } from '@voirie/engine'
import { typeLigne, type FicheCarrefour as Fiche, type FichePlan } from '@voirie/schema'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Chronogramme } from '../configuration/Chronogramme'
import { Lecture } from '../configuration/Lecture'
import { SIGNAUX } from '../configuration/libelles'
import { Aide, Bascule, Chiffre, IconeFeu, Pastille, Section, Valeur } from '../ds'
import { useMaintenant } from '../tempsReel/useMaintenant'
import { libellePlage, NATURES, STATUTS } from './libelles'

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

/** Largeur du dessin, proche de sa largeur affichée dans la fiche : le texte garde sa taille. */
const LARGEUR_DIAGRAMME = 640

const date = (iso: string) => new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })

/**
 * Fiche d'un carrefour (`/carrefours/:slug`) : ce qui est saisi (branches, lignes, plans), le diagramme
 * de feux de chaque plan, son calage sur l'heure réelle, et les relevés terrain.
 */
export function FicheCarrefour({ fiche }: { fiche: Fiche }) {
  const { carrefour, branches, lignes, plans, releves } = fiche
  const maintenant = useMaintenant(true, 10_000)
  const enVigueur = planEnVigueur(plans, maintenant)
  const [lon, lat] = carrefour.position
  const mode = carrefour.controleur.mode && CONTROLEURS[carrefour.controleur.mode]

  return (
    <Stack gap="5">
      <Stack gap="2">
        <HStack gap="1.5" wrap="wrap">
          <Pastille couleur={`statut.${carrefour.statut}`} />
          <Text textStyle="sm" color="fg.secondary">
            {NATURES[carrefour.nature]} · programmation {STATUTS[carrefour.statut]}
          </Text>
          {carrefour.pres_tram && <Badge colorPalette="orange">Tram à proximité</Badge>}
          {mode && <Badge colorPalette="gray">Contrôleur {mode}</Badge>}
        </HStack>
        <HStack gap="2">
          <Chiffre valeur={carrefour.nb_feux} libelle="feux" />
          <Chiffre valeur={branches.length} libelle="branches" />
          <Chiffre valeur={lignes.length} libelle="lignes de feux" />
          <Chiffre valeur={releves.length} libelle="relevés" />
        </HStack>
        <HStack gap="2" wrap="wrap">
          <Button asChild size="xs" variant="outline">
            <Link to={`/#18/${lat}/${lon}`}>Voir sur la carte</Link>
          </Button>
          <Button asChild size="xs" variant="outline">
            <Link to={`/terrain/${carrefour.id}`}>
              <IconeFeu /> Relever ce carrefour
            </Link>
          </Button>
        </HStack>
      </Stack>

      <Section libelle={`Plans de feux (${plans.length})`}>
        {plans.length === 0 && <Aide>Programme pas encore saisi : il se déduit des relevés terrain, ou se saisit dans la configuration.</Aide>}
        {plans.map((plan) => (
          <Plan key={plan.code} plan={plan} lignes={lignes} enVigueur={plan.code === enVigueur?.code} />
        ))}
      </Section>

      {branches.length > 0 && (
        <Section libelle={`Branches (${branches.length})`}>
          <Table.Root size="sm">
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeader>Branche</Table.ColumnHeader>
                <Table.ColumnHeader textAlign="end">Voies entrantes</Table.ColumnHeader>
                <Table.ColumnHeader textAlign="end">sortantes</Table.ColumnHeader>
                <Table.ColumnHeader textAlign="end">Passages piétons</Table.ColumnHeader>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {branches.map((b) => (
                <Table.Row key={b.code}>
                  <Table.Cell>
                    <Text as="span" fontWeight="semibold">
                      {b.code}
                    </Text>
                    {b.nom && ` · ${b.nom}`}
                  </Table.Cell>
                  <Table.Cell textAlign="end">{b.entrantes}</Table.Cell>
                  <Table.Cell textAlign="end">{b.sortantes}</Table.Cell>
                  <Table.Cell textAlign="end">{b.passages}</Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>
        </Section>
      )}

      {lignes.length > 0 && (
        <Section libelle={`Lignes de feux (${lignes.length})`}>
          <Table.Root size="sm">
            <Table.Body>
              {lignes.map((l) => (
                <Table.Row key={l.code}>
                  <Table.Cell fontWeight="semibold">{l.code}</Table.Cell>
                  <Table.Cell color="fg.secondary">{SIGNAUX[l.signal].libelle}</Table.Cell>
                  <Table.Cell>{l.traverse ? `traverse ${l.traverse}` : l.mouvements.join(', ')}</Table.Cell>
                  <Table.Cell textAlign="end" color="fg.muted">
                    {l.feux === 0 ? '–' : `${l.feux} feu${l.feux > 1 ? 'x' : ''}`}
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>
        </Section>
      )}

      <Section libelle={`Relevés terrain (${releves.length})`}>
        {releves.length === 0 && <Aide>Aucun relevé : « Relever ce carrefour » sur un téléphone, devant le feu.</Aide>}
        {releves.map((r) => (
          <HStack key={r.id} gap="2" textStyle="xs">
            <Text flex="1">
              {date(r.observe_le)}
              {r.pseudo && ` · ${r.pseudo}`}
            </Text>
            <Valeur>{r.cycle_s ? `cycle ${r.cycle_s} s · ${r.cycles_observes} cycles` : 'cycle non mesuré'}</Valeur>
            <Badge colorPalette={r.statut === 'valide' ? 'green' : 'gray'}>{r.statut === 'valide' ? 'validé' : 'à relire'}</Badge>
          </HStack>
        ))}
      </Section>
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
    <Stack gap="2" p="3" borderWidth="1px" borderColor={enVigueur ? 'feu.vert' : 'border.subtle'} borderRadius="l2">
      <HStack gap="1.5" wrap="wrap">
        <Text fontWeight="semibold">« {plan.code} »</Text>
        {enVigueur && <Badge colorPalette="green">en vigueur</Badge>}
        <Text textStyle="xs" color="fg.secondary">
          {MODES[plan.mode]}
          {plan.cycle_s ? ` · cycle ${Math.round(plan.cycle_s * 10) / 10} s` : ''}
        </Text>
        {plan.synchro && plan.synchro.confiance !== 'inconnue' && (
          <Badge colorPalette={plan.synchro.confiance === 'synchronisee' ? 'green' : 'blue'}>
            {plan.synchro.confiance === 'synchronisee' ? 'calé sur l’heure réelle' : 'calage estimé'}
          </Badge>
        )}
      </HStack>
      <Aide>{plan.plages.map(libellePlage).join(' · ')}</Aide>
      {(plan.appels.length > 0 || plan.priorites.length > 0) && (
        <Aide>
          {plan.appels.length > 0 && `Étapes sur appel : ${plan.appels.join(', ')}. `}
          {plan.priorites.length > 0 && `Priorité hors cycle : ${plan.priorites.join(', ')}.`}
        </Aide>
      )}
      {diagramme && (
        <>
          <HStack gap="3" wrap="wrap">
            {!heureReelle && <Lecture instant={instant} vitesse={vitesse} onVitesse={setVitesse} />}
            {decalage !== null && (
              <Bascule coche={heureReelle} onChange={(coche) => (setHeureReelle(coche), setVitesse(null))}>
                Heure réelle
              </Bascule>
            )}
          </HStack>
          <Chronogramme
            chronologie={{ ...diagramme, duree_s: diagramme.cycle_s }}
            lignes={lignes.map((l) => ({ code: l.code, type: typeLigne(l.signal) }))}
            instant={instant}
            onInstant={(t) => (setHeureReelle(false), setInstant(t))}
            largeur={LARGEUR_DIAGRAMME}
          />
        </>
      )}
    </Stack>
  )
}
