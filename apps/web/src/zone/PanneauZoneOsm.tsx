/**
 * Panneau de l'outil « Zone OSM » (mode Édition) : la zone d'import des feux de l'instance,
 * à partir d'un contour administratif d'OSM retouché à la main, et l'import lui-même.
 */
import { Button, HStack, Stack, Text } from '@chakra-ui/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { LonLat } from '@voirie/engine'
import type { ContourOsm, PolygonesZone, SourceZoneOsm, ZoneOsm } from '@voirie/schema'
import { api } from '../api'
import { Aide, LibelleSection, Message, Valeur } from '../ds'
import type { ModeZone } from './CalqueZoneOsm'
import { superficieKm2 } from './superficie'

/** Brouillon de la zone, partagé avec le calque de la carte. */
export interface BrouillonZone {
  polygones: PolygonesZone | null
  source: SourceZoneOsm | null
  /** Différent de la zone enregistrée. */
  modifie: boolean
}

interface Props {
  zone: ZoneOsm | undefined
  brouillon: BrouillonZone
  onBrouillon: (brouillon: BrouillonZone) => void
  mode: ModeZone
  onMode: (mode: ModeZone) => void
  /** Point choisi sur la carte en mode « choisir ». */
  point: LonLat | null
  /** Mode « dessiner » : sommets du polygone en cours, et sa fermeture. */
  trace: LonLat[]
  onFermerTrace: () => void
}

const ENCOURS = new Set(['telechargement', 'chargement'])
const LIBELLES_IMPORT = {
  inactif: '',
  telechargement: 'Téléchargement des feux…',
  chargement: 'Synchronisation des feux…',
  termine: 'Import terminé',
  echec: 'Import en échec',
} as const

const date = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '?'

export function PanneauZoneOsm({ zone, brouillon, onBrouillon, mode, onMode, point, trace, onFermerTrace }: Props) {
  const client = useQueryClient()
  const contours = useQuery({
    queryKey: ['contours-osm', point],
    queryFn: () => api.contoursOsm(point!),
    enabled: point !== null,
    staleTime: Infinity,
  })
  const reprise = useMutation({
    mutationFn: (contour: ContourOsm) => api.contourOsm(contour.osm_id),
    onSuccess: ({ polygones, nom }, contour) => {
      onBrouillon({ polygones, source: { contour: { osm_id: contour.osm_id, nom }, retouchee: false }, modifie: true })
      onMode('retoucher')
    },
  })
  const enregistrement = useMutation({
    mutationFn: () => api.enregistrerZoneOsm({ polygones: brouillon.polygones!, source: brouillon.source! }),
    onSuccess: (suivante) => {
      client.setQueryData(['zone-osm'], suivante)
      onBrouillon({ polygones: suivante.polygones, source: suivante.source, modifie: false })
    },
  })
  const suppression = useMutation({
    mutationFn: api.supprimerZoneOsm,
    onSuccess: (suivante) => {
      client.setQueryData(['zone-osm'], suivante)
      onBrouillon({ polygones: null, source: null, modifie: false })
    },
  })
  const lancement = useMutation({
    mutationFn: api.importerOsm,
    onSuccess: () => client.invalidateQueries({ queryKey: ['zone-osm'] }),
  })

  const imp = zone?.import
  const enCours = imp ? ENCOURS.has(imp.statut) : false
  const sommets = brouillon.polygones?.reduce((n, p) => n + p.length, 0) ?? 0

  return (
    <Stack gap="3" mt="2">
      <Stack gap="1">
        <LibelleSection>Dernier import</LibelleSection>
        {zone?.zone_importee ? (
          <Text textStyle="sm">
            {zone.zone_importee.nom} · <Valeur>{zone.zone_importee.superficie_km2} km²</Valeur>{' '}
            <Text as="span" color="fg.muted">
              (pointillé)
            </Text>
          </Text>
        ) : (
          <Aide>Aucun import : lancer « Importer les feux depuis OSM ».</Aide>
        )}
        {zone && (
          <Aide>
            {date(zone.dernier_import?.importe_le)} · {zone.feux.presents} feux dans OSM, dont {zone.feux.rattaches} rattachés à
            un carrefour
            {zone.feux.absents > 0 && ` ; ${zone.feux.absents} absents (hors zone ou disparus d'OSM, gardés)`}.
          </Aide>
        )}
      </Stack>

      <Stack gap="1">
        <LibelleSection>Zone enregistrée</LibelleSection>
        {zone?.polygones ? (
          <Text textStyle="sm">
            {zone.source?.contour ? zone.source.contour.nom : 'Tracée à la main'}
            {zone.source?.retouchee && ' (retouchée)'} · <Valeur>{zone.superficie_km2} km²</Valeur>
          </Text>
        ) : (
          <Aide>Aucune : l'import garde les feux de la commune de Besançon.</Aide>
        )}
      </Stack>

      <Stack gap="1.5">
        <LibelleSection>Partir d'un contour OSM</LibelleSection>
        <HStack gap="1.5">
          <Button size="xs" variant={mode === 'choisir' ? 'solid' : 'outline'} onClick={() => onMode(mode === 'choisir' ? 'retoucher' : 'choisir')}>
            {mode === 'choisir' ? 'Annuler le choix' : 'Choisir sur la carte'}
          </Button>
        </HStack>
        {mode === 'choisir' && !point && <Aide>Cliquez dans la zone voulue : commune, intercommunalité, département…</Aide>}
        {mode === 'choisir' && point && contours.isPending && <Aide>Recherche des contours (Overpass)…</Aide>}
        {mode === 'choisir' && contours.isError && <Message ton="erreur">{contours.error.message}</Message>}
        {mode === 'choisir' &&
          contours.data?.map((c) => (
            <Button
              key={c.osm_id}
              size="xs"
              variant="ghost"
              justifyContent="space-between"
              disabled={reprise.isPending}
              onClick={() => reprise.mutate(c)}
            >
              <Text truncate>{c.nom}</Text>
              <Text color="fg.muted">{c.nature}</Text>
            </Button>
          ))}
        {reprise.isPending && <Aide>Récupération du contour (jusqu'à une minute pour une intercommunalité)…</Aide>}
        {reprise.isError && <Message ton="erreur">{reprise.error.message}</Message>}
      </Stack>

      <Stack gap="1.5">
        <LibelleSection>Dessiner à la main</LibelleSection>
        {mode === 'dessiner' ? (
          <>
            <Aide>
              Cliquez sur la carte pour poser les sommets ; cliquez sur le premier (ou Entrée) pour fermer. Le polygone
              s'ajoute au tracé.
            </Aide>
            <HStack gap="1.5">
              <Button size="xs" disabled={trace.length < 3} onClick={onFermerTrace}>
                Terminer ({trace.length} sommet{trace.length > 1 ? 's' : ''})
              </Button>
              <Button size="xs" variant="ghost" onClick={() => onMode('retoucher')}>
                Annuler
              </Button>
            </HStack>
          </>
        ) : (
          <HStack gap="1.5">
            <Button size="xs" variant="outline" onClick={() => onMode('dessiner')}>
              {brouillon.polygones ? 'Ajouter un polygone' : 'Dessiner un polygone'}
            </Button>
          </HStack>
        )}
      </Stack>

      {brouillon.polygones && (
        <Stack gap="1.5">
          <LibelleSection>Tracé</LibelleSection>
          <Text textStyle="sm">
            {brouillon.source?.contour?.nom ?? 'Tracé à la main'}
            {brouillon.source?.retouchee && ' (retouché)'} · {sommets} sommets ·{' '}
            <Valeur>~{Math.round(superficieKm2(brouillon.polygones))} km²</Valeur>
          </Text>
          <Aide>Glisser un sommet pour le caler ; glisser un « + » pour en ajouter un ; double-clic pour en retirer un.</Aide>
          {brouillon.modifie && (
            <HStack gap="1.5">
              <Button size="xs" loading={enregistrement.isPending} disabled={enCours} onClick={() => enregistrement.mutate()}>
                Enregistrer la zone
              </Button>
              <Button
                size="xs"
                variant="ghost"
                onClick={() => onBrouillon({ polygones: zone?.polygones ?? null, source: zone?.source ?? null, modifie: false })}
              >
                Annuler
              </Button>
            </HStack>
          )}
          {enregistrement.isError && <Message ton="erreur">{enregistrement.error.message}</Message>}
        </Stack>
      )}
      {zone?.polygones && !brouillon.modifie && (
        <Button
          size="xs"
          variant="ghost"
          alignSelf="flex-start"
          loading={suppression.isPending}
          disabled={enCours}
          onClick={() => {
            if (window.confirm('Supprimer la zone ? Le prochain import reviendra à la commune de Besançon.')) suppression.mutate()
          }}
        >
          Supprimer la zone
        </Button>
      )}
      {suppression.isError && <Message ton="erreur">{suppression.error.message}</Message>}

      <Stack gap="1.5" pt="2.5" borderTopWidth="1px" borderColor="border.muted">
        <LibelleSection>Import</LibelleSection>
        <Button
          size="sm"
          variant="solid"
          loading={enCours || lancement.isPending}
          loadingText={imp ? LIBELLES_IMPORT[imp.statut] : undefined}
          disabled={brouillon.modifie}
          onClick={() => lancement.mutate()}
        >
          Importer les feux de la zone
        </Button>
        {brouillon.modifie && <Aide>Enregistrez d'abord la zone.</Aide>}
        <Aide>
          Une seule requête légère, qui ne prend que les feux : aucun feu rattaché n'est supprimé ni détaché, ceux qui sortent
          de la zone sont marqués absents. Les voies (et le tram) se chargent ensuite à la demande, autour du carrefour qu'on
          détecte ou qu'on compose.
        </Aide>
        {imp?.statut === 'termine' && imp.bilan && (
          <Message ton="ok">
            Terminé ({date(imp.fin)}) : {imp.bilan.feux.presents} feux dans la zone, {imp.bilan.feux.nouveaux} nouveaux,{' '}
            {imp.bilan.feux.disparus} sortis ou disparus.
          </Message>
        )}
        {imp?.statut === 'echec' && <Message ton="erreur">Échec : {imp.erreur}</Message>}
        {lancement.isError && <Message ton="erreur">{lancement.error.message}</Message>}
      </Stack>
    </Stack>
  )
}
