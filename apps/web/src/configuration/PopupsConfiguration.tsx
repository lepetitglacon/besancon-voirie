/**
 * Popups de la configuration d'un carrefour : un clic sur un élément de la carte (voie, liaison,
 * feu, code de branche) ouvre une popup courte ancrée à cet élément.
 */
import { Badge, Button, HStack, Input, Stack, Text } from '@chakra-ui/react'
import {
  cleVoie,
  flechesParVoie,
  lireCleVoie,
  matriceConflits,
  mouvementsDepuisConnexions,
  NOEUDS_CONSEILLES,
  NOEUDS_MIN,
  noeudDeVoie,
  type LonLat,
} from '@voirie/engine'
import {
  typeLigne,
  type BranchesCarrefour,
  type ConfianceIa,
  type FeuResume,
  type PrioriteEntree,
  type SourceBranche,
  type TypeVoie,
} from '@voirie/schema'
import {
  Aide,
  BarreOutils,
  Bascule,
  Case,
  Compteur,
  LigneConflit,
  Pastille,
  PopupCarte,
  Section,
  Segments,
  Selecteur,
  TeteDeFeu,
  type EtatLampe,
} from '../ds'
import { DIRECTIONS, FLECHES, SIGNAUX } from './libelles'
import {
  ajouterVoie,
  basculerChainage,
  basculerConnexion,
  inverserVoie,
  basculerTraversee,
  changerPrioriteEntree,
  changerTypeVoie,
  changerVoiesTroncon,
  couleursVoies,
  regenererVoies,
  renommerBranche,
  raccorderBranche,
  reproposerLiaisons,
  retirerAnneau,
  supprimerNoeud,
  retirerVoie,
  supprimerBranche,
  voiesDe,
  type Brouillon,
} from './modele'
import type { OutilCarte } from './actions'
import type { BrouillonLignes } from './OngletLignes'
import { geometrieEnregistree } from './programme'

const TYPES: Array<{ valeur: TypeVoie; libelle: string }> = [
  { valeur: 'generale', libelle: 'Générale' },
  { valeur: 'bus', libelle: 'Bus' },
  { valeur: 'velo', libelle: 'Vélo' },
  { valeur: 'tram', libelle: 'Tram' },
]

/** Régimes d'une entrée de giratoire hors feux (panneaux AB3a, AB4, ou aucun). */
const PRIORITES: Array<{ valeur: PrioriteEntree; libelle: string }> = [
  { valeur: 'cedez_le_passage', libelle: 'Cédez' },
  { valeur: 'stop', libelle: 'Stop' },
  { valeur: 'priorite_a_droite', libelle: 'Priorité à droite' },
]

const NATURES_CONFLIT = {
  croisement: { titre: 'trajectoires qui se croisent', couleur: 'conflit.croisement' },
  insertion: { titre: 'insertion sur l’anneau', couleur: 'conflit.insertion' },
  convergence: { titre: 'même sortie', couleur: 'conflit.convergence' },
  pieton: { titre: 'traversée piétonne', couleur: 'conflit.pieton' },
} as const

const nomBranche = (brouillon: Brouillon, code: string) => brouillon.branches.find((b) => b.code === code)?.nom ?? 'sans nom'

// ── Voie ──

interface PropsVoie {
  cle: string
  brouillon: Brouillon
  onChanger: (brouillon: Brouillon) => void
  onOutil: (outil: OutilCarte) => void
  onBranche: (code: string) => void
  /** Voie passée d'entrante à sortante (ou l'inverse) : sa clé change. */
  onInverser: (inversee: { brouillon: Brouillon; cle: string }) => void
  onFermer: () => void
}

export function PopupVoie({ cle, brouillon, onChanger, onOutil, onBranche, onInverser, onFermer }: PropsVoie) {
  const lue = lireCleVoie(cle)
  const branche = lue && brouillon.branches.find((b) => b.code === lue.branche)
  const voie = branche?.voies.find((v) => v.sens === lue!.sens && v.rang === lue!.rang)
  if (!lue || !branche || !voie) return null
  const entrante = voie.sens === 'entrante'
  const directions = entrante ? (flechesParVoie(brouillon.branches, brouillon.connexions)[cle] ?? []) : []
  const liaisons = brouillon.connexions.filter((c) => c.de === cle || c.vers === cle)
  const chainages = brouillon.chainages.filter((c) => c.de === cle || c.vers === cle)

  return (
    <PopupCarte
      icone={<Pastille couleur={couleursVoies(brouillon.branches).get(cle) ?? 'border.emphasized'} w="3" h="3" />}
      titre={`Voie ${entrante ? 'entrante' : 'sortante'} ${voie.rang + 1} · ${branche.code}`}
      soustitre={`${branche.nom ?? 'Rue sans nom'} · ${cle}`}
      onFermer={onFermer}
      pied={
        <>
          <Button variant="lien" size="xs" onClick={() => onBranche(branche.code)}>
            Branche {branche.code}
          </Button>
          <BarreOutils.Espace />
          <Button onClick={() => onOutil('ajuster')}>Caler (L)</Button>
          {entrante && (
            <Button variant="solid" onClick={() => onOutil('connecter')}>
              Relier (C)
            </Button>
          )}
        </>
      }
    >
      <Section libelle="Usage">
        <Segments
          fitted
          aria-label="Usage de la voie"
          valeur={voie.type}
          onChange={(type) => onChanger(changerTypeVoie(brouillon, branche.code, voie.sens, voie.rang, type))}
          options={TYPES}
        />
      </Section>
      <Section libelle="Sens">
        <HStack justify="space-between">
          <Text textStyle="sm">{entrante ? 'Arrive au carrefour' : 'Part du carrefour'}</Text>
          <Button
            size="xs"
            title="Même tracé, même sens de circulation : la ligne d’arrêt passe à l’autre bout"
            onClick={() => {
              const inversee = inverserVoie(brouillon, cle)
              if (inversee) onInverser(inversee)
            }}
          >
            Passer en {entrante ? 'sortante' : 'entrante'}
          </Button>
        </HStack>
        {(liaisons.length > 0 || chainages.length > 0) && <Aide>Ses liaisons et chaînages seront retirés.</Aide>}
      </Section>
      {entrante && (
        <Section libelle="Mouvements">
          <HStack gap="1.5">
            {FLECHES.map((f) => {
              const autorise = directions.includes(f.direction)
              return (
                <Text
                  key={f.direction}
                  as="span"
                  flex="1"
                  h="10"
                  display="flex"
                  alignItems="center"
                  justifyContent="center"
                  fontSize="18px"
                  borderRadius="l2"
                  borderWidth="1px"
                  borderColor={autorise ? 'brand.solid' : 'border'}
                  bg={autorise ? 'brand.solid' : undefined}
                  color={autorise ? 'brand.contrast' : 'fg.subtle'}
                  title={`${f.titre} : ${autorise ? 'autorisé' : 'aucune liaison'}`}
                >
                  {f.symbole}
                </Text>
              )
            })}
          </HStack>
          <Aide>Déduits des liaisons de la voie : l'outil Liaison (C) les modifie.</Aide>
        </Section>
      )}
      <Section libelle={`Liaisons (${liaisons.length})`}>
        {liaisons.length === 0 ? (
          <Aide>{entrante ? 'Aucune liaison : glissez depuis cette voie avec l’outil Liaison.' : 'Aucune voie entrante ne mène ici.'}</Aide>
        ) : (
          liaisons.map((c) => (
            <HStack key={`${c.de}>${c.vers}`} justify="space-between" textStyle="sm">
              <Text>
                {c.de} → {c.vers}
              </Text>
              <Button variant="lien" size="xs" colorPalette="red" onClick={() => onChanger(basculerConnexion(brouillon, c.de, c.vers))}>
                retirer
              </Button>
            </HStack>
          ))
        )}
      </Section>
      {chainages.length > 0 && (
        <Section libelle={`Chaînages (${chainages.length})`}>
          {chainages.map((c) => (
            <HStack key={`${c.de}>${c.vers}`} justify="space-between" textStyle="sm">
              <Text>
                {c.de} ⇢ {c.vers}
              </Text>
              <Button variant="lien" size="xs" colorPalette="red" onClick={() => onChanger(basculerChainage(brouillon, c.de, c.vers))}>
                retirer
              </Button>
            </HStack>
          ))}
        </Section>
      )}
    </PopupCarte>
  )
}

// ── Liaison ──

interface PropsLiaison {
  de: string
  vers: string
  brouillon: Brouillon
  /** Configuration enregistrée : les lignes de feux et leurs conflits s'appuient sur elle. */
  enregistree: BranchesCarrefour | undefined
  lignes: BrouillonLignes
  onChanger: (brouillon: Brouillon) => void
  onLignes: () => void
  onFermer: () => void
}

export function PopupLiaison({ de, vers, brouillon, enregistree, lignes, onChanger, onLignes, onFermer }: PropsLiaison) {
  const origine = de.split(':')[0]!
  const destination = vers.split(':')[0]!
  const mouvement = `${origine}>${destination}`
  const direction = mouvementsDepuisConnexions(brouillon.branches, brouillon.connexions).find(
    (m) => m.origine === origine && m.destination === destination,
  )?.direction
  const ligne = lignes.lignes.find((l) => l.mouvements.includes(mouvement))
  const conflits =
    ligne && enregistree
      ? matriceConflits(
          lignes.lignes.map((l) => ({ ...l, type: typeLigne(l.signal) })),
          geometrieEnregistree(enregistree),
          lignes.conflits_admis,
        ).filter((c) => c.a === ligne.code || c.b === ligne.code)
      : []

  return (
    <PopupCarte
      titre={
        <HStack gap="1.5">
          <Badge colorPalette="brand">{de}</Badge>→<Badge colorPalette="gray">{vers}</Badge>
        </HStack>
      }
      soustitre={`${direction ? DIRECTIONS[direction] : 'mouvement'} · ${nomBranche(brouillon, origine)} → ${nomBranche(brouillon, destination)}`}
      onFermer={onFermer}
      pied={
        <>
          <Button
            variant="plain"
            colorPalette="red"
            px="2"
            onClick={() => {
              onChanger(basculerConnexion(brouillon, de, vers))
              onFermer()
            }}
          >
            Supprimer
          </Button>
          <BarreOutils.Espace />
          <Button onClick={onLignes}>Lignes de feux (Tab)</Button>
        </>
      }
    >
      <Section libelle="Ligne de feux">
        {ligne ? (
          <Text>
            <Text as="strong">{ligne.code}</Text> · {SIGNAUX[ligne.signal].libelle}
          </Text>
        ) : (
          <Aide>Aucune ligne de feux ne commande ce mouvement.</Aide>
        )}
      </Section>
      {ligne && (
        <Section libelle={`Conflits de ${ligne.code} (${conflits.length})`}>
          {conflits.length === 0 ? (
            <Aide>Aucun conflit avec les autres lignes.</Aide>
          ) : (
            <Stack gap="0">
              {conflits.map((c) => {
                const autre = c.a === ligne.code ? c.b : c.a
                const nature = NATURES_CONFLIT[c.nature]
                return (
                  <LigneConflit
                    key={autre}
                    couleur={nature.couleur}
                    libelle={`${autre} · ${nature.titre}`}
                    gravite={c.admis ? 'admis' : 'incompatible'}
                    title={c.cause.join(' / ')}
                  />
                )
              })}
            </Stack>
          )}
        </Section>
      )}
    </PopupCarte>
  )
}

// ── Feu ──

interface PropsFeu {
  feu: FeuResume
  /** État du feu à l'instant lu dans le panneau bas, null hors lecture. */
  etat: EtatLampe | null
  lignes: BrouillonLignes
  onChangerLignes: (lignes: BrouillonLignes) => void
  onRemettreOsm: () => void
  onOutil: (outil: OutilCarte) => void
  onFermer: () => void
}

export function PopupFeu({ feu, etat, lignes, onChangerLignes, onRemettreOsm, onOutil, onFermer }: PropsFeu) {
  const ligne = lignes.lignes.find((l) => l.feux.includes(feu.id))
  const affecter = (code: string) =>
    onChangerLignes({
      ...lignes,
      lignes: lignes.lignes.map((l) => {
        const sans = l.feux.filter((f) => f !== feu.id)
        return { ...l, feux: l.code === code ? [...sans, feu.id] : sans }
      }),
    })

  return (
    <PopupCarte
      icone={<TeteDeFeu etat={etat} />}
      titre={`Feu ${feu.type === 'pieton' ? 'piéton' : 'véhicule'}${ligne ? ` · ${ligne.code}` : ''}`}
      soustitre={feu.osm_id ? `Nœud OSM ${feu.osm_id}` : 'Ajouté à la main'}
      onFermer={onFermer}
      pied={
        <>
          {feu.position_manuelle && feu.osm_lon !== null && (
            <Button variant="lien" size="xs" onClick={onRemettreOsm}>
              Remettre à la position OSM
            </Button>
          )}
          <BarreOutils.Espace />
          <Button onClick={() => onOutil('feux')}>Poser sur son mât (F)</Button>
        </>
      }
    >
      <Section libelle="Ligne de feux">
        {lignes.lignes.length === 0 ? (
          <Aide>Aucune ligne de feux : créez-les dans le panneau Plan de feux (Tab).</Aide>
        ) : (
          <Selecteur width="full" aria-label="Ligne de feux" valeur={ligne?.code ?? ''} onChange={affecter}>
            <option value="">Aucune</option>
            {lignes.lignes.map((l) => (
              <option key={l.code} value={l.code}>
                {l.code} — {SIGNAUX[l.signal].libelle}
              </option>
            ))}
          </Selecteur>
        )}
      </Section>
      <HStack gap="2" wrap="wrap">
        {feu.position_manuelle ? <Badge colorPalette="green">Posé sur son mât</Badge> : <Badge colorPalette="gray">Position OSM</Badge>}
        {!feu.present_osm && <Badge colorPalette="red">Disparu d'OpenStreetMap</Badge>}
      </HStack>
    </PopupCarte>
  )
}

// ── Branche ──

interface PropsBranche {
  code: string
  brouillon: Brouillon
  centre: LonLat
  source: SourceBranche | undefined
  /** Confiance et remarques de l'IA, si la branche vient d'une proposition OSM + IA. */
  ia: { confiance: ConfianceIa; remarques: string } | undefined
  onChanger: (brouillon: Brouillon) => void
  /** Le code de la branche a changé : la popup suit la branche renommée. */
  onRenommer: (code: string) => void
  onFermer: () => void
}

export function PopupBranche({ code, brouillon, centre, source, ia, onChanger, onRenommer, onFermer }: PropsBranche) {
  const branche = brouillon.branches.find((b) => b.code === code)
  if (!branche) return null
  const nombre = (sens: 'entrante' | 'sortante') => voiesDe(branche, sens).length
  const ajuster = (sens: 'entrante' | 'sortante', cible: number | null) => {
    let suivant = brouillon
    for (let n = nombre(sens); n < (cible ?? 0); n++) suivant = ajouterVoie(suivant, code, sens, centre)
    for (let n = nombre(sens); n > (cible ?? 0); n--) suivant = retirerVoie(suivant, code, sens)
    onChanger(suivant)
  }

  return (
    <PopupCarte
      titre={`Branche ${branche.code}`}
      soustitre={branche.nom ?? 'Rue sans nom'}
      onFermer={onFermer}
      pied={
        <>
          <Button
            variant="plain"
            colorPalette="red"
            px="2"
            onClick={() => {
              onChanger(supprimerBranche(brouillon, code))
              onFermer()
            }}
          >
            Supprimer
          </Button>
          <BarreOutils.Espace />
          <Button onClick={() => onChanger(regenererVoies(brouillon, code, centre))} title="Remettre les voies à leur position proposée">
            Replacer les voies
          </Button>
        </>
      }
    >
      <Section libelle="Code et rue">
        <HStack gap="1.5">
          <Input
            flex="0 0 56px"
            fontWeight="bold"
            textAlign="center"
            aria-label="Code de la branche"
            value={branche.code}
            onChange={(e) => {
              const nouveau = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4)
              if (nouveau && !brouillon.branches.some((b) => b.code === nouveau)) {
                onChanger(renommerBranche(brouillon, code, nouveau))
                onRenommer(nouveau)
              }
            }}
          />
          <Input
            flex="1"
            placeholder="Nom de la rue"
            aria-label="Nom de la rue"
            value={branche.nom ?? ''}
            onChange={(e) =>
              onChanger({ ...brouillon, branches: brouillon.branches.map((b) => (b.code === code ? { ...b, nom: e.target.value || null } : b)) })
            }
          />
        </HStack>
      </Section>
      <Section libelle="Voies">
        {(['entrante', 'sortante'] as const).map((sens) => (
          <HStack key={sens} justify="space-between">
            <Text>{sens === 'entrante' ? 'Entrantes' : 'Sortantes'}</Text>
            <Compteur taille="xs" aria-label={`Voies ${sens}s`} min={0} max={8} valeur={nombre(sens)} onChange={(n) => ajuster(sens, n)} />
          </HStack>
        ))}
      </Section>
      {brouillon.anneau && (
        <Section libelle="Nœud de raccordement">
          <Selecteur
            width="full"
            aria-label="Nœud de raccordement"
            valeur={branche.noeud ?? ''}
            onChange={(valeur) => onChanger(raccorderBranche(brouillon, code, valeur || null))}
          >
            <option value="">Aucun (tram ou bus qui traverse l’îlot)</option>
            {brouillon.anneau.noeuds.map((n) => (
              <option key={n.code} value={n.code}>
                Nœud {n.code}
              </option>
            ))}
          </Selecteur>
        </Section>
      )}
      {brouillon.anneau && (
        <Section libelle="Entrée sur l’anneau (hors feux)">
          <Segments
            fitted
            aria-label="Régime de l’entrée"
            valeur={branche.priorite_entree ?? 'cedez_le_passage'}
            onChange={(priorite) => onChanger(changerPrioriteEntree(brouillon, code, priorite))}
            options={PRIORITES}
          />
          <Aide>
            Cédez-le-passage à l’anneau par défaut ; priorité à droite si l’anneau n’est pas prioritaire. Une entrée à
            feux garde ce régime quand ses feux sont éteints ou au jaune clignotant.
          </Aide>
        </Section>
      )}
      <HStack justify="space-between" pt="2.5" borderTopWidth="1px" borderColor="border.muted">
        <Text>{branche.passages.length > 1 ? `Passages piétons (${branche.passages.length})` : 'Passage piéton'}</Text>
        <Bascule coche={branche.passages.length > 0} onChange={() => onChanger(basculerTraversee(brouillon, code, centre))} />
      </HStack>
      {source && (
        <HStack gap="1.5" wrap="wrap">
          <Badge colorPalette={SOURCES[source].couleur}>{SOURCES[source].libelle}</Badge>
          {ia && <Badge colorPalette={CONFIANCES[ia.confiance]}>Confiance {ia.confiance}</Badge>}
        </HStack>
      )}
      {ia?.remarques && <Aide>✦ {ia.remarques}</Aide>}
      {voiesDe(branche, 'entrante').some((v) => !brouillon.connexions.some((c) => c.de === cleVoie(code, 'entrante', v.rang))) && (
        <Badge colorPalette="orange" alignSelf="start">
          Voie entrante sans liaison
        </Badge>
      )}
    </PopupCarte>
  )
}

const SOURCES: Record<SourceBranche, { couleur: string; libelle: string }> = {
  osm: { couleur: 'green', libelle: 'Liaisons d’après OSM' },
  defaut: { couleur: 'orange', libelle: 'Liaisons par défaut, à vérifier' },
  ia: { couleur: 'purple', libelle: 'Lu sur la photo par l’IA' },
}
const CONFIANCES: Record<ConfianceIa, string> = { haute: 'green', moyenne: 'orange', basse: 'red' }

// ── Anneau d'un giratoire (carte d'en-tête) ──

interface PropsAnneau {
  brouillon: Brouillon
  onChanger: (brouillon: Brouillon) => void
  onOutil: (outil: OutilCarte) => void
}

/** Anneau d'un giratoire : ses nœuds, posés avec l'outil Nœud ; le retirer. */
export function ReglageAnneau({ brouillon, onChanger, onOutil }: PropsAnneau) {
  const noeuds = brouillon.anneau?.noeuds.length ?? 0
  // Le tram ou un bus en site propre qui traverse l'îlot n'a pas à être raccordé.
  const sitePropre = (b: Brouillon['branches'][number]) => b.voies.length > 0 && b.voies.every((v) => v.type === 'tram' || v.type === 'bus')
  const rues = brouillon.branches.filter((b) => !b.troncon && !sitePropre(b))
  const raccordees = rues.filter((b) => b.noeud).length
  return (
    <Section libelle="Anneau">
      <HStack justify="space-between">
        <Text>
          {noeuds} nœud{noeuds > 1 ? 's' : ''} · {raccordees}/{rues.length} rue{rues.length > 1 ? 's' : ''} raccordée{raccordees > 1 ? 's' : ''}
        </Text>
        <HStack gap="1">
          <Button variant="lien" size="xs" onClick={() => onOutil('noeud')}>
            Nœuds (N)
          </Button>
          {noeuds > 0 && (
            <Button variant="lien" size="xs" colorPalette="red" onClick={() => onChanger(retirerAnneau(brouillon))}>
              Retirer
            </Button>
          )}
        </HStack>
      </HStack>
      {noeuds < NOEUDS_MIN ? (
        <Aide>Posez les nœuds là où les rues touchent l’anneau, dans n’importe quel ordre : la boucle se ferme au troisième.</Aide>
      ) : (
        noeuds < NOEUDS_CONSEILLES && <Aide>Quatre nœuds au moins suivent bien la forme de l’anneau.</Aide>
      )}
    </Section>
  )
}

// ── Nœud d'anneau ──

interface PropsNoeud {
  code: string
  brouillon: Brouillon
  onChanger: (brouillon: Brouillon) => void
  onOutil: (outil: OutilCarte) => void
  onFermer: () => void
}

/** Nœud d'anneau : les rues qui s'y raccordent, les voies du tronçon qui en part, ses liaisons. */
export function PopupNoeud({ code, brouillon, onChanger, onOutil, onFermer }: PropsNoeud) {
  const { anneau } = brouillon
  if (!anneau?.noeuds.some((n) => n.code === code)) return null
  const troncon = brouillon.branches.find((b) => b.troncon && b.noeud === code)
  const rues = brouillon.branches.filter((b) => !b.troncon)
  const liaisons = brouillon.connexions.filter((c) => noeudDeVoie(c.de, brouillon.branches, anneau) === code)
  return (
    <PopupCarte
      titre={`Nœud ${code}`}
      soustitre="Mini-carrefour de l’anneau"
      onFermer={onFermer}
      pied={
        <>
          <Button
            variant="plain"
            colorPalette="red"
            px="2"
            onClick={() => {
              onChanger(supprimerNoeud(brouillon, code))
              onFermer()
            }}
          >
            Supprimer
          </Button>
          <BarreOutils.Espace />
          <Button onClick={() => onOutil('connecter')}>Relier (C)</Button>
        </>
      }
    >
      <Section libelle="Rues raccordées">
        {rues.length === 0 ? (
          <Aide>Aucune rue : détectez les branches depuis OSM (O).</Aide>
        ) : (
          <Stack gap="1">
            {rues.map((b) => (
              <Case key={b.code} coche={b.noeud === code} onChange={(coche) => onChanger(raccorderBranche(brouillon, b.code, coche ? code : null))}>
                {b.code} · {b.nom ?? 'sans nom'}
                {b.noeud && b.noeud !== code && (
                  <Text as="span" color="fg.muted">
                    {' '}
                    (nœud {b.noeud})
                  </Text>
                )}
              </Case>
            ))}
          </Stack>
        )}
      </Section>
      {troncon && (
        <HStack justify="space-between">
          <Text>Voies du tronçon {troncon.code}</Text>
          <Compteur
            taille="xs"
            aria-label={`Voies du tronçon ${troncon.code}`}
            min={1}
            max={4}
            valeur={voiesDe(troncon, 'sortante').length}
            onChange={(n) => onChanger(changerVoiesTroncon(brouillon, troncon.code, n ?? 1))}
          />
        </HStack>
      )}
      <HStack justify="space-between" pt="2.5" borderTopWidth="1px" borderColor="border.muted">
        <Text>
          {liaisons.length} liaison{liaisons.length > 1 ? 's' : ''}
        </Text>
        <Button variant="lien" size="xs" onClick={() => onChanger(reproposerLiaisons(brouillon, code))} title="Remplacer les liaisons du nœud par celles proposées : continuer, sortir, s’insérer">
          Proposer les liaisons
        </Button>
      </HStack>
    </PopupCarte>
  )
}
