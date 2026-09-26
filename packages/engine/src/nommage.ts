/** Voies OSM retenues, de la plus importante à la moins importante (sert au nommage). */
export const HIERARCHIE_VOIES = [
  'motorway',
  'trunk',
  'primary',
  'secondary',
  'tertiary',
  'unclassified',
  'residential',
  'living_street',
  'busway',
  'pedestrian',
  'service',
  'road',
] as const;

const MOTS_VIDES = new Set(['d', 'de', 'des', 'du', 'la', 'le', 'les', 'l']);

export function slugifier(texte: string): string {
  return texte
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/, '');
}

/** Premier slug libre : `base`, puis `base-2`, `base-3`… */
export function slugLibre(base: string, pris: ReadonlySet<string>): string {
  const racine = base || 'carrefour';
  let slug = racine;
  for (let i = 2; pris.has(slug); i++) slug = `${racine}-${i}`;
  return slug;
}

/** Clé de comparaison : « Avenue du Maréchal Foch » et « Avenue Maréchal Foch » se confondent. */
function cleDeNom(nom: string): string {
  return slugifier(nom)
    .split('-')
    .filter((mot) => mot && !MOTS_VIDES.has(mot))
    .join('-');
}

/**
 * Nom proposé pour un carrefour à partir des rues proches, déjà triées par importance puis
 * distance : trois noms distincts au plus, joints par « × ».
 */
export function proposerNom(noms: readonly string[], nature: 'carrefour' | 'traversee_pietonne' = 'carrefour'): string {
  const vus = new Set<string>();
  const retenus: string[] = [];
  for (const nom of noms) {
    const cle = cleDeNom(nom);
    if (!cle || vus.has(cle)) continue;
    vus.add(cle);
    retenus.push(nom.trim());
    if (retenus.length === 3) break;
  }
  if (nature === 'traversee_pietonne') {
    return ['Traversée piétonne', retenus[0]].filter(Boolean).join(', ');
  }
  return retenus.length ? retenus.join(' × ') : 'Carrefour sans nom';
}
