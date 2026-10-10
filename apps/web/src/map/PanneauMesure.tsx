import { Badge, Box, Button, chakra, HStack, Kbd, Text, type BoxProps } from '@chakra-ui/react'
import { useQuery } from '@tanstack/react-query'
import type { LonLat } from '@voirie/engine'
import { CarteEnTete } from '../ds'
import { altitudes } from './altitude'
import { denivele, distancesMesure, echantillonner, formaterDistance } from './mesure'

const COULEUR = '#f59e0b'

/** Repère du profil (unités du viewBox, mis à l'échelle de la largeur du panneau). */
const L = 600
const H = 130
const MARGE = { gauche: 40, droite: 16, haut: 30, bas: 26 }
/** Écart minimal entre deux libellés pour les afficher tous deux. */
const ECART_LIBELLES = 46

interface Props extends BoxProps {
  points: LonLat[]
  onRetirerDernier: () => void
  onFermer: () => void
}

/**
 * Mesure de distance en frise : chaque point est placé à sa distance du départ, à l'échelle de
 * la longueur totale (un nouveau point resserre les autres sans fausser leurs écarts). Sous la
 * frise, le profil d'altitude lu dans les tuiles Terrarium, quand elles sont joignables.
 */
export function PanneauMesure({ points, onRetirerDernier, onFermer, ...props }: Props) {
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
    <Box {...props}>
      <CarteEnTete
        w="620px"
        maxW="calc(100vw - 24px)"
        surtitre="Mesure de distance"
        titre={
          <HStack gap="1.5">
            <Text fontVariantNumeric="tabular-nums">{formaterDistance(total)}</Text>
            {alt && (
              <>
                <Badge colorPalette="gray" fontVariantNumeric="tabular-nums">↗ {Math.round(montee)} m</Badge>
                <Badge colorPalette="gray" fontVariantNumeric="tabular-nums">↘ {Math.round(descente)} m</Badge>
              </>
            )}
            <Button size="2xs" variant="ghost" ms="auto" disabled={points.length === 0} onClick={onRetirerDernier}>
              Retirer le dernier
            </Button>
            <Button size="2xs" variant="ghost" onClick={onFermer}>
              Fermer
            </Button>
          </HStack>
        }
      >
        <Text textStyle="xs" color="fg.muted">
          Clic : ajouter un point · <Kbd size="sm">⌫</Kbd> retirer · <Kbd size="sm">Échap</Kbd> fermer
          {points.length > 1 && profil.isError && ' · altitudes indisponibles'}
        </Text>
        <chakra.svg viewBox={`0 0 ${L} ${H}`} w="full" h="auto" mt="2" fontFamily="body" overflow="visible">
          {alt && trace && (
            <>
              <polygon points={`${MARGE.gauche},${bas} ${trace} ${L - MARGE.droite},${bas}`} fill={COULEUR} fillOpacity={0.18} />
              <polyline points={trace} fill="none" stroke={COULEUR} strokeWidth={2} strokeLinejoin="round" />
              <text x={MARGE.gauche - 6} y={y(max) + 4} textAnchor="end" fontSize={11} fill="var(--chakra-colors-fg-muted)">
                {Math.round(max)} m
              </text>
              <text x={MARGE.gauche - 6} y={y(min) + 4} textAnchor="end" fontSize={11} fill="var(--chakra-colors-fg-muted)">
                {Math.round(min)} m
              </text>
            </>
          )}
          {!alt && points.length > 1 && (
            <line x1={MARGE.gauche} x2={L - MARGE.droite} y1={yPoint(0)} y2={yPoint(0)} stroke={COULEUR} strokeWidth={2} strokeDasharray="6 4" />
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
                fill="var(--chakra-colors-fg)"
              >
                {formaterDistance(troncons[i]!)}
              </text>
            ) : null,
          )}

          {points.map((_, i) => {
            const px = x(cumuls[i]!)
            const dernier = i === points.length - 1
            // Cumul sous l'axe : masqué s'il chevaucherait le suivant (le dernier est toujours lu).
            const suivant = dernier ? Infinity : x(cumuls[i + 1]!)
            const libelle = dernier || suivant - px >= ECART_LIBELLES
            return (
              <g key={i}>
                <line x1={px} x2={px} y1={22} y2={bas} stroke={COULEUR} strokeOpacity={0.5} strokeDasharray="3 3" />
                <circle cx={px} cy={yPoint(i)} r={9} fill={COULEUR} stroke="white" strokeWidth={2} />
                <text x={px} y={yPoint(i) + 4} textAnchor="middle" fontSize={11} fontWeight={700} fill="white">
                  {i + 1}
                </text>
                {libelle && (
                  <text
                    x={px}
                    y={H - 8}
                    textAnchor={i === 0 && !dernier ? 'start' : dernier && i > 0 ? 'end' : 'middle'}
                    fontSize={11}
                    fill="var(--chakra-colors-fg-muted)"
                  >
                    {formaterDistance(cumuls[i]!)}
                  </text>
                )}
              </g>
            )
          })}
        </chakra.svg>
      </CarteEnTete>
    </Box>
  )
}
