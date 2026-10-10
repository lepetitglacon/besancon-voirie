/**
 * Profils en travers au format Streetmix (`data.street`, schéma 35) — docs/integration-streetmix.md.
 *
 * Une rue Streetmix se lit de gauche à droite par un observateur posé au début du tronçon, qui
 * regarde vers sa fin : les voies `outbound` s'éloignent de lui (sens `avant` du tronçon), les
 * voies `inbound` viennent vers lui (sens `arriere`). Circulation à droite : le sens arrière est à
 * gauche, le sens avant à droite.
 *
 *   trottoir G │ arrière[n-1] … arrière[0] ║ avant[0] … avant[n-1] │ trottoir D
 *
 * Le rang 0 d'un sens est la voie la plus à gauche pour qui y circule, donc la plus proche de l'axe.
 */
import { largeurEmprise, cleEmprise, type EmprisesTroncon } from './editionVoies.js';
import { LARGEUR_VOIE_VELO_M, type LonLat } from './geometrie.js';
import { typesVoies, type TypeVoieReseau } from './reseau.js';

/** Version du schéma des rues Streetmix produites ici (celle du fork de l'éditeur). */
export const VERSION_SCHEMA_RUE = 35;

export interface SegmentRue {
  id: string;
  type: string;
  variantString: string;
  /** Largeur (m). */
  width: number;
  /** Hauteur au-dessus de la chaussée (m). */
  elevation: number;
  label?: string;
  slope?: { on: boolean; values: number[] };
  [cle: string]: unknown;
}

export interface BordRue {
  id?: string;
  variant: string;
  floors: number;
  elevation: number;
  [cle: string]: unknown;
}

export interface Rue {
  schemaVersion: number;
  /** Largeur de façade à façade (m). */
  width: number;
  segments: SegmentRue[];
  boundary?: { left: BordRue; right: BordRue };
  [cle: string]: unknown;
}

/** Largeurs retenues sans emprise dessinée ni tag OSM (m). */
export const LARGEURS_PAR_DEFAUT = {
  generale: 3,
  bus: 3.5,
  velo: LARGEUR_VOIE_VELO_M,
  tram: 3,
  trottoir: 1.8,
  stationnement: 2,
  stationnementEnEpi: 3,
} as const;

const HAUTEUR_TROTTOIR_M = 0.15;

/** Segment avant numérotation (Omit d'un type à signature d'index en perd les champs). */
type SegmentSansId = Pick<SegmentRue, 'type' | 'variantString' | 'width' | 'elevation'>;

/** Arrondi au pas donné, sans les résidus binaires (12,600000000000001). */
const arrondi = (valeur: number, pas = 0.05) => Number((Math.round(valeur / pas) * pas).toFixed(2));

// ── Profil estimé d'après un tronçon ──

export interface TronconPourProfil {
  voies_avant: number;
  voies_arriere: number;
  types_avant?: TypeVoieReseau[] | null;
  types_arriere?: TypeVoieReseau[] | null;
  /** Tracé du tronçon, de `noeud_de` vers `noeud_vers` (pour la largeur des emprises). */
  points: readonly LonLat[];
  emprises?: EmprisesTroncon | null;
  highway?: string | null;
  /** Tags de la voie OSM d'origine (trottoirs, stationnement). */
  tags?: Record<string, string> | null;
  /**
   * Le tronçon est-il tracé dans le sens de sa voie OSM ? Les côtés `left` / `right` des tags OSM
   * se lisent dans le sens de la voie. null : inconnu, pris comme le même sens.
   */
  sensOsm?: boolean | null;
}

type Cote = 'gauche' | 'droite';

/** Types de voie qui, sans tag `sidewalk`, ont un trottoir de chaque côté en ville. */
const RUES_AVEC_TROTTOIRS = new Set([
  'primary',
  'primary_link',
  'secondary',
  'secondary_link',
  'tertiary',
  'tertiary_link',
  'residential',
  'unclassified',
]);

/** Côté OSM (`left` / `right`, dans le sens de la voie) ramené au côté du profil. */
function coteProfil(coteOsm: 'left' | 'right', sensOsm: boolean | null | undefined): Cote {
  const gauche = coteOsm === 'left';
  return (sensOsm === false ? !gauche : gauche) ? 'gauche' : 'droite';
}

/** Valeur d'un tag pour un côté OSM : `cle:left`, sinon `cle:both`. */
function tagCote(tags: Record<string, string>, cle: string, cote: 'left' | 'right', suffixe = ''): string | undefined {
  return tags[`${cle}:${cote}${suffixe}`] ?? tags[`${cle}:both${suffixe}`];
}

function largeurTag(valeur: string | undefined): number | null {
  const nombre = valeur ? Number.parseFloat(valeur.replace(',', '.')) : Number.NaN;
  return Number.isFinite(nombre) && nombre > 0.3 && nombre < 15 ? nombre : null;
}

/** Trottoirs du profil d'après `sidewalk`, `sidewalk:left|right|both` et leurs `:width`. */
function trottoirs(t: TronconPourProfil): Record<Cote, number | null> {
  const tags = t.tags ?? {};
  const present = { left: false, right: false };
  const general = tags.sidewalk;
  if (general === 'both' || general === 'separate' || general === 'yes') present.left = present.right = true;
  else if (general === 'left' || general === 'right') present[general] = true;
  for (const cote of ['left', 'right'] as const) {
    const valeur = tagCote(tags, 'sidewalk', cote);
    if (valeur !== undefined) present[cote] = valeur !== 'no' && valeur !== 'none';
  }
  const aucunTag = general === undefined && !Object.keys(tags).some((k) => k.startsWith('sidewalk:'));
  if (aucunTag && RUES_AVEC_TROTTOIRS.has(t.highway ?? '')) present.left = present.right = true;
  const largeur = (cote: 'left' | 'right') =>
    present[cote] ? (largeurTag(tagCote(tags, 'sidewalk', cote, ':width')) ?? LARGEURS_PAR_DEFAUT.trottoir) : null;
  return { [coteProfil('left', t.sensOsm)]: largeur('left'), [coteProfil('right', t.sensOsm)]: largeur('right') } as Record<Cote, number | null>;
}

type Rangement = 'parallele' | 'epi' | 'bataille';

/** Stationnement de chaque côté d'après `parking:left|right|both` (et l'ancien `parking:lane:*`). */
function stationnements(t: TronconPourProfil): Record<Cote, Rangement | null> {
  const tags = t.tags ?? {};
  const rangement = (cote: 'left' | 'right'): Rangement | null => {
    const nouveau = tagCote(tags, 'parking', cote);
    if (nouveau !== undefined) {
      if (!['lane', 'street_side', 'on_kerb', 'half_on_kerb', 'shoulder'].includes(nouveau)) return null;
      const orientation = tagCote(tags, 'parking', cote, ':orientation');
      return orientation === 'diagonal' ? 'epi' : orientation === 'perpendicular' ? 'bataille' : 'parallele';
    }
    const ancien = tagCote(tags, 'parking:lane', cote);
    if (ancien === 'parallel' || ancien === 'marked') return 'parallele';
    if (ancien === 'diagonal') return 'epi';
    if (ancien === 'perpendicular') return 'bataille';
    return null;
  };
  return { [coteProfil('left', t.sensOsm)]: rangement('left'), [coteProfil('right', t.sensOsm)]: rangement('right') } as Record<
    Cote,
    Rangement | null
  >;
}

/** Segment Streetmix d'une voie de circulation. */
function segmentVoie(type: TypeVoieReseau, sens: 'avant' | 'arriere', largeur: number | null): SegmentSansId {
  const dir = sens === 'avant' ? 'outbound' : 'inbound';
  const [typeStreetmix, variante] =
    type === 'bus'
      ? ['bus-lane', `${dir}|colored|typical`]
      : type === 'velo'
        ? ['bike-lane', `${dir}|regular|road`]
        : type === 'tram'
          ? ['light-rail', `${dir}|regular`]
          : ['drive-lane', `${dir}|car`];
  return { type: typeStreetmix, variantString: variante, width: arrondi(largeur ?? LARGEURS_PAR_DEFAUT[type]), elevation: 0 };
}

function segmentStationnement(cote: Cote, rangement: Rangement, direction: 'inbound' | 'outbound'): SegmentSansId {
  const orientation = cote === 'gauche' ? 'left' : 'right';
  const variante =
    rangement === 'parallele' ? direction : rangement === 'bataille' ? 'sideways' : `angled-front-${orientation}`;
  return {
    type: 'parking-lane',
    variantString: `${variante}|${orientation}`,
    width: rangement === 'parallele' ? LARGEURS_PAR_DEFAUT.stationnement : LARGEURS_PAR_DEFAUT.stationnementEnEpi,
    elevation: 0,
  };
}

const segmentTrottoir = (largeur: number): SegmentSansId => ({
  type: 'sidewalk',
  variantString: 'normal',
  width: arrondi(largeur),
  elevation: HAUTEUR_TROTTOIR_M,
});

/** Numérote les segments et calcule la largeur de façade à façade. */
function assembler(segments: Array<SegmentSansId>, avecTrottoirs: boolean): Rue {
  const numerotes = segments.map((s, i) => ({ id: `voirie-${i}`, ...s, slope: { on: false, values: [] } }));
  const bord = (cote: Cote): BordRue => ({ id: `voirie-bord-${cote}`, variant: 'residential', floors: 3, elevation: avecTrottoirs ? HAUTEUR_TROTTOIR_M : 0 });
  return {
    schemaVersion: VERSION_SCHEMA_RUE,
    units: 0,
    width: arrondi(numerotes.reduce((somme, s) => somme + s.width, 0), 0.1),
    segments: numerotes,
    boundary: { left: bord('gauche'), right: bord('droite') },
  };
}

/**
 * Profil estimé d'un tronçon, vu dans son sens : ses voies (types, largeur de leur emprise
 * dessinée, sinon par défaut), et, d'après les tags OSM, ses trottoirs et son stationnement.
 */
export function tronconVersRue(t: TronconPourProfil): Rue {
  const largeur = (sens: 'avant' | 'arriere', rang: number) => {
    const polygone = t.emprises?.[cleEmprise(sens, rang)];
    const mesure = polygone ? largeurEmprise(polygone, t.points) : null;
    return mesure !== null && mesure > 0.5 && mesure < 10 ? mesure : null;
  };
  const avant = typesVoies(t.voies_avant, t.types_avant).map((type, rang) => segmentVoie(type, 'avant', largeur('avant', rang)));
  const arriere = typesVoies(t.voies_arriere, t.types_arriere)
    .map((type, rang) => segmentVoie(type, 'arriere', largeur('arriere', rang)))
    .reverse();
  const cotes = trottoirs(t);
  const parking = stationnements(t);
  const segments = [
    ...(cotes.gauche !== null ? [segmentTrottoir(cotes.gauche)] : []),
    ...(parking.gauche ? [segmentStationnement('gauche', parking.gauche, t.voies_arriere > 0 ? 'inbound' : 'outbound')] : []),
    ...arriere,
    ...avant,
    ...(parking.droite ? [segmentStationnement('droite', parking.droite, t.voies_avant > 0 ? 'outbound' : 'inbound')] : []),
    ...(cotes.droite !== null ? [segmentTrottoir(cotes.droite)] : []),
  ];
  return assembler(segments, cotes.gauche !== null || cotes.droite !== null);
}

// ── Lecture depuis l'autre bout ──

const echangerGaucheDroite = (texte: string) => texte.replace(/left/g, '\u0000').replace(/right/g, 'left').replace(/\u0000/g, 'right');
const echangerSens = (texte: string) => texte.replace(/^inbound$/, '\u0000').replace(/^outbound$/, 'inbound').replace(/^\u0000$/, 'outbound');

/**
 * Variante vue depuis l'autre bout : les sens s'échangent (`inbound` ↔ `outbound`), et les
 * orientations dessinées par rapport à l'observateur (stationnement, abri, piste bidirectionnelle)
 * passent de l'autre côté. Le tourne-à-gauche d'une voie de présélection reste à gauche : il est
 * relatif au conducteur.
 */
function varianteMiroir(type: string, variante: string): string {
  return variante
    .split('|')
    .map((partie, rang) => {
      const sens = echangerSens(partie);
      if (sens !== partie) return sens;
      if (type === 'turn-lane' && rang === 1) return partie;
      return echangerGaucheDroite(partie);
    })
    .join('|');
}

/** La même rue vue depuis l'autre bout du tronçon : segments dans l'ordre inverse, sens et côtés échangés. */
export function miroirRue<R extends Rue>(rue: R): R {
  const segments = [...rue.segments].reverse().map((s) => ({
    ...s,
    variantString: varianteMiroir(s.type, s.variantString),
    ...(s.slope && { slope: { ...s.slope, values: [...s.slope.values].reverse() } }),
  }));
  return {
    ...rue,
    segments,
    ...(rue.boundary && { boundary: { left: rue.boundary.right, right: rue.boundary.left } }),
  };
}

// ── Voies de circulation, pour SUMO ──

export interface VoieProfil {
  type: TypeVoieReseau;
  /** Largeur (m). */
  largeur: number;
}

export interface VoiesProfil {
  /** Voies du sens avant (de `noeud_de` vers `noeud_vers`), rang 0 = la plus à gauche pour qui y circule. */
  avant: VoieProfil[];
  arriere: VoieProfil[];
  /** Largeur des trottoirs de chaque côté (m, 0 : aucun), vue dans le sens du tronçon. */
  trottoirs: Record<Cote, number>;
  /** Stationnement le long de la chaussée, de chaque côté. */
  stationnement: Record<Cote, boolean>;
  alertes: string[];
}

/** Type de voie de circulation d'un segment Streetmix ; null : pas une voie de circulation. */
function typeCirculation(type: string): TypeVoieReseau | null {
  if (type === 'drive-lane' || type === 'turn-lane') return 'generale';
  if (type === 'bus-lane' || type === 'brt-lane') return 'bus';
  if (type === 'bike-lane' || type === 'scooter') return 'velo';
  if (type === 'streetcar' || type === 'light-rail' || type === 'train') return 'tram';
  return null;
}

const STATIONNEMENT = new Set(['parking-lane', 'flex-zone', 'food-truck']);
const PIETON = new Set(['sidewalk', 'sidewalk-tree', 'sidewalk-bench', 'sidewalk-lamp', 'sidewalk-wayfinding', 'sidewalk-bike-rack', 'street-vendor', 'outdoor-dining', 'bikeshare', 'utilities', 'parklet']);

/**
 * Voies de circulation d'un profil, par sens du tronçon (`inverse` : le tronçon lit le profil
 * depuis son autre bout). Une piste cyclable bidirectionnelle donne une voie vélo de
 * demi-largeur dans chaque sens. Les trottoirs comptent la zone piétonne de part et d'autre de la
 * chaussée ; le stationnement, les places le long de la chaussée.
 */
export function rueVersVoies(rue: Rue, inverse = false): VoiesProfil {
  const vue = inverse ? miroirRue(rue) : rue;
  const avant: VoieProfil[] = [];
  const arriereGaucheADroite: VoieProfil[] = [];
  const alertes: string[] = [];
  const indicesChaussee: number[] = [];
  vue.segments.forEach((s, i) => {
    const type = typeCirculation(s.type);
    if (type || STATIONNEMENT.has(s.type)) indicesChaussee.push(i);
    if (!type) return;
    const direction = s.variantString.split('|')[0] ?? '';
    if (direction.startsWith('twoway')) {
      avant.push({ type, largeur: s.width / 2 });
      arriereGaucheADroite.push({ type, largeur: s.width / 2 });
      alertes.push(`Segment ${s.type} bidirectionnel : une voie de ${(s.width / 2).toFixed(2)} m dans chaque sens`);
    } else if (direction === 'inbound') arriereGaucheADroite.push({ type, largeur: s.width });
    else if (direction === 'outbound') avant.push({ type, largeur: s.width });
    else alertes.push(`Segment ${s.type} sans sens (${s.variantString}) : ignoré`);
  });
  const debut = indicesChaussee[0] ?? vue.segments.length;
  const fin = indicesChaussee.at(-1) ?? -1;
  const pietonne = (de: number, a: number) =>
    vue.segments.slice(de, a).reduce((somme, s) => somme + (PIETON.has(s.type) ? s.width : 0), 0);
  const premiereVoie = vue.segments.findIndex((s) => typeCirculation(s.type));
  const derniereVoie = vue.segments.findLastIndex((s) => typeCirculation(s.type));
  const stationneEntre = (de: number, a: number) => vue.segments.slice(de, a).some((s) => s.type === 'parking-lane' || s.type === 'flex-zone');
  return {
    avant,
    arriere: arriereGaucheADroite.reverse(),
    trottoirs: { gauche: arrondi(pietonne(0, debut)), droite: arrondi(pietonne(fin + 1, vue.segments.length)) },
    stationnement: {
      gauche: premiereVoie > 0 && stationneEntre(0, premiereVoie),
      droite: derniereVoie >= 0 && stationneEntre(derniereVoie + 1, vue.segments.length),
    },
    alertes,
  };
}

// ── Répartition de l'emprise par mode ──

export type ModeEmprise = 'pieton' | 'velo' | 'voiture' | 'bus' | 'tram' | 'stationnement' | 'vegetal' | 'autre';

export const MODES_EMPRISE: readonly ModeEmprise[] = ['pieton', 'velo', 'voiture', 'bus', 'tram', 'stationnement', 'vegetal', 'autre'];

const SEPARATEURS_VEGETAUX = new Set(['planting-strip', 'planter-box', 'bush', 'flowers', 'big-tree', 'palm-tree']);

function modeSegment(s: SegmentRue): ModeEmprise {
  const circulation = typeCirculation(s.type);
  if (circulation === 'generale') return 'voiture';
  if (circulation) return circulation;
  if (s.type === 'divider') return SEPARATEURS_VEGETAUX.has(s.variantString) ? 'vegetal' : 'autre';
  if (s.type === 'transit-shelter') return s.variantString.includes('light-rail') ? 'tram' : 'bus';
  if (s.type === 'brt-station') return 'bus';
  if (s.type === 'parking-lane' || s.type === 'flex-zone' || s.type === 'flex-zone-curb') return 'stationnement';
  if (['sidewalk-bike-rack', 'bikeshare', 'scooter-drop-zone'].includes(s.type)) return 'velo';
  if (['sidewalk-tree', 'bioswale', 'drainage-channel', 'beach', 'marsh'].includes(s.type)) return 'vegetal';
  if (PIETON.has(s.type) || s.type === 'crosswalk') return 'pieton';
  return 'autre';
}

/** Largeur (m) que le profil consacre à chaque mode ; l'espace laissé libre entre façades n'est pas compté. */
export function repartitionParMode(rue: Rue): Record<ModeEmprise, number> {
  const repartition = Object.fromEntries(MODES_EMPRISE.map((m) => [m, 0])) as Record<ModeEmprise, number>;
  for (const s of rue.segments) repartition[modeSegment(s)] += s.width;
  for (const m of MODES_EMPRISE) repartition[m] = arrondi(repartition[m]);
  return repartition;
}

/** Somme des largeurs des segments (m). */
export const largeurRue = (rue: Rue) => arrondi(rue.segments.reduce((somme, s) => somme + s.width, 0));
