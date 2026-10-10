/**
 * Popup d'un tronçon du réseau : nom, voies par sens et leur type (générale, bus, vélo, tram),
 * vitesse, sens du tracé, coupe. Chaque changement est enregistré aussitôt.
 */
import { Badge, Button, HStack, Input, Stack, Text } from '@chakra-ui/react'
import { largeurEmprise, typesVoies, vitesseParDefaut } from '@voirie/engine'
import type { ModificationTroncon, SensTroncon, TypeVoie } from '@voirie/schema'
import { useState } from 'react'
import type { Troncon } from '../api'
import { Aide, BarreOutils, Compteur, Message, PopupCarte, Section, Selecteur } from '../ds'

interface Props {
  troncon: Troncon
  enregistrement: { enCours: boolean; erreur: string | null }
  onModifier: (modification: ModificationTroncon) => void
  /** Supprime (ou masque) le tronçon, après confirmation. */
  onSupprimer: () => void
  /** Coupe le tronçon là où on a cliqué : un nœud y est posé. */
  onCouper: () => void
  onFermer: () => void
}

const TYPES: Array<{ valeur: TypeVoie; libelle: string }> = [
  { valeur: 'generale', libelle: 'Générale' },
  { valeur: 'bus', libelle: 'Bus' },
  { valeur: 'velo', libelle: 'Vélo' },
  { valeur: 'tram', libelle: 'Tram' },
]

/** Type de chaque voie d'un sens, de gauche à droite pour le conducteur. */
function TypesDuSens({ libelle, types, onChanger }: { libelle: string; types: TypeVoie[]; onChanger: (types: TypeVoie[]) => void }) {
  if (types.length === 0) return null
  return (
    <HStack gap="1.5" wrap="wrap">
      <Text textStyle="xs" color="fg.muted" w="14">
        {libelle}
      </Text>
      {types.map((type, rang) => (
        <Selecteur
          key={rang}
          size="xs"
          aria-label={`${libelle}, voie ${rang + 1}`}
          valeur={type}
          onChange={(v) => onChanger(types.map((t, i) => (i === rang ? (v as TypeVoie) : t)))}
        >
          {TYPES.map((t) => (
            <option key={t.valeur} value={t.valeur}>
              {t.libelle}
            </option>
          ))}
        </Selecteur>
      ))}
    </HStack>
  )
}

const ORIGINES = {
  osm: { libelle: 'OSM', couleur: 'blue' },
  modifie: { libelle: 'OSM corrigé', couleur: 'orange' },
  manuel: { libelle: 'Tracé à la main', couleur: 'green' },
} as const

export function PopupTroncon({ troncon, enregistrement, onModifier, onSupprimer, onCouper, onFermer }: Props) {
  const t = troncon.properties
  const [nom, setNom] = useState<string | null>(null)
  const origine = ORIGINES[t.source === 'manuel' ? 'manuel' : t.modifie ? 'modifie' : 'osm']
  const validerNom = () => {
    if (nom === null) return
    const valeur = nom.trim() || null
    setNom(null)
    if (valeur !== t.nom) onModifier({ nom: valeur })
  }

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
            title="Suppr"
            onClick={onSupprimer}
          >
            Supprimer
          </Button>
          <BarreOutils.Espace />
          <Button title="Poser un nœud ici : ligne d’arrêt, début d’une voie de présélection, passage piéton" onClick={onCouper}>
            ✂ Couper ici
          </Button>
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
      <Section libelle="Types de voies (de gauche à droite)">
        <Stack gap="1.5">
          <TypesDuSens libelle="Tracé (>)" types={typesVoies(t.voies_avant, t.types_avant)} onChanger={(types) => onModifier({ types_avant: types })} />
          <TypesDuSens libelle="Inverse (<)" types={typesVoies(t.voies_arriere, t.types_arriere)} onChanger={(types) => onModifier({ types_arriere: types })} />
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
      {t.emprises && Object.keys(t.emprises).length > 0 && (
        <Section libelle="Emprises dessinées">
          <Stack gap="1">
            {Object.entries(t.emprises)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([cle, polygone]) => {
                const [sens, rang] = cle.split(':') as [SensTroncon, string]
                const largeur = largeurEmprise(polygone, troncon.geometry.coordinates)
                return (
                  <HStack key={cle} justify="space-between" textStyle="sm">
                    <Text>
                      {sens === 'avant' ? 'Tracé (>)' : 'Inverse (<)'}, voie {Number(rang) + 1}
                      {largeur !== null && ` · ${largeur.toFixed(1).replace('.', ',')} m de large`}
                    </Text>
                    <Button
                      variant="lien"
                      size="xs"
                      colorPalette="red"
                      onClick={() => onModifier({ emprise: { sens, rang: Number(rang), polygone: null } })}
                    >
                      retirer
                    </Button>
                  </HStack>
                )
              })}
          </Stack>
          <Aide>Surface réelle de la voie, posée sur la photo (outil Emprise, E) : sa largeur part dans l’export SUMO.</Aide>
        </Section>
      )}
      {enregistrement.erreur && <Message ton="erreur">{enregistrement.erreur}</Message>}
    </PopupCarte>
  )
}
