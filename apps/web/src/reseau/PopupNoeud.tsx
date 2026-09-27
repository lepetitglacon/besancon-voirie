/**
 * Popup d'un nœud du réseau : ce qu'il porte (ligne d'arrêt à feux, passage piéton), le
 * carrefour dont il fait partie, ses liaisons, et le retrait d'un nœud entre deux tronçons.
 * Chaque changement est enregistré aussitôt ; le carrefour touché est recalculé.
 */
import { Button, HStack, Stack, Text } from '@chakra-ui/react'
import type { ModificationNoeud, TraverseePieton } from '@voirie/schema'
import type { Noeud } from '../api'
import { Aide, Bascule, BarreOutils, Message, PopupCarte, Section, Selecteur } from '../ds'

interface Props {
  noeud: Noeud
  /** Carrefour ouvert : on peut y mettre le nœud, ou l'en retirer. */
  carrefourOuvert: { id: string; nom: string } | null
  nomCarrefour: (id: string) => string
  enregistrement: { enCours: boolean; erreur: string | null }
  onModifier: (modification: ModificationNoeud) => void
  /** Revient aux liaisons proposées par défaut. */
  onLiaisonsParDefaut: () => void
  /** Retire le nœud : ses deux tronçons n'en font plus qu'un. */
  onFusionner: () => void
  onOuvrirCarrefour: (id: string) => void
  onFermer: () => void
}

const PASSAGES: Array<{ valeur: TraverseePieton | 'aucun'; libelle: string }> = [
  { valeur: 'aucun', libelle: 'Aucun' },
  { valeur: 'marquee', libelle: 'Marqué (zébras)' },
  { valeur: 'non_marquee', libelle: 'Non marqué' },
  { valeur: 'feux', libelle: 'À feux' },
]

export function PopupNoeud({ noeud, carrefourOuvert, nomCarrefour, enregistrement, onModifier, onLiaisonsParDefaut, onFusionner, onOuvrirCarrefour, onFermer }: Props) {
  const n = noeud.properties
  const nature = n.degre >= 3 ? `Intersection de ${n.degre} tronçons` : n.degre === 2 ? 'Nœud entre deux tronçons' : 'Bout du réseau'
  const dansOuvert = carrefourOuvert !== null && n.carrefour_id === carrefourOuvert.id
  return (
    <PopupCarte
      titre={n.feux ? 'Ligne d’arrêt à feux' : n.pieton ? 'Passage piéton' : 'Nœud'}
      soustitre={`${nature}${n.osm_node_id ? ' · OSM' : ' · posé à la main'}`}
      onFermer={onFermer}
      pied={
        <>
          {n.degre === 2 && (
            <Button
              variant="plain"
              colorPalette="red"
              px="2"
              title="Les deux tronçons n’en font plus qu’un (ils doivent avoir les mêmes voies)"
              onClick={onFusionner}
            >
              Retirer le nœud
            </Button>
          )}
          <BarreOutils.Espace />
          {n.liaisons && (
            <Button title="Oublier les liaisons saisies à ce nœud" onClick={onLiaisonsParDefaut}>
              Liaisons proposées
            </Button>
          )}
        </>
      }
    >
      <Section libelle="Feux">
        <Bascule coche={n.feux} onChange={(feux) => onModifier({ feux })}>
          Ligne d’arrêt à feux
        </Bascule>
        <Aide>Les voies qui arrivent ici s’arrêtent au feu : c’est la ligne d’arrêt de la branche.</Aide>
      </Section>
      <Section libelle="Passage piéton">
        <Selecteur
          size="sm"
          aria-label="Passage piéton"
          valeur={n.pieton ?? 'aucun'}
          onChange={(v) => onModifier({ pieton: v === 'aucun' ? null : (v as TraverseePieton) })}
        >
          {PASSAGES.map((p) => (
            <option key={p.valeur} value={p.valeur}>
              {p.libelle}
            </option>
          ))}
        </Selecteur>
      </Section>
      <Section libelle="Carrefour">
        <Stack gap="1.5">
          {n.carrefour_id && !dansOuvert && (
            <HStack justify="space-between" textStyle="sm">
              <Text>{nomCarrefour(n.carrefour_id)}</Text>
              <Button variant="lien" size="xs" onClick={() => onOuvrirCarrefour(n.carrefour_id!)}>
                Ouvrir
              </Button>
            </HStack>
          )}
          {carrefourOuvert && (!n.carrefour_id || dansOuvert) && (
            <Bascule coche={dansOuvert} onChange={(coche) => onModifier({ carrefour_id: coche ? carrefourOuvert.id : null })}>
              Dans {carrefourOuvert.nom}
            </Bascule>
          )}
          {!n.carrefour_id && !carrefourOuvert && <Aide>Hors carrefour. Ouvrez un carrefour pour l’y ajouter.</Aide>}
        </Stack>
      </Section>
      {enregistrement.erreur && <Message ton="erreur">{enregistrement.erreur}</Message>}
    </PopupCarte>
  )
}
