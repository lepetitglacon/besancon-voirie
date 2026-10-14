import { Badge, Box, Button, chakra, HStack, Input, Kbd, Stack, Text, type BoxProps } from '@chakra-ui/react'
import { useQuery } from '@tanstack/react-query'
import type { LonLat } from '@voirie/engine'
import { Aide, CarteEnTete } from '../ds'
import { altitudes } from './altitude'
import {
  COULEUR_MESURE,
  COULEUR_MESURE_VISEE,
  denivele,
  distancesMesure,
  echantillonner,
  formaterDistance,
} from './mesure'
import type { Mesures } from './useMesures'

/** Repère du profil (unités du viewBox, mis à l'échelle de la largeur du panneau). */
const L = 600
const H = 130
const MARGE = { gauche: 40, droite: 16, haut: 30, bas: 26 }
/** Écart minimal entre deux libellés pour les afficher tous deux. */
const ECART_LIBELLES = 46

interface Props extends BoxProps {
  mesures: Mesures
  /** Centre la carte sur un point de la frise. */
  onCentrer: (points: LonLat[]) => void
}

/** Mesure de distance en édition : nom, enregistrement et frise des points. */
export function PanneauMesure({ mesures, onCentrer, ...props }: Props) {
  if (!mesures.courante) return null
  return (
    <Box {...props}>
      <CarteEnTete
        w="620px"
        maxW="calc(var(--ecran-w) - 24px)"
        surtitre={mesures.courante.id ? 'Édition de la mesure' : 'Nouvelle mesure'}
        titre={<EnTete mesures={mesures} />}
      >
        <Frise mesures={mesures} onCentrer={onCentrer} />
      </CarteEnTete>
    </Box>
  )
}

function EnTete({ mesures }: { mesures: Mesures }) {
  const { courante, modifiee } = mesures
  const assez = courante!.points.length > 1
  return (
    <HStack gap="1.5">
      <Input
        size="xs"
        maxW="220px"
        placeholder="Mesure sans nom"
        value={courante!.nom}
        onChange={(e) => mesures.renommer(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && modifiee && assez && mesures.enregistrer()}
      />
      <Button size="xs" variant="solid" disabled={!modifiee || !assez} onClick={mesures.enregistrer}>
        {!modifiee ? 'Enregistrée ✓' : courante!.id ? 'Mettre à jour' : 'Enregistrer'}
      </Button>
      <Button size="xs" variant="ghost" ms="auto" onClick={mesures.ouvrirListe}>
        ☰ Toutes les mesures
      </Button>
      <Button size="xs" variant="ghost" onClick={mesures.fermer}>
        Fermer
      </Button>
    </HStack>
  )
}

/**
 * Frise de la mesure : chaque point est placé à sa distance du départ, à l'échelle de la longueur
 * totale (un nouveau point resserre les autres sans fausser leurs écarts). Dessous, le profil
 * d'altitude lu dans les tuiles Terrarium, quand elles sont joignables.
 */
function Frise({ mesures, onCentrer }: Pick<Props, 'mesures' | 'onCentrer'>) {
  const { courante, visee } = mesures
  const points = courante!.points
  const { troncons, cumuls, total } = distancesMesure(points)
  const echantillons = echantillonner(points)
  const profil = useQuery({
    queryKey: ['altitudes', points],
    queryFn: () => altitudes(echantillons.map((e) => e.position)),
    enabled: points.length > 1,
    staleTime: Infinity,
    placeholderData: (precedent) => precedent,
  })
  // Données d'un tracé précédent : ignorées tant que le nombre d'échantillons ne correspond pas.
  const alt = profil.data?.length === echantillons.length ? profil.data : null

  const largeur = L - MARGE.gauche - MARGE.droite
  const x = (distance: number) => MARGE.gauche + (total > 0 ? (distance / total) * largeur : 0)
  const bas = H - MARGE.bas
  const min = alt ? Math.min(...alt) : 0
  const max = alt ? Math.max(...alt) : 0
  // Au moins 20 m de plage verticale : un tracé plat ne doit pas ressembler à une montagne.
  const etendue = Math.max(20, max - min)
  const plancher = (min + max) / 2 - etendue / 2
  const y = (altitude: number) => bas - ((altitude - plancher) / etendue) * (bas - MARGE.haut - 8)
  const yPoint = (i: number) => {
    if (!alt) return (MARGE.haut + bas) / 2
    const k = echantillons.findIndex((e) => e.distance >= cumuls[i]! - 1e-6)
    return y(alt[Math.max(0, k)]!)
  }

  const trace = alt && echantillons.map((e, i) => `${x(e.distance).toFixed(1)},${y(alt[i]!).toFixed(1)}`).join(' ')
  const { montee, descente } = alt ? denivele(alt) : { montee: 0, descente: 0 }

  return (
    <Stack gap="2" mt="2">
      <HStack gap="1.5">
        <Text textStyle="md" fontWeight="semibold" fontVariantNumeric="tabular-nums">
          {formaterDistance(total)}
        </Text>
        {alt && (
          <>
            <Badge colorPalette="gray" fontVariantNumeric="tabular-nums">↗ {Math.round(montee)} m</Badge>
            <Badge colorPalette="gray" fontVariantNumeric="tabular-nums">↘ {Math.round(descente)} m</Badge>
          </>
        )}
        <Button size="2xs" variant="ghost" ms="auto" disabled={points.length === 0} onClick={mesures.retirerDernier}>
          Retirer le dernier
        </Button>
      </HStack>

      <Text textStyle="xs" color="fg.muted">
        Clic : ajouter un point · glisser un point : le déplacer · <Kbd size="sm">⌫</Kbd> retirer ·{' '}
        <Kbd size="sm">Échap</Kbd> fermer
        {points.length > 1 && profil.isError && ' · altitudes indisponibles'}
      </Text>

      {points.length === 0 ? (
        <Aide py="4" textAlign="center">
          Cliquez sur la carte pour poser le premier point.
        </Aide>
      ) : (
      <chakra.svg viewBox={`0 0 ${L} ${H}`} w="full" h="auto" fontFamily="body" overflow="visible">
        {alt && trace && (
          <>
            <polygon points={`${MARGE.gauche},${bas} ${trace} ${L - MARGE.droite},${bas}`} fill={COULEUR_MESURE} fillOpacity={0.18} />
            <polyline points={trace} fill="none" stroke={COULEUR_MESURE} strokeWidth={2} strokeLinejoin="round" />
            <text x={MARGE.gauche - 6} y={y(max) + 4} textAnchor="end" fontSize={11} fill="var(--chakra-colors-fg-muted)">
              {Math.round(max)} m
            </text>
            <text x={MARGE.gauche - 6} y={y(min) + 4} textAnchor="end" fontSize={11} fill="var(--chakra-colors-fg-muted)">
              {Math.round(min)} m
            </text>
          </>
        )}
        {!alt && points.length > 1 && (
          <line
            x1={MARGE.gauche}
            x2={L - MARGE.droite}
            y1={yPoint(0)}
            y2={yPoint(0)}
            stroke={COULEUR_MESURE}
            strokeWidth={2}
            strokeDasharray="6 4"
          />
        )}
        <line x1={MARGE.gauche} x2={L - MARGE.droite} y1={bas} y2={bas} stroke="var(--chakra-colors-border)" />

        {/* Distance de chaque tronçon, au-dessus de la frise, quand la place le permet. */}
        {points.map((_, i) =>
          i > 0 && x(cumuls[i]!) - x(cumuls[i - 1]!) >= ECART_LIBELLES ? (
            <text
              key={`t${i}`}
              x={(x(cumuls[i]!) + x(cumuls[i - 1]!)) / 2}
              y={14}
              textAnchor="middle"
              fontSize={12}
              fontWeight={600}
              fill={visee === i || visee === i - 1 ? COULEUR_MESURE_VISEE : 'var(--chakra-colors-fg)'}
            >
              {formaterDistance(troncons[i]!)}
            </text>
          ) : null,
        )}

        {points.map((p, i) => {
          const px = x(cumuls[i]!)
          const dernier = i === points.length - 1
          const vise = visee === i
          const couleur = vise ? COULEUR_MESURE_VISEE : COULEUR_MESURE
          // Cumul sous l'axe : masqué s'il chevaucherait le suivant (le dernier et le visé sont toujours lus).
          const suivant = dernier ? Infinity : x(cumuls[i + 1]!)
          const libelle = vise || dernier || suivant - px >= ECART_LIBELLES
          return (
            <chakra.g
              key={i}
              cursor="pointer"
              onMouseEnter={() => mesures.setVisee(i)}
              onMouseLeave={() => mesures.setVisee(null)}
              onClick={() => onCentrer([p])}
            >
              <title>{`Point ${i + 1} : centrer la carte`}</title>
              <line x1={px} x2={px} y1={22} y2={bas} stroke={couleur} strokeOpacity={vise ? 1 : 0.5} strokeDasharray="3 3" />
              <circle cx={px} cy={yPoint(i)} r={vise ? 11 : 9} fill={couleur} stroke="white" strokeWidth={2} />
              <text x={px} y={yPoint(i) + 4} textAnchor="middle" fontSize={11} fontWeight={700} fill="white" pointerEvents="none">
                {i + 1}
              </text>
              {libelle && (
                <text
                  x={px}
                  y={H - 8}
                  textAnchor={i === 0 && !dernier ? 'start' : dernier && i > 0 ? 'end' : 'middle'}
                  fontSize={11}
                  fontWeight={vise ? 700 : 400}
                  fill={vise ? COULEUR_MESURE_VISEE : 'var(--chakra-colors-fg-muted)'}
                >
                  {formaterDistance(cumuls[i]!)}
                </text>
              )}
            </chakra.g>
          )
        })}
      </chakra.svg>
      )}
    </Stack>
  )
}
