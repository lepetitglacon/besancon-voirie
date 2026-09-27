/**
 * Ce que l'IA renvoie après avoir lu l'orthophoto : la proposition OSM corrigée, en pixels de
 * l'image. Le serveur la reconvertit en lon/lat (cadre connu exactement) puis la valide avec le
 * même schéma que l'éditeur (`ConfigurationBranches`). Logique pure, testée à part.
 */
import { cleVoie, type LonLat } from '@voirie/engine';
import {
  ConfianceIa,
  ConfigurationBranches,
  TypeVoie,
  type Branche,
  type Connexion,
  type DetectionBranches,
  type TypeFeu,
  type Voie,
} from '@voirie/schema';
import { z } from 'zod';
import { versLonLat, versPixel, type CadrePhoto, type Pixel } from './photo.js';

const PointPx = z.object({ x: z.number(), y: z.number() });

const VoieLue = z.object({
  type: TypeVoie,
  /** Bout côté carrefour : ligne d'arrêt pour une voie entrante, sortie du carrefour pour une sortante. */
  debut: PointPx,
  /** Bout éloigné, 20 à 25 m plus loin le long de la voie. */
  fin: PointPx,
});

const BrancheLue = z.object({
  code: z.string(),
  nom: z.string().nullable(),
  osm_way_id: z.number().nullable(),
  /** Degrés, sens horaire depuis le nord, du centre du carrefour vers la branche. */
  azimut: z.number(),
  /** Rang 0 = la plus à gauche du conducteur qui arrive au carrefour. */
  entrantes: z.array(VoieLue),
  /** Rang 0 = la plus à gauche du conducteur qui quitte le carrefour. */
  sortantes: z.array(VoieLue),
  traversee: z.object({ debut: PointPx, fin: PointPx }).nullable(),
  confiance: ConfianceIa,
  remarques: z.string(),
});

export const LectureIa = z.object({
  branches: z.array(BrancheLue),
  connexions: z.array(z.object({ de: z.string(), vers: z.string() })),
  remarques: z.string(),
});
export type LectureIa = z.infer<typeof LectureIa>;

/**
 * Schéma JSON imposé à la sortie de Claude (`--json-schema`). Sans la clé `$schema` : le CLI ne
 * connaît pas le méta-schéma 2020-12 que zod y inscrit.
 */
export function schemaJsonLecture(): string {
  const { $schema: _metaSchema, ...schema } = z.toJSONSchema(LectureIa);
  return JSON.stringify(schema);
}

export interface FeuContexte {
  numero: number;
  type: TypeFeu;
  position: LonLat;
  tags: Record<string, string>;
}

export interface VoieOsmContexte {
  osm_id: number;
  tags: Record<string, string>;
  coordonnees: LonLat[];
}

export interface ContexteIa {
  cadre: CadrePhoto;
  /** Proposition OSM de départ, que l'IA corrige. */
  detection: DetectionBranches;
  feux: FeuContexte[];
  voiesOsm: VoieOsmContexte[];
}

/** Tags OSM utiles à la lecture des voies, les autres sont écartés du contexte. */
const TAGS_UTILES = /^(name|highway|railway|oneway|junction|lanes.*|turn:lanes.*|busway.*|bus:lanes.*|psv.*|cycleway.*|maxspeed|traffic_signals.*|crossing.*|button_operated)$/;

const px = (cadre: CadrePhoto, p: LonLat): Pixel => {
  const { x, y } = versPixel(cadre, p);
  return { x: Math.round(x), y: Math.round(y) };
};

const tagsUtiles = (tags: Record<string, string>) =>
  Object.fromEntries(Object.entries(tags).filter(([cle]) => TAGS_UTILES.test(cle)));

/** La proposition OSM exprimée comme la réponse attendue, pour que l'IA n'ait qu'à la corriger. */
export function propositionEnPixels(cadre: CadrePhoto, detection: DetectionBranches): LectureIa {
  return {
    branches: detection.branches.map((b) => {
      const voies = (sens: Voie['sens']) =>
        b.voies
          .filter((v) => v.sens === sens)
          .sort((a, c) => a.rang - c.rang)
          .map((v) => ({ type: v.type, debut: px(cadre, v.geom[0]), fin: px(cadre, v.geom[1]) }));
      return {
        code: b.code,
        nom: b.nom,
        osm_way_id: b.osm_way_id,
        azimut: Math.round(b.azimut),
        entrantes: voies('entrante'),
        sortantes: voies('sortante'),
        traversee: b.traversee ? { debut: px(cadre, b.traversee[0]), fin: px(cadre, b.traversee[1]) } : null,
        confiance: 'basse',
        remarques: `source OSM : ${detection.sources[b.code] === 'osm' ? 'flèches turn:lanes' : 'règles par défaut'}`,
      };
    }),
    connexions: detection.connexions,
    remarques: '',
  };
}

/** Consigne envoyée à Claude, avec les données OSM exprimées en pixels de la photo. */
export function consigne(contexte: ContexteIa, fichier: string): string {
  const { cadre } = contexte;
  const feux = contexte.feux.map((f) => ({ numero: `F${f.numero}`, type: f.type, ...px(cadre, f.position), tags: tagsUtiles(f.tags) }));
  const voiesOsm = contexte.voiesOsm.map((v) => ({
    osm_id: v.osm_id,
    tags: tagsUtiles(v.tags),
    trace_px: v.coordonnees.map((c) => px(cadre, c)),
  }));
  const { anneau } = contexte.detection;
  const centre = px(cadre, anneau?.centre ?? contexte.detection.centre);
  const giratoire = anneau
    ? `
## Giratoire
Ce carrefour est un giratoire. Anneau d'après OSM : centre de l'îlot ${JSON.stringify(centre)}, rayon extérieur ${Math.round(anneau.rayon_m / cadre.metres_par_px)} px (${anneau.rayon_m} m), ${anneau.voies} voie(s). On y tourne dans le sens inverse des aiguilles d'une montre.
- L'anneau n'est pas une branche : ne crée des branches que pour les rues qui s'y raccordent, et pour le tram ou un site propre bus qui traverse l'îlot.
- Les voies entrantes s'arrêtent à la ligne de cédez-le-passage (ou au feu), au bord de l'anneau ; les sortantes partent du bord de l'anneau.
- Connexions : chaque voie entrante mène à toutes les sorties, demi-tour compris, sauf marquage contraire. Tram et bus en site propre : seulement vers leur propre voie de l'autre côté de l'îlot.
- Dis dans les remarques si l'anneau d'OSM ne correspond pas à la photo (centre, rayon, nombre de voies), et si des feux se trouvent sur l'anneau lui-même.
`
    : '';
  return `Configure les voies du carrefour à feux photographié.

## Image (outil Read)
${fichier} : orthophoto IGN, ${cadre.largeur_px}×${cadre.hauteur_px} px, nord en haut, ${cadre.metres_par_px.toFixed(3)} m/pixel (${Math.round(cadre.largeur_m)}×${Math.round(cadre.hauteur_m)} m). Origine des pixels en haut à gauche, x vers la droite, y vers le bas. Le cadre couvre le carrefour et les rues qui y mènent ; des données OSM peuvent tomber hors de l'image (coordonnées négatives ou au-delà de sa taille).

Lis le marquage au sol avec attention : lignes d'arrêt, lignes de voie, flèches, passages piétons, îlots, marquages bus ou vélo.

## Données OpenStreetMap (coordonnées en pixels de l'image)
Centre du carrefour${anneau ? ' (centre de l’îlot)' : ''} : ${JSON.stringify(centre)}.
Feux OSM, numérotés F1, F2… (OSM les place en général au milieu de la chaussée, au niveau de la ligne d'arrêt) :
${JSON.stringify(feux)}
Voies OSM autour du carrefour (trace dans le sens de dessin de la voie OSM ; oneway=yes : circulation dans ce sens) :
${JSON.stringify(voiesOsm)}
${giratoire}
## Proposition OSM à corriger
Elle vient des tags OSM et de règles par défaut : voies parallèles à l'axe, 3,25 m de large, ligne d'arrêt à ${anneau ? 'deux mètres du bord de l’anneau' : '15 m du centre'}. Elle est souvent fausse sur le nombre de voies, leur position et les flèches.
${JSON.stringify(propositionEnPixels(cadre, contexte.detection))}

## Ce que tu dois renvoyer
La proposition corrigée d'après la photo, au même format :
- Une branche par rue qui arrive au carrefour ou en part. Garde les codes OSM (N, NE, SO, O…) quand la rue est la même ; code en majuscules, 4 caractères au plus. Une rue à chaussées séparées reste une seule branche.
- Circulation à droite. Voies entrantes : rang 0 = la plus à gauche du conducteur qui arrive. Voies sortantes : rang 0 = la plus à gauche du conducteur qui repart. L'ordre du tableau donne le rang.
- Chaque voie est un segment [debut, fin] tracé au milieu de la voie : debut = bout côté carrefour (ligne d'arrêt pour une entrante, sortie du carrefour après le passage piéton pour une sortante), fin = 20 à 25 m plus loin, le long de la voie. Place-les sur le marquage réel, au pixel près si possible.
- type : generale, bus, velo (piste ou bande cyclable séparée par une ligne) ou tram.
- traversee : le passage piéton qui coupe la branche, d'un trottoir à l'autre (null s'il n'y en a pas).
- azimut : du centre du carrefour vers la branche, en degrés depuis le nord, sens horaire (0 = haut de l'image, 90 = droite).
- connexions : { de: "BRANCHE:e<rang>", vers: "BRANCHE:s<rang>" } pour chaque mouvement autorisé, d'après les flèches au sol, sinon d'après les tags turn:lanes, sinon d'après ce qui est plausible (pas de tourne-à-gauche depuis une voie de droite).
- confiance par branche : haute si le marquage est bien visible, basse s'il est caché (arbres, ombres, véhicules) ou déduit.
- remarques : courtes, en français. Dis ce que tu as vu, ce que tu as supposé et ce que tu n'as pas pu voir. N'invente pas un marquage caché.`;
}

export const SYSTEME = `Tu es un ingénieur trafic qui relève la configuration de carrefours à feux sur des photos aériennes, pour un inventaire citoyen des feux de Besançon. Tu lis le marquage au sol avec précision et tu signales honnêtement ce que tu ne vois pas. Tu réponds uniquement par l'objet JSON demandé.`;

export interface ResultatLecture {
  configuration: ConfigurationBranches;
  /** Par code de branche : confiance et remarques de l'IA. */
  branches: Record<string, { confiance: ConfianceIa; remarques: string }>;
  /** Connexions de l'IA écartées (voie inconnue, sens inversé, doublon). */
  ecartees: string[];
}

const normaliserAzimut = (a: number) => Math.round((((a % 360) + 360) % 360) * 10) / 10;

/** Reconvertit la lecture de l'IA en configuration validée par le schéma de l'éditeur. */
export function configurationDepuisLecture(lecture: LectureIa, cadre: CadrePhoto, detection: DetectionBranches): ResultatLecture {
  const axesOsm = new Map(detection.branches.map((b) => [b.code, b.geom]));
  const ll = (p: Pixel) => versLonLat(cadre, p);

  const branches: Branche[] = lecture.branches.map((b) => {
    const code = b.code.trim().toUpperCase();
    const voies = (liste: typeof b.entrantes, sens: Voie['sens']): Voie[] =>
      liste.map((v, rang) => ({ sens, rang, type: v.type, geom: [ll(v.debut), ll(v.fin)] }));
    const toutes = [...voies(b.entrantes, 'entrante'), ...voies(b.sortantes, 'sortante')];
    // Axe : celui d'OSM si la branche est la même, sinon du centre vers le milieu des bouts éloignés.
    const loin: LonLat | null = toutes.length
      ? [
          toutes.reduce((s, v) => s + v.geom[1][0], 0) / toutes.length,
          toutes.reduce((s, v) => s + v.geom[1][1], 0) / toutes.length,
        ]
      : null;
    return {
      code,
      nom: b.nom?.trim() || null,
      azimut: normaliserAzimut(b.azimut),
      osm_way_id: b.osm_way_id !== null && Number.isInteger(b.osm_way_id) ? b.osm_way_id : null,
      geom: axesOsm.get(code) ?? (loin ? [detection.centre, loin] : null),
      voies: toutes,
      traversee: b.traversee ? [ll(b.traversee.debut), ll(b.traversee.fin)] : null,
      priorite_entree: null,
    };
  });

  const entrantes = new Set(branches.flatMap((b) => b.voies.filter((v) => v.sens === 'entrante').map((v) => cleVoie(b.code, v.sens, v.rang))));
  const sortantes = new Set(branches.flatMap((b) => b.voies.filter((v) => v.sens === 'sortante').map((v) => cleVoie(b.code, v.sens, v.rang))));
  const vues = new Set<string>();
  const ecartees: string[] = [];
  const connexions: Connexion[] = [];
  for (const c of lecture.connexions) {
    const de = c.de.trim().toUpperCase().replace(':E', ':e');
    const vers = c.vers.trim().toUpperCase().replace(':S', ':s');
    const cle = `${de}>${vers}`;
    if (!entrantes.has(de) || !sortantes.has(vers) || vues.has(cle)) {
      ecartees.push(`${c.de} → ${c.vers}`);
      continue;
    }
    vues.add(cle);
    connexions.push({ de, vers });
  }

  const resultat = ConfigurationBranches.safeParse({ branches, connexions, anneau: detection.anneau });
  if (!resultat.success) {
    const erreurs = resultat.error.issues.map((i) => `${i.path.join('.')} : ${i.message}`);
    throw new Error(`Proposition de l'IA invalide : ${erreurs.join(' ; ')}`);
  }
  return {
    configuration: resultat.data,
    branches: Object.fromEntries(
      lecture.branches.map((b) => [b.code.trim().toUpperCase(), { confiance: b.confiance, remarques: b.remarques }]),
    ),
    ecartees,
  };
}
