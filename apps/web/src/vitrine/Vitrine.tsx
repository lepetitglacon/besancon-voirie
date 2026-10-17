import {
  Badge,
  Box,
  Button,
  CheckboxCard,
  Code,
  Flex,
  Grid,
  Heading,
  HStack,
  IconButton,
  Input,
  Kbd,
  RadioCard,
  Stack,
  Table,
  Tabs,
  Text,
  Wrap,
} from '@chakra-ui/react'
import { ArrowLeft } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router'
import {
  Aide,
  BandeauMode,
  BarreOutils,
  Bascule,
  CarteEnTete,
  Case,
  EtiquetteVehicule,
  Chiffre,
  Compteur,
  Indice,
  LibelleSection,
  LigneConflit,
  MenuContextuel,
  Message,
  ModeCouleur,
  PanneauBas,
  Pastille,
  PastilleLigne,
  PopupCarte,
  Section,
  Segments,
  Selecteur,
  IconeFeu,
  TeteDeFeu,
  Valeur,
  type EtatLampe,
} from '../ds'
import { ChoixLignesBus } from '../bus/ChoixLignesBus'
import type { LigneBus } from '../bus/lignesBus'

/** Vitrine du design system : chaque composant, dans ses états, en clair comme en sombre. */
export default function Vitrine() {
  // Vue de la carte au départ (« #zoom/lat/lon »), passée par le menu du site.
  const vue: string = useLocation().state?.vue ?? ''

  return (
    <Box minH="100%" bg="bg.canvas" color="fg">
      <Flex as="header" align="center" gap="3" px="8" py="4" borderBottomWidth="1px" borderColor="border.subtle" bg="bg.panel">
        <Heading size="md">Besançon Voirie · design system</Heading>
        <Aide>d'après documents/Traffic Manager UX.html</Aide>
        <Box flex="1" />
        <ModeCouleur />
        <Button asChild size="sm" variant="outline">
          <Link to={{ pathname: '/', hash: vue }}>
            <ArrowLeft />
            Retour à la carte
          </Link>
        </Button>
      </Flex>
      <Stack gap="10" px="8" py="8" maxW="1200px" mx="auto">
        <Fondations />
        <ComposantsChakra />
        <ComposantsProjet />
        <Ecrans />
      </Stack>
    </Box>
  )
}

function Bloc({ titre, children }: { titre: string; children: ReactNode }) {
  return (
    <Stack as="section" gap="4">
      <Heading size="lg" borderBottomWidth="1px" borderColor="border.subtle" pb="2">
        {titre}
      </Heading>
      {children}
    </Stack>
  )
}

function Exemple({ nom, children }: { nom: string; children: ReactNode }) {
  return (
    <Stack gap="2" p="4" bg="bg.panel" borderRadius="l3" borderWidth="1px" borderColor="border.subtle">
      <LibelleSection>{nom}</LibelleSection>
      {children}
    </Stack>
  )
}

/** Couleurs Ginko (GTFS) de quelques lignes. */
const ETIQUETTES = [
  { mode: 'tram', ligne: 'T1', couleur: '#00A5C2', couleurTexte: '#FFFFFF' },
  { mode: 'tram', ligne: 'T2', couleur: '#006D78', couleurTexte: '#FFFFFF' },
  { mode: 'bus', ligne: 'L3', couleur: '#006AB3', couleurTexte: '#FFFFFF' },
  { mode: 'bus', ligne: 'L4', couleur: '#E2001A', couleurTexte: '#FFFFFF' },
  { mode: 'bus', ligne: 'L6', couleur: '#FFE500', couleurTexte: '#000000' },
  { mode: 'bus', ligne: '10', couleur: '#CECB00', couleurTexte: '#000000' },
  { mode: 'bus', ligne: 'Ginko Citadelle', couleur: '#F26522', couleurTexte: '#FFFFFF' },
] as const

const NUANCIER = [
  ['Surfaces', ['bg.canvas', 'bg.panel', 'bg.subtle', 'bg.muted', 'bg.emphasized', 'bg.encre']],
  ['Texte', ['fg', 'fg.secondary', 'fg.muted', 'fg.subtle', 'fg.error', 'fg.warning', 'fg.success']],
  ['Bordures', ['border', 'border.subtle', 'border.muted', 'border.emphasized']],
  ['Accent', ['brand.solid', 'brand.fg', 'brand.emphasized', 'brand.muted', 'brand.subtle']],
  ['Feux', ['feu.vert', 'feu.orange', 'feu.rouge', 'feu.eteint']],
  ['Statuts de carrefour', ['statut.a_confirmer', 'statut.non_releve', 'statut.estime', 'statut.mesure', 'statut.verifie']],
  ['Conflits', ['conflit.croisement', 'conflit.convergence', 'conflit.pieton', 'conflit.admis']],
] as const

function Fondations() {
  return (
    <Bloc titre="Fondations">
      <Grid templateColumns="repeat(auto-fill, minmax(340px, 1fr))" gap="4">
        {NUANCIER.map(([groupe, tokens]) => (
          <Exemple key={groupe} nom={groupe}>
            <Wrap gap="3">
              {tokens.map((token) => (
                <Stack key={token} gap="1" w="72px">
                  <Box h="10" bg={token} borderRadius="l2" borderWidth="1px" borderColor="border.subtle" />
                  <Code size="sm" variant="plain" px="0" fontSize="2xs" wordBreak="break-all">
                    {token}
                  </Code>
                </Stack>
              ))}
            </Wrap>
          </Exemple>
        ))}
        <Exemple nom="Typographie">
          <Text textStyle="xl" fontWeight="semibold">IBM Plex Sans 17 · titre</Text>
          <Text textStyle="lg" fontWeight="semibold">15 · titre de panneau</Text>
          <Text textStyle="md" fontWeight="semibold">14 · titre de popup</Text>
          <Text textStyle="sm">13 · texte courant</Text>
          <Text textStyle="xs" color="fg.muted">12 · aide</Text>
          <LibelleSection>11 · libellé de section</LibelleSection>
          <Valeur>IBM Plex Mono · 28 s · 86 m · 47.2447 N</Valeur>
        </Exemple>
        <Exemple nom="Rayons et ombres">
          <HStack gap="4" align="end">
            {[
              ['l1 · 6', 'l1', 'segment'],
              ['l2 · 8', 'l2', 'carte'],
              ['l3 · 12', 'l3', 'popup'],
              ['barre · 14', 'barre', 'flottant'],
            ].map(([nom, rayon, ombre]) => (
              <Stack key={nom} gap="2" align="center">
                <Box w="16" h="12" bg="bg.panel" borderRadius={rayon} boxShadow={ombre} />
                <Aide>{nom}</Aide>
              </Stack>
            ))}
          </HStack>
        </Exemple>
      </Grid>
    </Bloc>
  )
}

function ComposantsChakra() {
  const [sens, setSens] = useState('double')
  const [usage, setUsage] = useState('generale')
  const [onglet, setOnglet] = useState('branches')
  const [voies, setVoies] = useState<number | null>(1)
  const [vert, setVert] = useState<number | null>(28)
  const [degagement, setDegagement] = useState<number | null>(null)
  const [detecteur, setDetecteur] = useState(true)
  const [coche, setCoche] = useState(true)
  const [nature, setNature] = useState('carrefour')

  return (
    <Bloc titre="Composants Chakra habillés">
      <Grid templateColumns="repeat(auto-fill, minmax(340px, 1fr))" gap="4">
        <Exemple nom="Boutons">
          <Wrap gap="2">
            <Button variant="solid">Appliquer</Button>
            <Button>Plan de feux</Button>
            <Button variant="encre">Enregistrer</Button>
            <Button variant="ghost">Annuler</Button>
            <Button variant="plain" colorPalette="red">Supprimer</Button>
            <Button variant="subtle" aria-pressed>▭ Rectangle</Button>
            <Button variant="lien">+ plage horaire</Button>
            <Button disabled>Désactivé</Button>
          </Wrap>
          <Wrap gap="2" align="center">
            <Button size="2xs">2xs</Button>
            <Button size="xs">xs</Button>
            <Button size="sm">sm</Button>
            <Button size="md" variant="encre">md</Button>
            <IconButton aria-label="Supprimer" variant="ghost" colorPalette="red" size="xs">
              ✕
            </IconButton>
          </Wrap>
        </Exemple>

        <Exemple nom="Segments">
          <Segments
            fitted
            valeur={sens}
            onChange={setSens}
            options={[
              { valeur: 'double', libelle: 'Double sens' },
              { valeur: 'unique', libelle: 'Sens unique' },
            ]}
          />
          <Segments
            fitted
            valeur={usage}
            onChange={setUsage}
            options={[
              { valeur: 'generale', libelle: 'Générale' },
              { valeur: 'bus', libelle: 'Bus' },
              { valeur: 'velo', libelle: 'Vélo' },
              { valeur: 'tram', libelle: 'Tram' },
            ]}
          />
          <Segments
            fitted
            valeur="vert"
            onChange={() => {}}
            options={(['vert', 'orange', 'rouge'] as const).map((c) => ({
              valeur: c,
              libelle: (
                <HStack gap="1.5">
                  <Pastille couleur={`feu.${c}`} />
                  {c[0]!.toUpperCase() + c.slice(1)}
                </HStack>
              ),
            }))}
          />
        </Exemple>

        <Exemple nom="Onglets">
          <Tabs.Root value={onglet} onValueChange={(e) => setOnglet(e.value)}>
            <Tabs.List>
              <Tabs.Trigger value="branches">1. Branches</Tabs.Trigger>
              <Tabs.Trigger value="lignes">2. Lignes</Tabs.Trigger>
              <Tabs.Trigger value="programme">3. Programme</Tabs.Trigger>
              <Tabs.Trigger value="graphe">4. Graphe</Tabs.Trigger>
            </Tabs.List>
          </Tabs.Root>
        </Exemple>

        <Exemple nom="Compteur, interrupteur, case, liste">
          <HStack justify="space-between">
            <Text color="fg.secondary">Voies par sens</Text>
            <Compteur taille="xs" aria-label="Voies par sens" valeur={voies} onChange={setVoies} min={1} max={8} />
          </HStack>
          <HStack justify="space-between">
            <Text>Vert</Text>
            <Compteur aria-label="Vert" valeur={vert} onChange={setVert} min={1} max={300} unite="s" />
          </HStack>
          <HStack justify="space-between">
            <Text>Dégagement (vide : calculé)</Text>
            <Compteur aria-label="Dégagement" valeur={degagement} onChange={setDegagement} placeholder="2" max={30} unite="s" />
          </HStack>
          <HStack justify="space-between" pt="2.5" borderTopWidth="1px" borderColor="border.muted">
            <Text>Détecteur (boucle)</Text>
            <Bascule coche={detecteur} onChange={setDetecteur} />
          </HStack>
          <Case coche={coche} onChange={setCoche}>
            O1→E tout droit
          </Case>
          <Selecteur valeur={nature} onChange={setNature} aria-label="Nature">
            <option value="carrefour">Carrefour à feux</option>
            <option value="giratoire">Giratoire à feux</option>
            <option value="traversee_pietonne">Traversée piétonne à feux</option>
          </Selecteur>
          <Input placeholder="Nom de la rue" />
        </Exemple>

        <Exemple nom="Badges et messages">
          <Wrap gap="2">
            <Badge colorPalette="gray">OSM synchronisé</Badge>
            <Badge colorPalette="orange">3 modifications</Badge>
            <Badge colorPalette="green">Aucun conflit</Badge>
            <Badge colorPalette="red">Incompatible</Badge>
            <Badge colorPalette="brand">sur appel P1</Badge>
          </Wrap>
          <Message ton="erreur">API injoignable</Message>
          <Message ton="avertissement">Branches non enregistrées</Message>
          <Message ton="ok">API connectée · PostGIS 3.5</Message>
          <Text>
            Maintenir <Kbd>Maj</Kbd> + glisser pour sélectionner, <Kbd>Échap</Kbd> pour annuler.
          </Text>
        </Exemple>

        <Exemple nom="Cartes à choix (régime, mouvements)">
          <RadioCard.Root defaultValue="feu">
            <Grid templateColumns="1fr 1fr" gap="1.5">
              {[
                ['feu', 'Protégé par feu'],
                ['cedez', 'Cédez le passage'],
                ['stop', 'Stop'],
                ['prioritaire', 'Prioritaire'],
              ].map(([valeur, libelle]) => (
                <RadioCard.Item key={valeur} value={valeur!}>
                  <RadioCard.ItemHiddenInput />
                  <RadioCard.ItemControl>
                    <RadioCard.ItemText>{libelle}</RadioCard.ItemText>
                  </RadioCard.ItemControl>
                </RadioCard.Item>
              ))}
            </Grid>
          </RadioCard.Root>
          <HStack gap="1.5">
            {['←', '↑', '→', '↶'].map((fleche, i) => (
              <CheckboxCard.Root key={fleche} defaultChecked={i < 2} flex="1" align="center">
                <CheckboxCard.HiddenInput />
                <CheckboxCard.Control>
                  <CheckboxCard.Label fontSize="18px" justifyContent="center">{fleche}</CheckboxCard.Label>
                </CheckboxCard.Control>
              </CheckboxCard.Root>
            ))}
          </HStack>
        </Exemple>

        <Exemple nom="Tableau">
          <Table.Root>
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeader>Demande</Table.ColumnHeader>
                <Table.ColumnHeader>à</Table.ColumnHeader>
                <Table.ColumnHeader>attente du vert</Table.ColumnHeader>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              <Table.Row>
                <Table.Cell fontWeight="semibold">P1</Table.Cell>
                <Table.Cell>12 s</Table.Cell>
                <Table.Cell>34 s</Table.Cell>
              </Table.Row>
              <Table.Row>
                <Table.Cell fontWeight="semibold">T1</Table.Cell>
                <Table.Cell>40 s</Table.Cell>
                <Table.Cell>6 s</Table.Cell>
              </Table.Row>
            </Table.Body>
          </Table.Root>
        </Exemple>
      </Grid>
    </Bloc>
  )
}

const OUTILS = [
  { glyphe: '↖', libelle: 'Sélection', raccourci: 'V' },
  { glyphe: '╱', libelle: 'Route', raccourci: 'R' },
  { glyphe: '▤', libelle: 'Voie', raccourci: 'L' },
  { glyphe: '⤳', libelle: 'Liaison', raccourci: 'C' },
  { glyphe: '⚑', libelle: 'Feu', raccourci: 'F' },
  { glyphe: '⌖', libelle: 'Carrefour', raccourci: 'N' },
]

function ComposantsProjet() {
  const [outil, setOutil] = useState('Route')
  const [etat, setEtat] = useState<EtatLampe>('vert')
  const [choix, setChoix] = useState<string | null>(null)
  const [pointMenu, setPointMenu] = useState<{ x: number; y: number } | null>(null)

  return (
    <Bloc titre="Composants du projet">
      <Grid templateColumns="repeat(auto-fill, minmax(340px, 1fr))" gap="4">
        <Exemple nom="Carte d'en-tête">
          <CarteEnTete
            surtitre="Besançon Voirie"
            titre="Foch × Helvétie × Denfert-Rochereau"
            badges={
              <>
                <Badge colorPalette="orange">3 modifications</Badge>
                <Badge colorPalette="gray">OSM synchronisé</Badge>
              </>
            }
          />
        </Exemple>

        <Exemple nom="Bandeau de mode">
          <BandeauMode
            titre="Nouvelle route"
            aides={[
              'Clic pour poser un point',
              'Double-clic pour terminer',
              <Kbd key="echap" variant="inverse">
                Échap
              </Kbd>,
            ]}
            alignSelf="start"
            flexWrap="wrap"
          />
        </Exemple>

        <Exemple nom="Tête de feu, pastilles, indice">
          <HStack gap="4">
            {(['rouge', 'orange', 'vert'] as const).map((e) => (
              <TeteDeFeu key={e} etat={e} />
            ))}
            <TeteDeFeu etat={null} />
            <HStack gap="2" fontSize="20px" color="fg.secondary">
              <IconeFeu />
              {(['rouge', 'orange', 'vert'] as const).map((e) => (
                <IconeFeu key={e} etat={e} />
              ))}
            </HStack>
            <HStack gap="2">
              <Pastille couleur="feu.vert" />
              <Pastille couleur="conflit.pieton" forme="carre" />
              <Pastille couleur="statut.estime" forme="trait" />
            </HStack>
          </HStack>
          <Indice>Accroché à Avenue d'Helvétie</Indice>
        </Exemple>

        <Exemple nom="Chiffres clés">
          <HStack gap="2">
            <Chiffre valeur="4" libelle="branches" />
            <Chiffre valeur="11" libelle="liaisons" />
            <Chiffre valeur="90 s" libelle="cycle" />
          </HStack>
        </Exemple>

        <Exemple nom="Conflits">
          <Stack gap="0">
            <LigneConflit couleur="conflit.pieton" libelle="O1 → E · tout droit" gravite="incompatible" />
            <LigneConflit couleur="conflit.convergence" libelle="S2 → E · tourne-à-droite" gravite="cede" />
            <LigneConflit couleur="conflit.admis" libelle="Passage piéton S" gravite="admis" />
          </Stack>
        </Exemple>

        <Exemple nom="Menu contextuel (clic droit dans la zone)">
          <MenuContextuel
            point={pointMenu}
            entete="47.2447 N · 6.0212 E"
            onChoisir={setChoix}
            onFermer={() => setPointMenu(null)}
            entrees={[
              { valeur: 'route', glyphe: '╱', libelle: 'Nouvelle route ici', raccourci: 'R' },
              { valeur: 'feu', glyphe: '⚑', libelle: 'Poser un feu', raccourci: 'F' },
              { valeur: 'carrefour', glyphe: '⌖', libelle: 'Créer un carrefour', raccourci: 'N' },
              { type: 'separateur' },
              { valeur: 'coller', glyphe: '⎘', libelle: 'Coller', raccourci: 'Ctrl V' },
              { type: 'separateur' },
              { valeur: 'supprimer', glyphe: '✕', libelle: 'Supprimer', raccourci: 'Suppr', danger: true },
            ]}
          />
          <Flex
            h="28"
            align="center"
            justify="center"
            bg="bg.muted"
            borderRadius="l2"
            borderWidth="1px"
            borderStyle="dashed"
            borderColor="border"
            onContextMenu={(e) => (e.preventDefault(), setPointMenu({ x: e.clientX, y: e.clientY }))}
          >
            <Aide>{choix ? `Choisi : ${choix}` : 'Clic droit ici'}</Aide>
          </Flex>
        </Exemple>
      </Grid>

      <Exemple nom="Barre d'outils">
        <Flex justify="center" py="4" bg="bg.muted" borderRadius="l2">
          <BarreOutils.Root>
            {OUTILS.map((o) => (
              <BarreOutils.Outil key={o.libelle} {...o} actif={outil === o.libelle} onClick={() => setOutil(o.libelle)} />
            ))}
            <BarreOutils.Separateur />
            <BarreOutils.Outil glyphe={<IconeFeu />} libelle="Plan" raccourci="⇥" title="Plan de feux (Tab)" actif={outil === 'Plan'} onClick={() => setOutil('Plan')} />
            <BarreOutils.Separateur />
            <Button variant="encre" size="md" borderRadius="9px">
              Enregistrer
            </Button>
          </BarreOutils.Root>
        </Flex>
      </Exemple>

      <Exemple nom="Transports en commun">
        <Transports />
      </Exemple>

      <Exemple nom="Popups de la carte">
        <Flex gap="4" wrap="wrap" align="start" p="4" bg="bg.muted" borderRadius="l2">
          <PopupCarte
            icone={<TeteDeFeu etat={etat} />}
            titre="Feu E1"
            soustitre="Avenue d'Helvétie · voie entrante 1 (←)"
            onFermer={() => {}}
            pied={
              <>
                <Button variant="plain" colorPalette="red" px="2.5">
                  Supprimer
                </Button>
                <BarreOutils.Espace />
                <Button>Plan de feux</Button>
                <Button variant="solid">Appliquer</Button>
              </>
            }
          >
            <Section libelle="Aperçu d'état">
              <Segments
                fitted
                size="md"
                valeur={etat}
                onChange={setEtat}
                options={(['vert', 'orange', 'rouge'] as const).map((c) => ({
                  valeur: c,
                  libelle: (
                    <HStack gap="1.5">
                      <Pastille couleur={`feu.${c}`} />
                      {c[0]!.toUpperCase() + c.slice(1)}
                    </HStack>
                  ),
                }))}
              />
            </Section>
            <Section libelle="Ligne de feux">
              <Selecteur valeur="L3" onChange={() => {}} aria-label="Ligne de feux" width="full">
                <option value="L3">L3 — Helvétie tout droit</option>
              </Selecteur>
            </Section>
            <Section libelle="Durées">
              {[
                ['Vert', 28],
                ['Orange', 3],
                ['Rouge de dégagement', 2],
              ].map(([libelle, valeur]) => (
                <HStack key={libelle} justify="space-between">
                  <Text>{libelle}</Text>
                  <Compteur aria-label={String(libelle)} valeur={Number(valeur)} onChange={() => {}} unite="s" />
                </HStack>
              ))}
            </Section>
            <HStack justify="space-between" pt="2.5" borderTopWidth="1px" borderColor="border.muted">
              <Text>Détecteur (boucle)</Text>
              <Bascule coche onChange={() => {}} />
            </HStack>
          </PopupCarte>

          <PopupCarte
            titre={
              <HStack gap="1.5">
                <Badge colorPalette="brand">E2</Badge>→<Text as="span">S · sortie</Text>
              </HStack>
            }
            soustitre="Tourne-à-gauche · Helvétie → Pont Robert Schwint"
            onFermer={() => {}}
            pied={
              <>
                <Button variant="plain" colorPalette="red" px="2.5">
                  Supprimer
                </Button>
                <BarreOutils.Espace />
                <Button>Changer de sortie</Button>
              </>
            }
          >
            <Section libelle="Régime">
              <RadioCard.Root defaultValue="feu">
                <Grid templateColumns="1fr 1fr" gap="1.5">
                  {['Protégé par feu', 'Cédez le passage', 'Stop', 'Prioritaire'].map((libelle, i) => (
                    <RadioCard.Item key={libelle} value={i === 0 ? 'feu' : libelle}>
                      <RadioCard.ItemHiddenInput />
                      <RadioCard.ItemControl>
                        <RadioCard.ItemText>{libelle}</RadioCard.ItemText>
                      </RadioCard.ItemControl>
                    </RadioCard.Item>
                  ))}
                </Grid>
              </RadioCard.Root>
            </Section>
            <Section libelle="Conflits (3)">
              <Stack gap="0">
                <LigneConflit couleur="conflit.pieton" libelle="O1 → E · tout droit" gravite="incompatible" />
                <LigneConflit couleur="conflit.convergence" libelle="S2 → E · tourne-à-droite" gravite="cede" />
                <LigneConflit couleur="conflit.croisement" libelle="Passage piéton S" gravite="cede" />
              </Stack>
            </Section>
          </PopupCarte>

          <PopupCarte
            taille="compacte"
            icone={<EtiquetteVehicule mode="tram" ligne="T2" couleur="#006D78" couleurTexte="#FFFFFF" />}
            titre="T2 → Hauts du Chazal"
            soustitre="Rame 812"
            onFermer={() => {}}
          >
            <Text>Chamars → Canot</Text>
            <Text>Arrivée prévue dans 2 min</Text>
            <Aide>Durée du tronçon : médiane de 214 passages observés</Aide>
          </PopupCarte>

          <PopupCarte
            taille="compacte"
            icone={<EtiquetteVehicule mode="bus" ligne="L4" couleur="#E2001A" couleurTexte="#FFFFFF" />}
            titre="L4 → Pôle Orchamps"
            soustitre="Bus 146"
            onFermer={() => {}}
          >
            <Text>4 Vents → Gounod</Text>
            <Text>Arrivée prévue dans 40 s</Text>
            <Aide>Vitesse moyenne du tronçon : 31 km/h · zone probable : 340 m</Aide>
          </PopupCarte>
        </Flex>
      </Exemple>
    </Bloc>
  )
}

/** Lignes d'exemple pour le choix des lignes de bus. */
const LIGNES_BUS: LigneBus[] = [
  { ligne: 'L3', couleur: '#006AB3', couleurTexte: '#FFFFFF', categorie: 'lianes' },
  { ligne: 'L4', couleur: '#E2001A', couleurTexte: '#FFFFFF', categorie: 'lianes' },
  { ligne: 'L5', couleur: '#1FA22E', couleurTexte: '#FFFFFF', categorie: 'lianes' },
  { ligne: 'L6', couleur: '#FFE500', couleurTexte: '#000000', categorie: 'lianes' },
  { ligne: '7', couleur: '#A74C21', couleurTexte: '#FFFFFF', categorie: 'urbaines' },
  { ligne: '10', couleur: '#CECB00', couleurTexte: '#000000', categorie: 'urbaines' },
  { ligne: '51', couleur: '#009EE0', couleurTexte: '#FFFFFF', categorie: 'periurbaines' },
  { ligne: 'D104', couleur: '#E8526B', couleurTexte: '#FFFFFF', categorie: 'scolaires' },
]

/** Étiquettes des véhicules sur la carte, pastilles et accordéon du choix des lignes de bus. */
function Transports() {
  const [masquees, setMasquees] = useState<Set<string>>(() => new Set(['D104']))
  return (
    <Stack gap="4">
      <Stack gap="1.5">
        <LibelleSection>Étiquettes de véhicules (marqueurs de la carte)</LibelleSection>
        <Wrap gap="3" align="center" p="4" bg="bg.muted" borderRadius="l2">
          {ETIQUETTES.map((e) => (
            <EtiquetteVehicule key={`${e.mode}-${e.ligne}`} {...e} />
          ))}
        </Wrap>
        <Aide>
          Pictogramme et numéro aux couleurs GTFS de la ligne, bord blanc pour la photo aérienne. Tram : silhouette de
          rame, bas plat et large, haut arrondi. Bus : carré. Estompée (55 %) au terminus. Sur la carte, la traînée
          (zone probable) est tracée dans la couleur de la ligne sous l'étiquette.
        </Aide>
      </Stack>
      <Stack gap="1.5">
        <LibelleSection>Pastilles de ligne</LibelleSection>
        <HStack gap="1" wrap="wrap">
          {LIGNES_BUS.map((l) => (
            <PastilleLigne
              key={l.ligne}
              {...l}
              affichee={!masquees.has(l.ligne)}
              onChange={(affichee) =>
                setMasquees((m) => {
                  const suivantes = new Set(m)
                  if (affichee) suivantes.delete(l.ligne)
                  else suivantes.add(l.ligne)
                  return suivantes
                })
              }
            />
          ))}
        </HStack>
        <Aide>Pleine : ligne affichée ; contour : masquée.</Aide>
      </Stack>
      <Stack gap="1.5">
        <LibelleSection>Choix des lignes de bus (Données brutes, Calques)</LibelleSection>
        <ChoixLignesBus
          lignes={LIGNES_BUS}
          masquees={masquees}
          onChange={setMasquees}
          enCirculation={new Map([['L3', 4], ['L4', 3], ['7', 2], ['51', 1]])}
        />
      </Stack>
    </Stack>
  )
}

function Ecrans() {
  const [plan, setPlan] = useState('pleine')
  return (
    <Bloc titre="Assemblage : clic sur le carrefour">
      <Box position="relative" h="520px" borderRadius="barre" overflow="hidden" bg="bg.muted" boxShadow="0 1px 3px rgba(0,0,0,.08)">
        <CarteEnTete
          position="absolute"
          top="4"
          left="4"
          w="300px"
          surtitre="Besançon Voirie"
          titre="Foch × Helvétie × Denfert-Rochereau"
          badges={<Badge colorPalette="gray">Sélection : Carrefour</Badge>}
        />
        <Stack position="absolute" top="4" right="4" w="260px" gap="2.5" p="3.5" bg="bg.panel" borderRadius="l3" boxShadow="popup">
          <Text textStyle="md" fontWeight="semibold">
            Carrefour Foch
          </Text>
          <HStack gap="2">
            <Chiffre valeur="4" libelle="branches" />
            <Chiffre valeur="11" libelle="liaisons" />
            <Chiffre valeur="90 s" libelle="cycle" />
          </HStack>
          <Button size="sm">Détecter les branches depuis OSM</Button>
        </Stack>
        <PanneauBas.Root position="absolute" left="0" right="0" bottom="0" h="220px">
          <PanneauBas.Entete titre="Plan de feux">
            <Segments
              valeur={plan}
              onChange={setPlan}
              options={[
                { valeur: 'pleine', libelle: 'Heure pleine' },
                { valeur: 'creuse', libelle: 'Heure creuse' },
                { valeur: 'nuit', libelle: 'Nuit (clignotant)' },
              ]}
            />
            <Badge colorPalette="green" size="md">
              Aucun conflit
            </Badge>
            <Box flex="1" />
            <Valeur color="fg.secondary">t = 18 s / 90 s</Valeur>
            <Button variant="encre">▶ Simuler</Button>
            <IconButton aria-label="Fermer" size="sm">
              ×
            </IconButton>
          </PanneauBas.Entete>
          <PanneauBas.Corps>
            <Stack gap="1.5">
              {[
                ['L1', 'Foch tout droit', 0, 36],
                ['L2', 'Helvétie', 40, 30],
                ['P1', 'Piétons Foch', 74, 12],
              ].map(([code, nom, debut, duree]) => (
                <HStack key={String(code)} gap="3">
                  <Text w="10" fontWeight="semibold">
                    {code}
                  </Text>
                  <Text w="32" color="fg.muted" textStyle="xs">
                    {nom}
                  </Text>
                  <Box flex="1" position="relative" h="4">
                    <Box position="absolute" insetX="0" top="calc(50% - 1.5px)" h="3px" bg="feu.rouge" opacity={0.55} />
                    <Box position="absolute" top="0" h="full" left={`${(Number(debut) / 90) * 100}%`} w={`${(Number(duree) / 90) * 100}%`} bg="feu.vert" borderRadius="3px" />
                  </Box>
                </HStack>
              ))}
            </Stack>
          </PanneauBas.Corps>
        </PanneauBas.Root>
      </Box>
    </Bloc>
  )
}
