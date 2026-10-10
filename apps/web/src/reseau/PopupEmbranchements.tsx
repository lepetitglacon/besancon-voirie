/**
 * Embranchements d'un nœud, à la TM:PE (docs/pipeline-donnees.md, étape 9) : pour chaque rue qui
 * arrive, les rues où elle peut aller. Chaque case ajoute ou retire toutes les liaisons voie à
 * voie de l'une vers l'autre ; le détail voie par voie se règle avec l'outil Liaison.
 */
import { Button, HStack, Stack, Text } from '@chakra-ui/react'
import { basculerEmbranchement, boutsAuNoeud, codeCardinal, embranchements, liaisonsRetenues, type Liaison } from '@voirie/engine'
import type { Noeud, Troncon } from '../api'
import { DIRECTIONS, FLECHES } from '../configuration/libelles'
import { Aide, BarreOutils, Case, PopupCarte, Section } from '../ds'

interface Props {
  noeud: Noeud
  /** Tronçons qui touchent le nœud. */
  troncons: Troncon[]
  onChanger: (liaisons: Liaison[] | null) => void
  onFermer: () => void
}

const symboles = new Map(FLECHES.map((f) => [f.direction, f.symbole]))

export function PopupEmbranchements({ noeud, troncons, onChanger, onFermer }: Props) {
  const bouts = boutsAuNoeud(
    noeud.id,
    troncons.map((t) => ({ ...t.properties, points: t.geometry.coordinates })),
  )
  const { liaisons, auto } = liaisonsRetenues(bouts, noeud.properties.liaisons)
  const nom = (id: string) => {
    const t = troncons.find((x) => x.id === id)
    const bout = bouts.find((b) => b.troncon === id)
    return `${t?.properties.nom ?? 'Rue sans nom'}${bout ? ` (${codeCardinal(bout.azimut)})` : ''}`
  }

  return (
    <PopupCarte
      titre="Embranchements"
      soustitre={`${bouts.length} rues · liaisons ${auto ? 'proposées par défaut' : 'saisies'}`}
      onFermer={onFermer}
      pied={
        <>
          <Aide>Voie par voie : outil Liaison (C)</Aide>
          <BarreOutils.Espace />
          {!auto && (
            <Button size="xs" onClick={() => onChanger(null)} title="Oublier les liaisons saisies à ce nœud">
              Liaisons proposées
            </Button>
          )}
        </>
      }
    >
      {bouts.length < 2 ? (
        <Aide>Un seul tronçon touche ce nœud : rien à relier.</Aide>
      ) : (
        <Stack gap="3" maxH="50vh" overflowY="auto">
          {embranchements(bouts, liaisons).map((e) => (
            <Section key={e.de} libelle={`Depuis ${nom(e.de)}`}>
              <Stack gap="1">
                {e.vers.map((v) => (
                  <Case
                    key={v.vers}
                    coche={v.autorise}
                    onChange={(coche) => onChanger(basculerEmbranchement(bouts, liaisons, e.de, v.vers, coche))}
                  >
                    <HStack as="span" gap="1.5">
                      <Text as="span" w="4" textAlign="center" title={DIRECTIONS[v.direction]}>
                        {symboles.get(v.direction)}
                      </Text>
                      <Text as="span">{v.vers === e.de ? 'Demi-tour' : nom(v.vers)}</Text>
                      {v.autorise && (
                        <Text as="span" color="fg.muted" textStyle="xs">
                          {v.liaisons} liaison{v.liaisons > 1 ? 's' : ''}
                        </Text>
                      )}
                    </HStack>
                  </Case>
                ))}
              </Stack>
            </Section>
          ))}
        </Stack>
      )}
    </PopupCarte>
  )
}
