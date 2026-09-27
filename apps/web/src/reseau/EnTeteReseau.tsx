/** Contenu de la carte d'en-tête en mode « Réseau » : aide, légende, génération OSM, export SUMO. */
import { Box, Button, HStack, Kbd, Link, Stack, Text } from '@chakra-ui/react'
import type { Bbox } from '@voirie/schema'
import { api } from '../api'
import { Aide, Message, Pastille } from '../ds'
import type { OutilReseau } from './CoucheReseau'
import { COULEURS_RESEAU } from './couleurs'
import { ZOOM_MIN_RESEAU } from './modeReseau'

const FICHIERS_SUMO = ['reseau.nod.xml', 'reseau.edg.xml', 'reseau.con.xml', 'reseau.netccfg']

const LEGENDE = [
  { couleur: COULEURS_RESEAU.osm, libelle: 'OSM' },
  { couleur: COULEURS_RESEAU.modifie, libelle: 'OSM corrigé' },
  { couleur: COULEURS_RESEAU.manuel, libelle: 'tracé à la main' },
]

interface Props {
  outil: OutilReseau
  visible: boolean
  nbTroncons: number | undefined
  tronque: boolean
  bbox: Bbox | undefined
  generation: { enCours: boolean; onGenerer: () => void }
}

export function EnTeteReseau({ outil, visible, nbTroncons, tronque, bbox, generation }: Props) {
  return (
    <Stack gap="2.5" mt="3" pt="3" borderTopWidth="1px" borderColor="border.muted">
      <Aide>
        {outil === 'tracer' ? (
          <>
            Cliquez un nœud, un tronçon ou un point libre, puis les points de la rue, et finissez sur un nœud ou un
            tronçon (<Kbd>Entrée</Kbd> : finir sur un point libre, <Kbd>⌫</Kbd> : retirer le dernier point). Tracé
            jusqu’au centre d’un carrefour configuré, le tronçon se raccorde à sa branche.
          </>
        ) : (
          <>
            Toutes les rues de la ville, en tronçons entre nœuds : cliquez un tronçon pour corriger ses voies, son sens
            ou sa vitesse ; <Kbd>T</Kbd> pour en tracer un qui manque. Les liens voie à voie avec un carrefour se font
            dans sa configuration (outil Liaison).
          </>
        )}
      </Aide>
      <HStack as="ul" gap="3" listStyleType="none" textStyle="xs" wrap="wrap">
        {LEGENDE.map((l) => (
          <HStack as="li" key={l.libelle} gap="1">
            <Pastille forme="trait" couleur={l.couleur} />
            {l.libelle}
          </HStack>
        ))}
        <HStack as="li" gap="1">
          <Pastille couleur={COULEURS_RESEAU.culDeSac} />
          cul-de-sac
        </HStack>
      </HStack>
      {!visible && <Message ton="avertissement">Zoomez (niveau {ZOOM_MIN_RESEAU} au moins) pour voir le réseau.</Message>}
      {visible && nbTroncons === 0 && (
        <Message ton="avertissement">Aucun tronçon ici : générez le réseau depuis OSM (après `pnpm osm:import`).</Message>
      )}
      {tronque && <Message ton="avertissement">Trop de tronçons dans la vue : seule une partie est affichée.</Message>}
      <HStack gap="2" justify="space-between">
        <Text textStyle="xs" color="fg.muted">
          {nbTroncons !== undefined && visible ? `${nbTroncons} tronçon(s) dans la vue` : ''}
        </Text>
        <Button
          size="xs"
          variant="outline"
          loading={generation.enCours}
          title="Recrée les tronçons OSM ; ceux corrigés, supprimés ou tracés à la main sont gardés"
          onClick={() => window.confirm('Régénérer le réseau depuis OSM ? Vos corrections sont gardées.') && generation.onGenerer()}
        >
          ⟳ Générer depuis OSM
        </Button>
      </HStack>
      <Box>
        <Text textStyle="xs" fontWeight="semibold" mb="1">
          Export SUMO (plain XML, puis <code>netconvert -c reseau.netccfg</code>)
        </Text>
        {[
          { libelle: 'Vue', bbox },
          { libelle: 'Ville', bbox: undefined },
        ].map((portee) => (
          <HStack key={portee.libelle} gap="2" textStyle="xs">
            <Text w="8" color="fg.muted">
              {portee.libelle}
            </Text>
            {FICHIERS_SUMO.map((fichier) => (
              <Link key={fichier} href={api.urlSumo(fichier, portee.bbox)} download={fichier}>
                {fichier.replace('reseau.', '')}
              </Link>
            ))}
          </HStack>
        ))}
      </Box>
    </Stack>
  )
}
