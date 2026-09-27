/**
 * Popup d'un tronçon du réseau : nom, voies par sens, vitesse, sens du tracé, raccordements
 * aux carrefours. Chaque changement est enregistré aussitôt.
 */
import { Badge, Button, HStack, Input, Stack, Text } from '@chakra-ui/react'
import { vitesseParDefaut } from '@voirie/engine'
import type { ModificationTroncon } from '@voirie/schema'
import { useState } from 'react'
import type { Troncon } from '../api'
import { Aide, BarreOutils, Compteur, Message, PopupCarte, Section } from '../ds'

interface Props {
  troncon: Troncon
  /** Nom des carrefours configurés aux bouts du tronçon. */
  nomCarrefour: (id: string) => string
  enregistrement: { enCours: boolean; erreur: string | null }
  onModifier: (modification: ModificationTroncon) => void
  onSupprimer: () => void
  onConfigurer: (carrefourId: string) => void
  onFermer: () => void
}

const ORIGINES = {
  osm: { libelle: 'OSM', couleur: 'blue' },
  modifie: { libelle: 'OSM corrigé', couleur: 'orange' },
  manuel: { libelle: 'Tracé à la main', couleur: 'green' },
} as const

export function PopupTroncon({ troncon, nomCarrefour, enregistrement, onModifier, onSupprimer, onConfigurer, onFermer }: Props) {
  const t = troncon.properties
  const [nom, setNom] = useState<string | null>(null)
  const origine = ORIGINES[t.source === 'manuel' ? 'manuel' : t.modifie ? 'modifie' : 'osm']
  const validerNom = () => {
    if (nom === null) return
    const valeur = nom.trim() || null
    setNom(null)
    if (valeur !== t.nom) onModifier({ nom: valeur })
  }
  const bouts = (['de', 'vers'] as const).flatMap((extremite) => {
    const carrefour = extremite === 'de' ? t.carrefour_de : t.carrefour_vers
    const branche = extremite === 'de' ? t.branche_de : t.branche_vers
    return carrefour ? [{ extremite, carrefour, branche }] : []
  })

  return (
    <PopupCarte
      titre={t.nom ?? 'Rue sans nom'}
      soustitre={
        <HStack gap="1.5" as="span">
          <Badge colorPalette={origine.couleur}>{origine.libelle}</Badge>
          {t.highway && <Text as="span">{t.highway}</Text>}
        </HStack>
      }
      onFermer={onFermer}
      pied={
        <>
          <Button
            variant="plain"
            colorPalette="red"
            px="2"
            onClick={() => {
              const message =
                t.source === 'osm' ? 'Masquer ce tronçon OSM ? Il ne reviendra pas à la régénération.' : 'Supprimer ce tronçon ?'
              if (window.confirm(message)) onSupprimer()
            }}
          >
            Supprimer
          </Button>
          <BarreOutils.Espace />
          <Button title="Retourner le sens du tracé : les voies des deux sens s'échangent" onClick={() => onModifier({ inverser: true })}>
            ⇄ Inverser
          </Button>
        </>
      }
    >
      <Section libelle="Nom">
        <Input
          size="sm"
          placeholder="Nom de la rue"
          aria-label="Nom de la rue"
          value={nom ?? t.nom ?? ''}
          onChange={(e) => setNom(e.target.value)}
          onBlur={validerNom}
          onKeyDown={(e) => e.key === 'Enter' && validerNom()}
        />
      </Section>
      <Section libelle="Voies par sens">
        <Stack gap="1.5">
          <HStack justify="space-between">
            <Text textStyle="sm">Sens du tracé (&gt;)</Text>
            <Compteur
              aria-label="Voies dans le sens du tracé"
              valeur={t.voies_avant}
              min={t.voies_arriere === 0 ? 1 : 0}
              max={9}
              onChange={(v) => v !== null && v !== t.voies_avant && onModifier({ voies_avant: v })}
            />
          </HStack>
          <HStack justify="space-between">
            <Text textStyle="sm">Sens inverse (&lt;)</Text>
            <Compteur
              aria-label="Voies dans le sens inverse"
              valeur={t.voies_arriere}
              min={t.voies_avant === 0 ? 1 : 0}
              max={9}
              onChange={(v) => v !== null && v !== t.voies_arriere && onModifier({ voies_arriere: v })}
            />
          </HStack>
          <Aide>0 voie : sens interdit. Les chevrons sur la carte montrent le sens du tracé.</Aide>
        </Stack>
      </Section>
      <Section libelle="Vitesse">
        <HStack justify="space-between">
          <Aide>{t.vitesse_kmh === null ? `Par défaut (${t.highway ?? 'voie'})` : 'Saisie'}</Aide>
          <Compteur
            aria-label="Vitesse maximale"
            valeur={t.vitesse_kmh}
            placeholder={String(vitesseParDefaut(t.highway))}
            min={10}
            max={130}
            pas={10}
            unite="km/h"
            onChange={(v) => v !== t.vitesse_kmh && onModifier({ vitesse_kmh: v })}
          />
        </HStack>
      </Section>
      {bouts.length > 0 && (
        <Section libelle="Raccordé à">
          {bouts.map((b) => (
            <HStack key={b.extremite} justify="space-between" textStyle="sm">
              <Text>
                {nomCarrefour(b.carrefour)} · {b.branche ? `branche ${b.branche}` : <Text as="span" color="fg.error">aucune branche</Text>}
              </Text>
              <Button variant="lien" size="xs" onClick={() => onConfigurer(b.carrefour)}>
                Ouvrir
              </Button>
            </HStack>
          ))}
        </Section>
      )}
      {enregistrement.erreur && <Message ton="erreur">{enregistrement.erreur}</Message>}
    </PopupCarte>
  )
}
