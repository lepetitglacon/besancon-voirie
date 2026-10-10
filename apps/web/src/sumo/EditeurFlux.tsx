import type { FluxSumo } from '@voirie/schema'
import { Box, Button, Grid, HStack, IconButton, Input, Stack, Text } from '@chakra-ui/react'
import { useMap } from 'react-map-gl/maplibre'
import { Aide, Pastille } from '../ds'
import { etatSumo, useEtatSumo } from './etat'
import { heure } from './indicateurs'

/** « 7:30 » <-> 27000 */
const versSecondes = (texte: string) => {
  const [h, m] = texte.split(':').map(Number)
  return (h ?? 0) * 3600 + (m ?? 0) * 60
}
const versTexte = (secondes: number) => heure(secondes).padStart(5, '0')

/**
 * Flux ajoutés à la main : « de telle heure à telle heure, x voitures partent d'ici vers là-bas ».
 * Origine et destination se placent d'un clic sur la carte ; les cercles y sont dessinés
 * (CoucheFlux). Les flux vivent dans `etatSumo` pendant que le formulaire est ouvert.
 */
export function EditeurFlux() {
  const flux = useEtatSumo((e) => e.flux)
  const choixPoint = useEtatSumo((e) => e.choixPoint)
  const { current: carte } = useMap()

  const modifier = (k: number, changement: Partial<FluxSumo>) =>
    etatSumo.modifier((e) => ({ flux: e.flux.map((f, i) => (i === k ? { ...f, ...changement } : f)) }))

  const ajouter = () => {
    // Au centre de la vue, décalés : à placer ensuite d'un clic.
    const centre = carte?.getCenter() ?? { lng: 6.024, lat: 47.24 }
    etatSumo.modifier((e) => ({
      flux: [
        ...e.flux,
        {
          nom: '',
          origine: [Number((centre.lng - 0.01).toFixed(6)), Number(centre.lat.toFixed(6))],
          destination: [Number((centre.lng + 0.01).toFixed(6)), Number(centre.lat.toFixed(6))],
          rayon: 500,
          debut: 8 * 3600,
          fin: 9 * 3600,
          voitures: 300,
        },
      ],
      choixPoint: { flux: e.flux.length, bout: 'origine' },
    }))
  }

  return (
    <Stack gap="2">
      {flux.map((f, k) => (
        <Stack key={k} gap="1.5" p="2" borderRadius="l2" borderWidth="1px" borderColor="border.muted">
          <HStack gap="1.5">
            <Text textStyle="xs" fontWeight="semibold" flexShrink={0}>
              Flux {k + 1}
            </Text>
            <Input
              size="2xs"
              placeholder="Nom (facultatif)"
              aria-label={`Nom du flux ${k + 1}`}
              value={f.nom}
              onChange={(e) => modifier(k, { nom: e.currentTarget.value })}
            />
            <IconButton
              size="2xs"
              variant="ghost"
              aria-label={`Retirer le flux ${k + 1}`}
              onClick={() => etatSumo.modifier((e) => ({ flux: e.flux.filter((_, i) => i !== k), choixPoint: null }))}
            >
              ✕
            </IconButton>
          </HStack>
          <HStack gap="1.5">
            {(['origine', 'destination'] as const).map((bout) => {
              const actif = choixPoint?.flux === k && choixPoint.bout === bout
              return (
                <Button
                  key={bout}
                  size="2xs"
                  flex="1"
                  variant={actif ? 'solid' : 'outline'}
                  onClick={() => etatSumo.modifier({ choixPoint: actif ? null : { flux: k, bout } })}
                >
                  <Pastille couleur={bout === 'origine' ? '#2563eb' : '#dc2626'} />
                  {actif ? 'Cliquer sur la carte…' : bout === 'origine' ? 'Origine' : 'Destination'}
                </Button>
              )
            })}
          </HStack>
          <Grid templateColumns="1fr 1fr 1fr 1fr" gap="1.5" alignItems="end">
            <Box>
              <Aide>De</Aide>
              <Input size="2xs" type="time" aria-label={`Début du flux ${k + 1}`} value={versTexte(f.debut)}
                onChange={(e) => modifier(k, { debut: versSecondes(e.currentTarget.value) })} />
            </Box>
            <Box>
              <Aide>À</Aide>
              <Input size="2xs" type="time" aria-label={`Fin du flux ${k + 1}`} value={versTexte(f.fin)}
                borderColor={f.fin <= f.debut ? 'red.solid' : undefined}
                onChange={(e) => modifier(k, { fin: versSecondes(e.currentTarget.value) })} />
            </Box>
            <Box>
              <Aide>Voitures</Aide>
              <Input size="2xs" type="number" min={1} aria-label={`Voitures du flux ${k + 1}`} value={f.voitures}
                onChange={(e) => modifier(k, { voitures: Math.max(1, Math.round(Number(e.currentTarget.value) || 1)) })} />
            </Box>
            <Box>
              <Aide>Rayon (m)</Aide>
              <Input size="2xs" type="number" min={50} step={50} aria-label={`Rayon du flux ${k + 1}`} value={f.rayon}
                onChange={(e) => modifier(k, { rayon: Math.min(5000, Math.max(50, Number(e.currentTarget.value) || 500)) })} />
            </Box>
          </Grid>
        </Stack>
      ))}
      <Button size="2xs" variant="outline" onClick={ajouter}>
        Ajouter un flux
      </Button>
      <Aide>
        Chaque voiture part d'une rue tirée dans le cercle bleu et va vers une rue du cercle rouge ; départs répartis
        sur la plage. S'ajoute à la demande du matin, du midi et du soir.
      </Aide>
    </Stack>
  )
}
