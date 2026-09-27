import { Badge, Button, Heading, HStack, IconButton, Input, List, Stack, Text } from '@chakra-ui/react'
import { cleVoie, flechesParVoie, mouvementsDepuisConnexions, type LonLat } from '@voirie/engine'
import type { SensVoie, TypeVoie } from '@voirie/schema'
import { Aide, Case, Message, Pastille, Segments, Selecteur } from '../ds'
import type { ModeEdition } from './calque/CalqueCarrefour'
import { DIRECTIONS, FLECHES } from './libelles'
import {
  ajouterVoie,
  basculerConnexion,
  basculerTraversee,
  changerTypeVoie,
  couleursVoies,
  regenererVoies,
  renommerBranche,
  retirerVoie,
  supprimerBranche,
  voiesDe,
  type Brouillon,
} from './modele'

const TYPES: Record<TypeVoie, string> = { generale: 'générale', bus: 'bus', velo: 'vélo', tram: 'tram' }
const symbole = new Map(FLECHES.map((f) => [f.direction, f.symbole]))

interface Props {
  brouillon: Brouillon
  centre: LonLat
  sources: Record<string, 'osm' | 'defaut'>
  mode: ModeEdition
  onMode: (mode: ModeEdition) => void
  onChanger: (brouillon: Brouillon) => void
}

/** Étape 1 : branches, voies calées sur la photo, passages piétons et connexions entre voies. */
export function OngletBranches({ brouillon, centre, sources, mode, onMode, onChanger }: Props) {
  const { branches, connexions } = brouillon
  const fleches = flechesParVoie(branches, connexions)
  const mouvements = mouvementsDepuisConnexions(branches, connexions)
  const couleurs = couleursVoies(branches)
  const sansConnexion = branches.flatMap((b) =>
    voiesDe(b, 'entrante')
      .filter((v) => !connexions.some((c) => c.de === cleVoie(b.code, 'entrante', v.rang)))
      .map((v) => `${b.code}, voie entrante ${v.rang + 1}`),
  )

  if (branches.length === 0) {
    return <Aide>Aucune branche. Lancez la détection depuis OpenStreetMap, puis calez les voies sur la photo.</Aide>
  }

  return (
    <>
      <Segments
        fitted
        aria-label="Mode d'édition sur la carte"
        valeur={mode === 'feux' ? null : mode}
        onChange={onMode}
        options={[
          { valeur: 'ajuster', libelle: '✥ Ajuster les voies' },
          { valeur: 'connecter', libelle: '⤳ Connecter' },
        ]}
      />
      {mode !== 'feux' && (
        <Aide>
          {mode === 'ajuster'
            ? 'Faites glisser les extrémités des voies et des passages piétons pour les caler sur le marquage de la photo (fond de carte « Satellite »).'
            : 'Glissez du point coloré d’une voie entrante vers le point blanc d’une voie sortante. Refaire le même geste retire la connexion.'}
        </Aide>
      )}

      {branches.map((branche, index) => (
        <Stack as="section" key={index} gap="2" p="2.5" borderWidth="1px" borderColor="border.subtle" borderRadius="l2">
          <HStack gap="1.5">
            <Input
              size="xs"
              flex="0 0 52px"
              fontWeight="bold"
              textAlign="center"
              value={branche.code}
              aria-label="Code de la branche"
              onChange={(e) => {
                const code = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4)
                if (code && !branches.some((b) => b.code === code)) onChanger(renommerBranche(brouillon, branche.code, code))
              }}
            />
            <Input
              size="xs"
              flex="1"
              value={branche.nom ?? ''}
              placeholder="Nom de la rue"
              aria-label="Nom de la rue"
              onChange={(e) =>
                onChanger({
                  ...brouillon,
                  branches: branches.map((b) => (b.code === branche.code ? { ...b, nom: e.target.value || null } : b)),
                })
              }
            />
            <IconButton
              variant="ghost"
              colorPalette="red"
              size="xs"
              aria-label="Supprimer la branche"
              title="Supprimer la branche"
              onClick={() => onChanger(supprimerBranche(brouillon, branche.code))}
            >
              ✕
            </IconButton>
          </HStack>

          {(['entrante', 'sortante'] as SensVoie[]).map((sens) => (
            <HStack key={sens} gap="1.5" align="center">
              <Text textStyle="xs" color="fg.muted" minW="62px">
                {sens === 'entrante' ? 'Entrantes' : 'Sortantes'}
              </Text>
              <Button size="2xs" aria-label="Retirer une voie" onClick={() => onChanger(retirerVoie(brouillon, branche.code, sens))} disabled={voiesDe(branche, sens).length === 0}>
                −
              </Button>
              <Button size="2xs" aria-label="Ajouter une voie" onClick={() => onChanger(ajouterVoie(brouillon, branche.code, sens, centre))} disabled={voiesDe(branche, sens).length >= 8}>
                +
              </Button>
              <HStack gap="1.5" wrap="wrap">
                {voiesDe(branche, sens).map((voie) => {
                  const cle = cleVoie(branche.code, sens, voie.rang)
                  return (
                    <HStack key={cle} gap="1" p="2px" borderWidth="2px" borderRadius="l1" style={{ borderColor: couleurs.get(cle) }} title={`Voie ${voie.rang + 1}`}>
                      {sens === 'entrante' && (
                        <Text as="strong" minW="4" textAlign="center" textStyle="md">
                          {(fleches[cle] ?? []).map((d) => symbole.get(d)).join('') || '∅'}
                        </Text>
                      )}
                      <Selecteur
                        size="xs"
                        variant="plain"
                        valeur={voie.type}
                        aria-label={`Type de la voie ${voie.rang + 1}`}
                        onChange={(valeur) => onChanger(changerTypeVoie(brouillon, branche.code, sens, voie.rang, valeur as TypeVoie))}
                      >
                        {(Object.keys(TYPES) as TypeVoie[]).map((t) => (
                          <option key={t} value={t}>
                            {TYPES[t]}
                          </option>
                        ))}
                      </Selecteur>
                    </HStack>
                  )
                })}
              </HStack>
            </HStack>
          ))}

          <HStack gap="2" wrap="wrap">
            <Case coche={branche.traversee !== null} onChange={() => onChanger(basculerTraversee(brouillon, branche.code, centre))}>
              passage piéton
            </Case>
            <Button size="xs" onClick={() => onChanger(regenererVoies(brouillon, branche.code, centre))} title="Remettre les voies à leur position proposée">
              Replacer
            </Button>
            {sources[branche.code] && (
              <Badge colorPalette={sources[branche.code] === 'osm' ? 'green' : 'orange'}>
                {sources[branche.code] === 'osm' ? 'connexions d’après OSM' : 'connexions par défaut, à vérifier'}
              </Badge>
            )}
          </HStack>
        </Stack>
      ))}

      <Heading as="h3" textStyle="sm" fontWeight="semibold">
        Connexions ({connexions.length})
      </Heading>
      <List.Root gap="0.5" ps="4" textStyle="xs">
        {connexions.map((c) => (
          <List.Item key={`${c.de}>${c.vers}`}>
            <HStack gap="1.5">
              <Pastille couleur={couleurs.get(c.de) ?? 'fg.muted'} />
              {c.de} → {c.vers}
              <Button variant="lien" size="xs" onClick={() => onChanger(basculerConnexion(brouillon, c.de, c.vers))}>
                retirer
              </Button>
            </HStack>
          </List.Item>
        ))}
      </List.Root>

      <Heading as="h3" textStyle="sm" fontWeight="semibold">
        Mouvements déduits ({mouvements.length})
      </Heading>
      <List.Root gap="0.5" ps="4" textStyle="xs">
        {mouvements.map((m) => (
          <List.Item key={`${m.origine}>${m.destination}`}>
            <strong>
              {m.origine} → {m.destination}
            </strong>{' '}
            {DIRECTIONS[m.direction]} · voie{m.voies.length > 1 ? 's' : ''} {m.voies.map((v) => v + 1).join(', ')}
          </List.Item>
        ))}
      </List.Root>
      {sansConnexion.length > 0 && <Message ton="avertissement">Voies entrantes sans connexion : {sansConnexion.join(' ; ')}</Message>}
    </>
  )
}
