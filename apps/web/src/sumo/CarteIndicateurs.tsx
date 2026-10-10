import type { EssaiSumo, TronconSumo } from '@voirie/schema'
import { Box, Button, Grid, HStack, Stack, Table, Text, type BoxProps } from '@chakra-ui/react'
import { useMemo } from 'react'
import { Aide, Bascule, Pastille, Section, Segments } from '../ds'
import { Courbe } from './Courbe'
import { FicheVoiture } from './FicheVoiture'
import { etatSumo, tranche, useEtatSumo } from './etat'
import {
  formater,
  heure,
  INDICATEURS,
  LIBELLES_STATISTIQUE,
  type CleIndicateur,
  type Series,
  type Statistique,
} from './indicateurs'
import { COULEUR_FLUX, COULEURS_ETAT, COULEURS_MOTIF, LIBELLES_MOTIF, type Vehicules } from './vehicules'

interface Props extends BoxProps {
  essai: EssaiSumo | undefined
  troncons: TronconSumo[] | undefined
  series: Series | undefined
  vehicules: Vehicules | undefined
  chargementVehicules: boolean
}

/** Carte de droite du mode SUMO : indicateur affiché, légende, et fiche du tronçon choisi. */
export function CarteIndicateurs({ essai, troncons, series, vehicules, chargementVehicules, ...props }: Props) {
  const afficherTroncons = useEtatSumo((e) => e.afficherTroncons)
  const afficherVehicules = useEtatSumo((e) => e.afficherVehicules)
  const couleurVehicules = useEtatSumo((e) => e.couleurVehicules)
  const vehicule = useEtatSumo((e) => e.vehicule)
  const cle = useEtatSumo((e) => e.indicateur)
  const statistique = useEtatSumo((e) => e.statistique)
  const choisi = useEtatSumo((e) => e.troncon)
  const indicateur = INDICATEURS[cle]
  const statistiques: Statistique[] = ['instant', ...(Object.keys(indicateur.agregats) as Statistique[])]
  const troncon = choisi === null ? undefined : troncons?.[choisi]

  return (
    <Box bg="bg.panel" borderRadius="l3" boxShadow="carte" p="12px 14px" overflowY="auto" {...props}>
      <Stack gap="3.5">
        <Section libelle="Calques">
          <Bascule size="sm" coche={afficherTroncons} onChange={(v) => etatSumo.modifier({ afficherTroncons: v })}>
            Tronçons
          </Bascule>
          <Bascule
            size="sm"
            coche={afficherVehicules}
            disabled={!essai?.vehicules}
            onChange={(v) => etatSumo.modifier({ afficherVehicules: v })}
          >
            Voitures{essai?.vehicules && ` (${essai.vehicules.nombre.toLocaleString('fr-FR')})`}
          </Bascule>
          {!essai?.vehicules && essai && <Aide>Essai sans voitures enregistrées : le relancer pour les voir une à une.</Aide>}
          {chargementVehicules && <Aide>Chargement des voitures…</Aide>}
          {essai?.vehicules && afficherVehicules && (
            <>
              <Segments
                size="xs"
                fitted
                aria-label="Couleur des voitures"
                valeur={couleurVehicules}
                onChange={(c) => etatSumo.modifier({ couleurVehicules: c })}
                options={[
                  { valeur: 'etat', libelle: 'Roule / arrêtée' },
                  { valeur: 'motif', libelle: 'Motif' },
                ]}
              />
              <HStack as="ul" rowGap="1" columnGap="2.5" wrap="wrap" listStyleType="none" textStyle="xs">
                {(couleurVehicules === 'etat'
                  ? [
                      { libelle: 'roule', couleur: COULEURS_ETAT.roule },
                      { libelle: 'arrêtée', couleur: COULEURS_ETAT.arretee },
                    ]
                  : essai.vehicules.motifs.map((m) => ({
                      libelle: LIBELLES_MOTIF[m] ?? (m.startsWith('flux') ? `Flux ${m.slice(4)}` : m),
                      couleur: COULEURS_MOTIF[m] ?? COULEUR_FLUX,
                    }))
                ).map((l) => (
                  <HStack as="li" key={l.libelle} gap="1">
                    <Pastille couleur={l.couleur} />
                    {l.libelle}
                  </HStack>
                ))}
              </HStack>
              <Aide>
                Reconstituées d'après l'heure de passage sur chaque tronçon : vitesse autorisée, puis file au bout du
                tronçon. Clic sur une voiture : son itinéraire.
              </Aide>
            </>
          )}
        </Section>

        {vehicules && vehicule !== null && vehicule < vehicules.nombre && <FicheVoiture vehicules={vehicules} v={vehicule} />}

        <Section libelle="Indicateur">
          <Grid templateColumns="1fr 1fr" gap="1">
            {Object.values(INDICATEURS).map((ind) => (
              <Button
                key={ind.cle}
                size="xs"
                variant={ind.cle === cle ? 'solid' : 'outline'}
                justifyContent="flex-start"
                onClick={() =>
                  etatSumo.modifier((e) => ({
                    indicateur: ind.cle,
                    // Un agrégat que le nouvel indicateur n'a pas : retour à l'instant.
                    statistique: e.statistique === 'instant' || ind.agregats[e.statistique] ? e.statistique : 'instant',
                  }))
                }
              >
                {ind.libelle}
              </Button>
            ))}
          </Grid>
          <Aide>{indicateur.aide}</Aide>
        </Section>

        <Section libelle="Valeur affichée">
          <Segments
            size="xs"
            fitted
            aria-label="Valeur affichée"
            valeur={statistique}
            onChange={(s) => etatSumo.modifier({ statistique: s })}
            options={statistiques.map((s) => ({ valeur: s, libelle: LIBELLES_STATISTIQUE[s] }))}
          />
          <Aide>
            {statistique === 'instant'
              ? 'Tranche de 5 min de la timeline. Épaisseur : débit.'
              : `${LIBELLES_STATISTIQUE[statistique]} sur tout l'essai, par tranche de 5 min. Épaisseur : débit le plus fort.`}
          </Aide>
          <HStack as="ul" rowGap="1" columnGap="2.5" wrap="wrap" listStyleType="none" textStyle="xs">
            {indicateur.paliers.map((palier) => (
              <HStack as="li" key={palier.libelle} gap="1">
                <Pastille forme="trait" couleur={palier.couleur} />
                {palier.libelle}
              </HStack>
            ))}
          </HStack>
        </Section>

        {essai && series && troncon ? (
          <FicheTroncon essai={essai} series={series} troncon={troncon} cle={cle} />
        ) : (
          <Aide>Cliquer sur un tronçon pour voir tous ses indicateurs et leur évolution.</Aide>
        )}
      </Stack>
    </Box>
  )
}

interface PropsFiche {
  essai: EssaiSumo
  series: Series
  troncon: TronconSumo
  cle: CleIndicateur
}

/** Tous les indicateurs d'un tronçon : à l'instant de la timeline et sur l'essai, puis la courbe de l'indicateur. */
function FicheTroncon({ essai, series, troncon, cle }: PropsFiche) {
  const t = useEtatSumo((e) => tranche(e.temps, essai.debut, essai.pas, essai.tranches))
  const indicateur = INDICATEURS[cle]
  const courbe = useMemo(
    () => Array.from({ length: essai.tranches }, (_, k) => series.valeur(cle, k, troncon)),
    [essai.tranches, series, cle, troncon],
  )
  const debutTranche = essai.debut + t * essai.pas

  return (
    <Section libelle="Tronçon" pt="2.5" borderTopWidth="1px" borderColor="border.muted">
      <HStack justify="space-between" align="start">
        <Box>
          <Text textStyle="sm" fontWeight="semibold">
            {troncon.nom || 'Sans nom'}
          </Text>
          <Aide>
            {Math.round(troncon.longueur)} m · {troncon.voies} voie(s) · {troncon.vmax} km/h autorisés ·{' '}
            {troncon.total.toLocaleString('fr-FR')} voitures sur l'essai
          </Aide>
        </Box>
        <Button size="2xs" variant="ghost" onClick={() => etatSumo.modifier({ troncon: null })}>
          Fermer
        </Button>
      </HStack>

      <Table.Root size="sm" variant="line" textStyle="xs">
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeader ps="0" />
            <Table.ColumnHeader textAlign="end">
              {heure(debutTranche)} – {heure(debutTranche + essai.pas)}
            </Table.ColumnHeader>
            <Table.ColumnHeader textAlign="end" pe="0">
              Sur l'essai
            </Table.ColumnHeader>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {Object.values(INDICATEURS).map((ind) => (
            <Table.Row
              key={ind.cle}
              fontWeight={ind.cle === cle ? 'semibold' : undefined}
              cursor="pointer"
              onClick={() => etatSumo.modifier({ indicateur: ind.cle, statistique: 'instant' })}
            >
              <Table.Cell ps="0" verticalAlign="top">
                {ind.libelle}
              </Table.Cell>
              <Table.Cell textAlign="end" whiteSpace="nowrap" verticalAlign="top">
                {formater(ind, series.valeur(ind.cle, t, troncon))}
              </Table.Cell>
              <Table.Cell textAlign="end" pe="0" whiteSpace="nowrap" verticalAlign="top">
                {(Object.entries(ind.agregats) as [Exclude<Statistique, 'instant'>, (t: TronconSumo) => number | null][]).map(
                  ([s, f]) => (
                    <Box key={s}>
                      {s !== 'moy' && (
                        <Box as="span" color="fg.muted">
                          {s}{' '}
                        </Box>
                      )}
                      {formater(ind, f(troncon))}
                    </Box>
                  ),
                )}
              </Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table.Root>

      <Box color="fg.muted">
        <Courbe
          series={[{ valeurs: courbe, couleur: 'var(--chakra-colors-brand-solid)', remplie: true, libelle: indicateur.libelle }]}
          curseur={t}
          onChoisir={(k) => etatSumo.modifier({ temps: essai.debut + k * essai.pas, statistique: 'instant' })}
        />
        <HStack justify="space-between">
          <Aide>
            {indicateur.libelle} ({indicateur.unite}), {heure(essai.debut)} – {heure(essai.fin)}
          </Aide>
          <Aide>max {formater(indicateur, Math.max(0, ...courbe.map((v) => v ?? 0)))}</Aide>
        </HStack>
      </Box>
      <Aide>Arête SUMO {troncon.id}</Aide>
    </Section>
  )
}
