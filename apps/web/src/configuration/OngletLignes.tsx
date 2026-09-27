import { Button, Grid, Heading, HStack, IconButton, Input, Stack, Text } from '@chakra-ui/react'
import { matriceConflits, mouvementsNonCommandes, proposerLignes } from '@voirie/engine'
import { typeLigne, type BranchesCarrefour, type LigneFeux, type Signal } from '@voirie/schema'
import { useMemo } from 'react'
import { Aide, Case, Message, Selecteur } from '../ds'
import { DIRECTIONS, SIGNAUX } from './libelles'
import { MatriceConflits } from './MatriceConflits'
import { geometrieEnregistree } from './programme'

export interface BrouillonLignes {
  lignes: LigneFeux[]
  conflits_admis: Array<[string, string]>
}

interface Props {
  /** Configuration enregistrée : les lignes s'appuient sur elle, pas sur un brouillon. */
  configuration: BranchesCarrefour
  brouillon: BrouillonLignes
  onChanger: (brouillon: BrouillonLignes) => void
  /** Ligne dont on choisit les feux physiques sur la carte. */
  ligneActive: string | null
  onActiver: (code: string | null) => void
}

const cle = (m: { origine: string; destination: string }) => `${m.origine}>${m.destination}`

/** Préfixe des codes de feux d'anneau (A1, A2…). */
const PREFIXE_ANNEAU = 'A'

function codeLibre(prefixe: string, lignes: LigneFeux[]): string {
  const pris = new Set(lignes.map((l) => l.code))
  let n = 1
  while (pris.has(`${prefixe}${n}`)) n++
  return `${prefixe}${n}`
}

/** Étape 2 : lignes de feux, feux physiques, matrice des conflits. */
export function OngletLignes({ configuration, brouillon, onChanger, ligneActive, onActiver }: Props) {
  const { branches, mouvements } = configuration
  const { lignes, conflits_admis } = brouillon
  const geometrie = useMemo(() => geometrieEnregistree(configuration), [configuration])
  const avecTraversee = branches.filter((b) => b.traversee)
  const pourConflits = lignes.map((l) => ({ ...l, type: typeLigne(l.signal) }))
  const conflits = matriceConflits(pourConflits, geometrie, conflits_admis)
  // Giratoire : une entrée sans feux cède le passage ; seules comptent les entrées dont un mouvement a des feux.
  const entreesAFeux = new Set(lignes.flatMap((l) => l.mouvements.map((c) => c.split('>')[0])))
  const nonCommandes = mouvementsNonCommandes(mouvements, pourConflits).filter(
    (c) => !configuration.anneau || entreesAFeux.has(c.split('>')[0]),
  )
  const directionDe = new Map(mouvements.map((m) => [cle(m), m.direction]))
  const commandePar = new Map(lignes.flatMap((l) => l.mouvements.map((c) => [c, l.code] as const)))

  const changerLignes = (suivantes: LigneFeux[]) => onChanger({ ...brouillon, lignes: suivantes })
  const changerLigne = (index: number, ligne: LigneFeux) =>
    changerLignes(lignes.map((l, i) => (i === index ? ligne : l)))

  const ajouter = (signal: Signal) =>
    changerLignes([
      ...lignes,
      {
        code: codeLibre(SIGNAUX[signal].prefixe, lignes),
        signal,
        mouvements: [],
        traverse: signal === 'R12' ? (avecTraversee[0]?.code ?? null) : null,
        anneau: null,
        feux: [],
      },
    ])

  /** Feu sur l'anneau, en amont de la première branche qui n'en a pas encore. */
  const ajouterFeuAnneau = () => {
    const pris = new Set(lignes.map((l) => l.anneau))
    const branche = branches.find((b) => !pris.has(b.code)) ?? branches[0]
    changerLignes([
      ...lignes,
      { code: codeLibre(PREFIXE_ANNEAU, lignes), signal: 'R11v', mouvements: [], traverse: null, anneau: branche?.code ?? null, feux: [] },
    ])
  }

  const basculerAdmis = (a: string, b: string) => {
    const deja = conflits_admis.some(([x, y]) => (x === a && y === b) || (x === b && y === a))
    onChanger({
      ...brouillon,
      conflits_admis: deja
        ? conflits_admis.filter(([x, y]) => !((x === a && y === b) || (x === b && y === a)))
        : [...conflits_admis, [a, b]],
    })
  }

  if (branches.length === 0) {
    return <Aide>Enregistrez d'abord les branches du carrefour (détection OSM, puis Enregistrer) : les lignes commandent leurs mouvements.</Aide>
  }

  return (
    <Grid templateColumns={{ base: '1fr', lg: 'minmax(0, 1.6fr) minmax(0, 1fr)' }} gap="6" alignItems="start">
      <Stack gap="3">
        <HStack gap="1.5" wrap="wrap">
          <Button size="xs" onClick={() => ajouter('R11v')}>+ Véhicules</Button>
          <Button size="xs" onClick={() => ajouter('R12')}>+ Piétons</Button>
          <Button size="xs" onClick={() => ajouter('R13c')}>+ Vélos</Button>
          <Button size="xs" onClick={() => ajouter('R17')}>+ Tram/bus</Button>
          {configuration.anneau && (
            <Button size="xs" onClick={ajouterFeuAnneau} title="Feu qui arrête la circulation de l’anneau, juste avant une branche">
              + Feu d’anneau
            </Button>
          )}
          {lignes.length === 0 && (
            <Button
              size="xs"
              onClick={() =>
                changerLignes(
                  proposerLignes(mouvements).map((l) => ({ ...l, signal: 'R11v' as const, traverse: null, anneau: null, feux: [] })),
                )
              }
            >
              Proposer une ligne par branche entrante
            </Button>
          )}
        </HStack>

        <Grid templateColumns="repeat(auto-fill, minmax(280px, 1fr))" gap="3" alignItems="start">
          {lignes.map((ligne, index) => {
            const pieton = ligne.signal === 'R12'
            const active = ligneActive === ligne.code
            return (
              <Stack
                as="section"
                key={index}
                gap="2"
                p="2.5"
                borderWidth="1px"
                borderRadius="l2"
                borderColor={active ? 'brand.solid' : 'border.subtle'}
                boxShadow={active ? '0 0 0 1px var(--chakra-colors-brand-solid)' : undefined}
              >
                <HStack gap="1.5">
                  <Input
                    size="xs"
                    flex="0 0 52px"
                    fontWeight="bold"
                    textAlign="center"
                    value={ligne.code}
                    aria-label="Code de la ligne"
                    onChange={(e) => {
                      const code = e.target.value.toUpperCase().slice(0, 4)
                      if (active) onActiver(code)
                      changerLigne(index, { ...ligne, code })
                    }}
                  />
                  <Selecteur
                    size="xs"
                    flex="1"
                    aria-label="Signal"
                    valeur={ligne.signal}
                    onChange={(valeur) => {
                      const signal = valeur as Signal
                      const devientPieton = signal === 'R12'
                      changerLigne(index, {
                        ...ligne,
                        signal,
                        mouvements: devientPieton ? [] : ligne.mouvements,
                        traverse: devientPieton ? (ligne.traverse ?? avecTraversee[0]?.code ?? null) : null,
                        anneau: devientPieton ? null : ligne.anneau,
                      })
                    }}
                  >
                    {(Object.keys(SIGNAUX) as Signal[]).map((signal) => (
                      <option key={signal} value={signal}>
                        {SIGNAUX[signal].libelle}
                      </option>
                    ))}
                  </Selecteur>
                  <IconButton
                    variant="ghost"
                    colorPalette="red"
                    size="xs"
                    aria-label="Supprimer la ligne"
                    title="Supprimer la ligne"
                    onClick={() => changerLignes(lignes.filter((_, i) => i !== index))}
                  >
                    ✕
                  </IconButton>
                </HStack>

                {pieton ? (
                  <HStack gap="1.5">
                    <Text textStyle="xs" color="fg.muted">
                      passage piéton de la branche
                    </Text>
                    <Selecteur
                      size="xs"
                      aria-label="Passage piéton de la branche"
                      valeur={ligne.traverse ?? ''}
                      onChange={(valeur) => changerLigne(index, { ...ligne, traverse: valeur })}
                    >
                      {avecTraversee.map((b) => (
                        <option key={b.code} value={b.code}>
                          {b.code} · {b.nom ?? 'sans nom'}
                        </option>
                      ))}
                    </Selecteur>
                  </HStack>
                ) : ligne.anneau !== null ? (
                  <Stack gap="1">
                    <HStack gap="1.5">
                      <Text textStyle="xs" color="fg.muted">
                        sur l’anneau, juste avant la branche
                      </Text>
                      <Selecteur
                        size="xs"
                        aria-label="Branche en aval du feu d’anneau"
                        valeur={ligne.anneau}
                        onChange={(valeur) => changerLigne(index, { ...ligne, anneau: valeur })}
                      >
                        {branches.map((b) => (
                          <option key={b.code} value={b.code}>
                            {b.code} · {b.nom ?? 'sans nom'}
                          </option>
                        ))}
                      </Selecteur>
                    </HStack>
                    <Aide>Arrête la circulation de l’anneau avant l’entrée (ou la traversée du tram) de cette branche.</Aide>
                  </Stack>
                ) : (
                  <Grid templateColumns="1fr 1fr" rowGap="1" columnGap="2">
                    {mouvements.map((m) => {
                      const c = cle(m)
                      const autre = commandePar.get(c)
                      const pris = autre !== undefined && autre !== ligne.code
                      return (
                        <Case
                          key={c}
                          coche={ligne.mouvements.includes(c)}
                          disabled={pris}
                          onChange={(coche) =>
                            changerLigne(index, {
                              ...ligne,
                              mouvements: coche ? [...ligne.mouvements, c] : ligne.mouvements.filter((x) => x !== c),
                            })
                          }
                        >
                          {m.origine}→{m.destination}{' '}
                          <Text as="span" color="fg.muted">
                            {DIRECTIONS[m.direction]}
                            {pris && ` (${autre})`}
                          </Text>
                        </Case>
                      )
                    })}
                </Grid>
              )}

              <HStack gap="2">
                <Button size="xs" variant={active ? 'subtle' : 'outline'} aria-pressed={active} onClick={() => onActiver(active ? null : ligne.code)}>
                  {active ? 'Terminer le choix des feux' : 'Choisir les feux sur la carte'}
                </Button>
                <Aide>{ligne.feux.length} feu(x) physique(s)</Aide>
              </HStack>
              {active && <Aide>Cliquez sur les feux du carrefour qui affichent {ligne.code}.</Aide>}
            </Stack>
          )
        })}
        </Grid>
      </Stack>

      <Stack gap="3">
        {nonCommandes.length > 0 && lignes.length > 0 && (
          <Message ton="avertissement">
            Mouvements sans ligne de feux : {nonCommandes.map((c) => `${c} (${DIRECTIONS[directionDe.get(c)!]})`).join(', ')}
          </Message>
        )}

        {lignes.length > 1 ? (
          <>
            <Heading as="h3" textStyle="sm" fontWeight="semibold">
              Conflits entre lignes
            </Heading>
            <MatriceConflits codes={lignes.map((l) => l.code)} conflits={conflits} onBasculerAdmis={basculerAdmis} />
          </>
        ) : (
          <Aide>La matrice des conflits apparaît dès qu'il y a deux lignes.</Aide>
        )}
      </Stack>
    </Grid>
  )
}
