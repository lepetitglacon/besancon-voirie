/**
 * Section « Profil en travers » de la popup d'un tronçon : vignette du profil théorique
 * (Streetmix), emprise par mode comparée au profil estimé d'après les voies, et accès à
 * l'éditeur — docs/integration-streetmix.md.
 */
import { Box, Button, Grid, HStack, Image, Spinner, Text } from '@chakra-ui/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MODES_EMPRISE, type ModeEmprise } from '@voirie/engine'
import type { RepartitionProfil } from '@voirie/schema'
import { useState } from 'react'
import { api, type Troncon } from '../../api'
import { Aide, Message, Section, notifications } from '../../ds'
import { EditeurStreetmix } from './EditeurStreetmix'
import { URL_STREETMIX } from './protocole'

const LIBELLES: Record<ModeEmprise, string> = {
  pieton: 'Piétons',
  velo: 'Vélos',
  voiture: 'Voitures',
  bus: 'Bus',
  tram: 'Tram',
  stationnement: 'Stationnement',
  vegetal: 'Végétal',
  autre: 'Autre',
}

const metres = (valeur: number) => `${valeur.toFixed(1).replace('.', ',')} m`

/** Emprise de chaque mode : théorique, estimée d'après les voies, et l'écart. */
function Comparaison({ theorique, estime }: { theorique: RepartitionProfil | null; estime: RepartitionProfil }) {
  const modes = MODES_EMPRISE.filter((m) => estime[m] > 0 || (theorique?.[m] ?? 0) > 0)
  if (modes.length === 0) return null
  return (
    <Grid templateColumns={theorique ? '1fr auto auto auto' : '1fr auto'} columnGap="3" rowGap="0.5" textStyle="xs">
      <Text color="fg.muted">Emprise</Text>
      {theorique && <Text color="fg.muted">Théorique</Text>}
      <Text color="fg.muted">Estimée</Text>
      {theorique && <Text color="fg.muted">Écart</Text>}
      {modes.map((m) => {
        const ecart = theorique ? theorique[m] - estime[m] : 0
        return [
          <Text key={`${m}-libelle`}>{LIBELLES[m]}</Text>,
          theorique && (
            <Text key={`${m}-theorique`} textAlign="end">
              {metres(theorique[m])}
            </Text>
          ),
          <Text key={`${m}-estime`} textAlign="end">
            {metres(estime[m])}
          </Text>,
          theorique && (
            <Text key={`${m}-ecart`} textAlign="end" color={Math.abs(ecart) < 0.05 ? 'fg.muted' : ecart > 0 ? 'fg.success' : 'fg.error'}>
              {Math.abs(ecart) < 0.05 ? '=' : `${ecart > 0 ? '+' : '−'}${metres(Math.abs(ecart))}`}
            </Text>
          ),
        ]
      })}
    </Grid>
  )
}

export function SectionProfil({ troncon }: { troncon: Troncon }) {
  const t = troncon.properties
  const queryClient = useQueryClient()
  const [editeurOuvert, setEditeurOuvert] = useState(false)
  const donnees = useQuery({
    queryKey: ['profil-troncon', troncon.id, t.profil_theorique_id, t.profil_inverse],
    queryFn: () => api.profilTroncon(troncon.id),
  })
  const detachement = useMutation({
    mutationFn: (profilId: string) => api.detacherProfil(profilId, troncon.id),
    onSuccess: () => Promise.all(['profil-troncon', 'reseau'].map((cle) => queryClient.invalidateQueries({ queryKey: [cle] }))),
    onError: (erreur: Error) => notifications.create({ type: 'error', title: 'Profil non détaché', description: erreur.message }),
  })
  const profil = donnees.data?.profil ?? null

  return (
    <Section libelle="Profil en travers">
      {donnees.isPending ? (
        <Spinner size="xs" />
      ) : donnees.error ? (
        <Message ton="erreur">{donnees.error.message}</Message>
      ) : (
        <>
          {profil?.image ? (
            <Box
              as="button"
              title="Modifier dans Streetmix"
              borderWidth="1px"
              borderRadius="md"
              overflow="hidden"
              bg="bg.subtle"
              cursor={URL_STREETMIX ? 'pointer' : 'default'}
              onClick={() => URL_STREETMIX && setEditeurOuvert(true)}
            >
              <Image src={profil.image} alt={`Profil théorique de ${t.nom ?? 'la rue'}`} maxH="36" w="full" objectFit="contain" />
            </Box>
          ) : (
            !profil && <Aide>Aucun profil théorique : l’éditeur part du profil estimé d’après les voies et les tags OSM.</Aide>
          )}
          {profil && (
            <Aide>
              {profil.nom ?? 'Profil sans nom'} · {metres(profil.largeur_m)} · suivi par {profil.troncons} tronçon(s)
              {donnees.data.inverse && ' · lu depuis l’autre bout'}
            </Aide>
          )}
          <Comparaison theorique={donnees.data.repartition.theorique} estime={donnees.data.repartition.estime} />
          <HStack gap="2">
            <Button size="xs" variant="outline" disabled={!URL_STREETMIX} onClick={() => setEditeurOuvert(true)}>
              {profil ? 'Modifier dans Streetmix' : 'Dessiner dans Streetmix'}
            </Button>
            {profil && (
              <Button
                size="xs"
                variant="plain"
                colorPalette="red"
                loading={detachement.isPending}
                title="Ce tronçon ne suivra plus ce profil ; un profil que plus aucun tronçon ne suit est supprimé"
                onClick={() => window.confirm('Ce tronçon ne suivra plus ce profil théorique. Continuer ?') && detachement.mutate(profil.id)}
              >
                Détacher
              </Button>
            )}
          </HStack>
          {!URL_STREETMIX && <Aide>Éditeur indisponible : VITE_STREETMIX_URL absent du .env (docs/integration-streetmix.md).</Aide>}
          {editeurOuvert && <EditeurStreetmix troncon={troncon} donnees={donnees.data} onFermer={() => setEditeurOuvert(false)} />}
        </>
      )}
    </Section>
  )
}
