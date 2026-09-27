/** Contenu de la carte d'en-tête de l'éditeur des voies : aide, légende, semis OSM, export SUMO. */
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
  generation: { enCours: boolean; onGenerer: (reinitialiser: boolean) => void }
}

export function EnTeteReseau({ outil, visible, nbTroncons, tronque, bbox, generation }: Props) {
  return (
    <Stack gap="2.5" mt="3" pt="3" borderTopWidth="1px" borderColor="border.muted">
      <Aide>
        {outil === 'tracer' ? (
          <>
            Cliquez un nœud, une rue ou un point libre, puis les points de la rue, et finissez sur un nœud ou une rue
            (<Kbd>Entrée</Kbd> : finir sur un point libre, <Kbd>⌫</Kbd> : retirer le dernier point). Tracée jusqu’au
            centre d’un carrefour, la rue s’arrête à son bord et se relie à sa branche.
          </>
        ) : outil === 'connecter' ? (
          <>
            Glissez du bout d’une voie (bleu) vers une voie qui repart : à chaque intersection, et au bord d’un
            carrefour vers ses voies (cliquez-le d’abord pour l’ouvrir). Pointillés : liaisons proposées ; un clic sur
            une liaison la retire.
          </>
        ) : (
          <>
            Rues et carrefours, voie par voie à partir du zoom 16. Cliquez une rue pour ses voies, son sens ou sa
            vitesse, un carrefour pour l’ouvrir ; <Kbd>T</Kbd> trace une rue qui manque, <Kbd>C</Kbd> relie les voies.
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
        <Message ton="avertissement">Aucun tronçon ici : semez le réseau depuis OSM (après `pnpm osm:import`).</Message>
      )}
      {tronque && <Message ton="avertissement">Trop de tronçons dans la vue : seule une partie est affichée.</Message>}
      <HStack gap="2" justify="space-between">
        <Text textStyle="xs" color="fg.muted">
          {nbTroncons !== undefined && visible ? `${nbTroncons} tronçon(s) dans la vue` : ''}
        </Text>
        {nbTroncons === 0 ? (
          <Button size="xs" variant="outline" loading={generation.enCours} title="Une seule fois : le réseau se corrige ensuite à la main" onClick={() => generation.onGenerer(false)}>
            ⟳ Semer depuis OSM
          </Button>
        ) : (
          <Button
            size="xs"
            variant="plain"
            colorPalette="red"
            loading={generation.enCours}
            title="Efface tout le réseau (corrections, liaisons, nœuds des carrefours) et le sème de nouveau depuis OSM"
            onClick={() =>
              window.confirm('Effacer tout le réseau, corrections comprises, et le semer de nouveau depuis OSM ?') && generation.onGenerer(true)
            }
          >
            Réinitialiser depuis OSM
          </Button>
        )}
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
