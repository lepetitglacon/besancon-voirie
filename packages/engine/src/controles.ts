/**
 * Contrôles d'un carrefour par niveau de la chaîne (docs/pipeline-donnees.md, étape 4) :
 * N2 (carrefour modélisé : branches, voies, connexions), N3 (fonctionnement : lignes de feux,
 * programme), N4 (sorties : export SUMO). Chaque constat dit ce qui manque ou ce qui cloche ;
 * l'état d'un niveau est le plus grave de ses constats.
 */

export type NiveauChaine = 'N2' | 'N3' | 'N4';
export type GraviteConstat = 'erreur' | 'avertissement';
export type EtatNiveau = 'ok' | 'avertissement' | 'erreur';

export interface Constat {
  niveau: NiveauChaine;
  gravite: GraviteConstat;
  /** Identifiant stable du contrôle (`voie-sans-connexion`…), pour trier ou filtrer. */
  code: string;
  message: string;
}

export interface EntreeControles {
  nature: 'carrefour' | 'giratoire' | 'traversee_pietonne';
  /** Carrefour bâti sur le réseau (groupe de nœuds) : ses branches se déduisent, il s'exporte vers SUMO. */
  surLeReseau: boolean;
  branches: ReadonlyArray<{ code: string; troncon?: boolean; voies: ReadonlyArray<{ sens: 'entrante' | 'sortante'; rang: number }> }>;
  connexions: ReadonlyArray<{ de: string; vers: string }>;
  /** Feux physiques du carrefour. */
  feux: readonly string[];
  lignes: ReadonlyArray<{ code: string; feux: readonly string[] }>;
  /** Mouvements qu'aucune ligne véhicule ne commande (« S>N »). */
  nonCommandes: readonly string[];
  /** Références de lignes devenues invalides (mouvement ou passage disparu). */
  alertesLignes: readonly string[];
  plans: ReadonlyArray<{ code: string; mode: string; etapes: number }>;
  /** Erreurs des plans enregistrés (conflits, cycle, graphe des étapes). */
  alertesProgramme: readonly string[];
}

const cle = (code: string, sens: 'entrante' | 'sortante', rang: number) => `${code}:${sens === 'entrante' ? 'e' : 's'}${rang}`;

/** « 3 voies », « 1 voie ». */
const pluriel = (n: number, mot: string) => `${n} ${mot}${n > 1 ? 's' : ''}`;

export function controlerCarrefour(e: EntreeControles): Constat[] {
  const constats: Constat[] = [];
  const ajouter = (niveau: NiveauChaine, gravite: GraviteConstat, code: string, message: string) => constats.push({ niveau, gravite, code, message });

  // ── N2 : carrefour modélisé ──
  if (e.branches.length === 0) {
    ajouter('N2', 'erreur', 'aucune-branche', e.surLeReseau ? 'Aucune rue n’entre dans le carrefour : ajouter ses nœuds' : 'Aucune branche saisie');
  }
  const departs = new Set(e.connexions.map((c) => c.de));
  const arrivees = new Set(e.connexions.map((c) => c.vers));
  const voies = e.branches.flatMap((b) => b.voies.map((v) => ({ branche: b.code, ...v, cle: cle(b.code, v.sens, v.rang) })));
  const sansConnexion = voies.filter((v) => v.sens === 'entrante' && !departs.has(v.cle));
  if (sansConnexion.length > 0) {
    ajouter('N2', 'avertissement', 'voie-sans-connexion', `${pluriel(sansConnexion.length, 'voie entrante')} sans connexion (${sansConnexion.map((v) => v.cle).join(', ')})`);
  }
  const jamaisAtteintes = voies.filter((v) => v.sens === 'sortante' && !arrivees.has(v.cle));
  if (jamaisAtteintes.length > 0) {
    ajouter('N2', 'avertissement', 'sortie-jamais-atteinte', `${pluriel(jamaisAtteintes.length, 'voie sortante')} jamais atteinte (${jamaisAtteintes.map((v) => v.cle).join(', ')})`);
  }
  if (e.surLeReseau && e.nature !== 'giratoire') {
    const internes = e.branches.filter((b) => /^R\d+$/.test(b.code)).map((b) => b.code);
    if (internes.length > 0) {
      ajouter('N2', 'avertissement', 'branche-interne', `Branche interne ${internes.join(', ')} : une ligne d’arrêt au cœur du carrefour, ou un nœud de trop`);
    }
  }

  // ── N3 : fonctionnement ──
  if (e.lignes.length === 0) {
    ajouter('N3', 'erreur', 'aucune-ligne', 'Aucune ligne de feux');
  } else {
    const affiches = new Set(e.lignes.flatMap((l) => l.feux));
    const libres = e.feux.filter((f) => !affiches.has(f));
    if (libres.length > 0) ajouter('N3', 'avertissement', 'feu-sans-ligne', `${pluriel(libres.length, 'feu')} sur aucune ligne de feux`);
    const sansFeu = e.lignes.filter((l) => l.feux.length === 0).map((l) => l.code);
    if (sansFeu.length > 0) ajouter('N3', 'avertissement', 'ligne-sans-feu', `Ligne${sansFeu.length > 1 ? 's' : ''} sans feu physique : ${sansFeu.join(', ')}`);
  }
  if (e.nonCommandes.length > 0) {
    ajouter('N3', 'avertissement', 'mouvement-non-commande', `Mouvement${e.nonCommandes.length > 1 ? 's' : ''} sans ligne de feux : ${e.nonCommandes.join(', ')}`);
  }
  for (const alerte of e.alertesLignes) ajouter('N3', 'erreur', 'reference-invalide', alerte);
  const aCycle = e.plans.filter((p) => p.mode === 'cycle' && p.etapes > 0);
  if (e.plans.length === 0) ajouter('N3', 'erreur', 'aucun-programme', 'Aucun plan de feux');
  else if (aCycle.length === 0) ajouter('N3', 'avertissement', 'programme-sans-cycle', 'Aucun plan à cycle (seulement clignotant ou éteint)');
  for (const alerte of e.alertesProgramme) ajouter('N3', 'erreur', 'programme-en-erreur', alerte);

  // ── N4 : sorties ──
  if (!e.surLeReseau) {
    ajouter('N4', 'erreur', 'hors-reseau', 'Carrefour dessiné à la main, hors du réseau : absent de l’export SUMO');
  } else if (aCycle.length === 0) {
    ajouter('N4', 'avertissement', 'sumo-programme-par-defaut', 'Sans plan à cycle : SUMO lui invente un programme');
  }
  return constats;
}

/** État d'un niveau : le plus grave de ses constats. */
export function etatNiveau(constats: readonly Constat[], niveau: NiveauChaine): EtatNiveau {
  const du = constats.filter((c) => c.niveau === niveau);
  if (du.some((c) => c.gravite === 'erreur')) return 'erreur';
  return du.length > 0 ? 'avertissement' : 'ok';
}
