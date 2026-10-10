import type { EssaiSumo } from '@voirie/schema'
import { Box, HStack, IconButton, Stack, Text, type BoxProps } from '@chakra-ui/react'
import { useEffect } from 'react'
import { Aide, Chiffre, Selecteur } from '../ds'
import { Courbe } from './Courbe'
import { etatSumo, tranche, useEtatSumo } from './etat'
import { heure } from './indicateurs'

/** Secondes simulées par seconde réelle : à 1 à 15, on suit les voitures ; au-delà, la journée. */
const VITESSES = [1, 5, 15, 60, 300, 900, 1800]

/** Fin de l'essai, ou heure de l'arrêt anticipé de la simulation. */
const finEssai = (essai: EssaiSumo) => Math.min(essai.fin, essai.bilan.finSimulee)

/** Avance l'heure de la timeline à chaque image pendant la lecture ; s'arrête à la fin de l'essai. */
function useLecture(essai: EssaiSumo | undefined) {
  const lecture = useEtatSumo((e) => e.lecture)
  useEffect(() => {
    if (!lecture || !essai) return
    let precedente = performance.now()
    let image = requestAnimationFrame(function avancer(maintenant) {
      const ecoule = (maintenant - precedente) / 1000
      precedente = maintenant
      const { temps, vitesse } = etatSumo.lire()
      const suivant = temps + ecoule * vitesse
      if (suivant >= finEssai(essai)) {
        etatSumo.modifier({ temps: finEssai(essai), lecture: false })
        return
      }
      etatSumo.modifier({ temps: suivant })
      image = requestAnimationFrame(avancer)
    })
    return () => cancelAnimationFrame(image)
  }, [lecture, essai])
}

interface Props extends BoxProps {
  essai: EssaiSumo
}

/** Carte du bas du mode SUMO : lecture de l'essai, heure, et état de la ville à cet instant. */
export function Timeline({ essai, ...props }: Props) {
  useLecture(essai)
  const temps = useEtatSumo((e) => e.temps)
  const lecture = useEtatSumo((e) => e.lecture)
  const vitesse = useEtatSumo((e) => e.vitesse)
  const t = tranche(temps, essai.debut, essai.pas, essai.tranches)
  const { globales } = essai
  const fin = finEssai(essai)
  const nombre = (n: number | undefined) => (n ?? 0).toLocaleString('fr-FR')

  const lire = () =>
    etatSumo.modifier((e) => ({
      lecture: !e.lecture,
      // Relancer depuis la fin : on repart du début.
      temps: !e.lecture && e.temps >= fin ? essai.debut : e.temps,
    }))

  return (
    <Box bg="bg.panel" borderRadius="l3" boxShadow="carte" p="10px 14px" {...props}>
      <Stack gap="2">
        <HStack gap="3" wrap="wrap">
          <IconButton size="sm" aria-label={lecture ? 'Pause' : 'Lecture'} onClick={lire}>
            {lecture ? '❚❚' : '▶'}
          </IconButton>
          <Text fontFamily="mono" fontWeight="semibold" fontSize="xl" fontVariantNumeric="tabular-nums" minW="56px">
            {heure(temps)}
          </Text>
          <Selecteur
            size="xs"
            w="120px"
            aria-label="Vitesse de lecture"
            valeur={vitesse}
            onChange={(v) => etatSumo.modifier({ vitesse: Number(v) })}
          >
            {VITESSES.map((v) => (
              <option key={v} value={v}>
                1 s = {v < 60 ? `${v} s` : v < 3600 ? `${v / 60} min` : `${v / 3600} h`}
              </option>
            ))}
          </Selecteur>
          <HStack gap="1.5" flex="1" justify="flex-end" minW="fit-content">
            <Chiffre valeur={nombre(globales.enRoute[t])} libelle="en route" flex="0" minW="72px" />
            <Chiffre valeur={nombre(globales.aLArret[t])} libelle="à l'arrêt" flex="0" minW="72px" />
            <Chiffre valeur={`${globales.vitesse[t] ?? 0}`} libelle="km/h moy." flex="0" minW="64px" />
            <Chiffre valeur={nombre(globales.arrives[t])} libelle="arrivées" flex="0" minW="72px" />
            <Chiffre valeur={nombre(globales.teleportations[t])} libelle="téléport." flex="0" minW="64px" />
          </HStack>
        </HStack>
        <Box color="fg.muted">
          <Courbe
            h="40px"
            series={[
              { valeurs: globales.enRoute, couleur: 'var(--chakra-colors-brand-solid)', remplie: true, libelle: 'Voitures en route' },
              { valeurs: globales.aLArret, couleur: '#dc2626', remplie: true, libelle: "Voitures à l'arrêt" },
            ]}
            curseur={t}
            onChoisir={(k) => etatSumo.modifier({ temps: Math.min(fin, essai.debut + k * essai.pas) })}
          />
          <input
            type="range"
            min={essai.debut}
            max={fin}
            step={60}
            value={Math.round(temps)}
            aria-label="Heure simulée"
            style={{ width: '100%', display: 'block' }}
            onChange={(e) => etatSumo.modifier({ temps: Number(e.currentTarget.value) })}
          />
          <HStack justify="space-between">
            <Aide>{heure(essai.debut)}</Aide>
            <Aide>
              <Box as="span" color="brand.solid">
                ━
              </Box>{' '}
              en route ·{' '}
              <Box as="span" color="#dc2626">
                ━
              </Box>{' '}
              à l'arrêt · mesures par tranches de {essai.pas / 60} min
            </Aide>
            <Aide>{heure(fin)}</Aide>
          </HStack>
        </Box>
      </Stack>
    </Box>
  )
}
