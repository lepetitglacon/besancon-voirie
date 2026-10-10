/**
 * Réglages de l'outil actif de l'éditeur des voies, dans la carte d'en-tête : ils s'appliquent à
 * chaque geste suivant (docs/pipeline-donnees.md, étape 1).
 */
import { HStack, Input, Stack, Text } from '@chakra-ui/react'
import { Aide, Compteur, Section, Segments } from '../ds'
import type { OutilReseau } from './CoucheReseau'
import { PASSAGES, TYPES_VOIE, type ReglagesOutils } from './reglages'

interface Props {
  outil: OutilReseau
  reglages: ReglagesOutils
  onChanger: (reglages: ReglagesOutils) => void
}

export function ReglagesOutil({ outil, reglages, onChanger }: Props) {
  const changer = <K extends keyof ReglagesOutils>(cle: K, valeur: Partial<ReglagesOutils[K]>) =>
    onChanger({ ...reglages, [cle]: { ...reglages[cle], ...valeur } })

  if (outil === 'tracer') {
    const { tracer } = reglages
    return (
      <Section libelle="Réglages · rue tracée">
        <Input
          size="sm"
          placeholder="Nom de la rue (facultatif)"
          aria-label="Nom de la rue tracée"
          value={tracer.nom ?? ''}
          onChange={(e) => changer('tracer', { nom: e.target.value || null })}
        />
        <Stack gap="1.5">
          <HStack justify="space-between">
            <Text textStyle="sm">Voies dans le sens du tracé</Text>
            <Compteur
              taille="xs"
              aria-label="Voies dans le sens du tracé"
              valeur={tracer.voies_avant}
              min={tracer.voies_arriere === 0 ? 1 : 0}
              max={9}
              onChange={(v) => v !== null && changer('tracer', { voies_avant: v })}
            />
          </HStack>
          <HStack justify="space-between">
            <Text textStyle="sm">Voies en sens inverse</Text>
            <Compteur
              taille="xs"
              aria-label="Voies en sens inverse"
              valeur={tracer.voies_arriere}
              min={tracer.voies_avant === 0 ? 1 : 0}
              max={9}
              onChange={(v) => v !== null && changer('tracer', { voies_arriere: v })}
            />
          </HStack>
          <HStack justify="space-between">
            <Text textStyle="sm">Vitesse</Text>
            <Compteur
              taille="xs"
              aria-label="Vitesse de la rue tracée"
              valeur={tracer.vitesse_kmh}
              placeholder="50"
              min={10}
              max={130}
              pas={10}
              unite="km/h"
              onChange={(v) => changer('tracer', { vitesse_kmh: v })}
            />
          </HStack>
        </Stack>
        <Segments fitted size="xs" aria-label="Type des voies tracées" valeur={tracer.type} onChange={(type) => changer('tracer', { type })} options={TYPES_VOIE} />
      </Section>
    )
  }

  if (outil === 'couper') {
    const { couper } = reglages
    return (
      <Section libelle="Réglages · nœud posé">
        <Segments
          fitted
          size="xs"
          aria-label="Ce que porte le nœud posé"
          valeur={couper.pose}
          onChange={(pose) => changer('couper', { pose })}
          options={[
            { valeur: 'rien', libelle: 'Simple' },
            { valeur: 'feux', libelle: 'Ligne d’arrêt' },
            { valeur: 'pieton', libelle: 'Passage' },
          ]}
        />
        {couper.pose === 'pieton' && (
          <Segments fitted size="xs" aria-label="Type de passage piéton" valeur={couper.pieton} onChange={(pieton) => changer('couper', { pieton })} options={PASSAGES} />
        )}
        <Aide>
          {couper.pose === 'rien'
            ? 'Début d’une présélection : le tronçon d’approche prend ensuite ses propres voies (outil Voie).'
            : couper.pose === 'feux'
              ? 'Les voies qui arrivent s’arrêtent au feu : c’est la ligne d’arrêt de la branche.'
              : 'Le passage est posé en travers de la rue, sur le nœud.'}
        </Aide>
      </Section>
    )
  }

  if (outil === 'voie') {
    const { voie } = reglages
    return (
      <Section libelle="Réglages · voie">
        <Segments
          fitted
          size="xs"
          aria-label="Ajouter ou retirer une voie"
          valeur={voie.action}
          onChange={(action) => changer('voie', { action })}
          options={[
            { valeur: 'ajouter', libelle: 'Ajouter' },
            { valeur: 'retirer', libelle: 'Retirer' },
          ]}
        />
        {voie.action === 'ajouter' && (
          <>
            <Segments fitted size="xs" aria-label="Type de la voie ajoutée" valeur={voie.type} onChange={(type) => changer('voie', { type })} options={TYPES_VOIE} />
            <Segments
              fitted
              size="xs"
              aria-label="Où ajouter la voie"
              valeur={voie.position}
              onChange={(position) => changer('voie', { position })}
              options={[
                { valeur: 'bord', libelle: 'Au bord (à droite)' },
                { valeur: 'axe', libelle: 'Contre l’axe (à gauche)' },
              ]}
            />
          </>
        )}
        <Aide>
          {voie.action === 'ajouter'
            ? 'Cliquez une rue du côté du sens voulu : la voie s’ajoute dans ce sens. Les liaisons saisies suivent.'
            : 'Cliquez la voie à retirer (zoom 16 et plus), ou une rue du côté du sens voulu : sa voie du bord part.'}
        </Aide>
      </Section>
    )
  }

  if (outil === 'passage') {
    return (
      <Section libelle="Réglages · passage piéton">
        <Segments
          fitted
          size="xs"
          aria-label="Type de passage piéton"
          valeur={reglages.passage.pieton}
          onChange={(pieton) => changer('passage', { pieton })}
          options={PASSAGES}
        />
        <Aide>Clic sur une rue : un nœud y est posé avec son passage. Clic sur un nœud : le passage y est posé, ou retiré s’il est déjà de ce type.</Aide>
      </Section>
    )
  }

  return null
}
