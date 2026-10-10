import type { LonLat } from '@voirie/engine'
import type {
  AjoutTops,
  AnalyseIa,
  AnalyseIaDetail,
  EssaiIa,
  EssaiIaDetail,
  Bbox,
  BilanSemis,
  BranchesCarrefour,
  CadrePhotoIa,
  CarrefourResume,
  CarrefoursGeoJson,
  ConfigurationBranches,
  ConfigurationLignes,
  ConfigurationProgramme,
  CreerCarrefour,
  DetectionBranches,
  EmpriseIa,
  EssaiSumo,
  EssaiSumoResume,
  EtatHistoriqueTram,
  LancementSumo,
  LancerEssaiSumo,
  FeuxGeoJson,
  FeuxTempsReel,
  HistoriqueTroncons,
  LignesCarrefour,
  ModificationNoeud,
  ModificationTroncon,
  ModifierCarrefour,
  NatureCarrefour,
  NouveauTroncon,
  OptionsSumo,
  ProgrammeCarrefour,
  ReseauGeoJson,
  ReseauTram,
  SaisieLiaisons,
  TopsCarrefour,
  TramsTempsReel,
  TronconsSumoGeoJson,
  TypeJour,
} from '@voirie/schema'

export interface Sante {
  status: 'ok'
  db: { postgis: string; pgrouting: string }
}

async function requete<T>(url: string, init?: RequestInit): Promise<T> {
  const reponse = await fetch(url, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  })
  if (!reponse.ok) {
    const corps = (await reponse.json().catch(() => null)) as { message?: unknown; erreurs?: unknown } | null
    const detail = Array.isArray(corps?.erreurs) ? ` : ${corps.erreurs.join(' ; ')}` : ''
    const message = typeof corps?.message === 'string' ? `${corps.message}${detail}` : `HTTP ${reponse.status}`
    throw new Error(message)
  }
  return (reponse.status === 204 ? undefined : await reponse.json()) as T
}

const parametreBbox = (bbox: Bbox) => bbox.map((v) => v.toFixed(5)).join(',')

export const api = {
  sante: () => requete<Sante>('/api/health'),
  carrefours: (bbox: Bbox) => requete<CarrefoursGeoJson>(`/api/carrefours?bbox=${parametreBbox(bbox)}`),
  feux: (bbox: Bbox) => requete<FeuxGeoJson>(`/api/feux?bbox=${parametreBbox(bbox)}`),
  /** Place un feu sur son mât, ou le remet à sa position OSM (`null`). */
  placerFeu: (id: string, position: LonLat | null) =>
    requete<FeuxGeoJson['features'][number]>(`/api/feux/${id}/position`, {
      method: 'PUT',
      body: JSON.stringify({ position }),
    }),
  suggestionNom: (feux: string[], nature: NatureCarrefour) =>
    requete<{ nom: string }>(`/api/carrefours/suggestion-nom?feux=${feux.join(',')}&nature=${nature}`),
  creerCarrefour: (creation: CreerCarrefour) =>
    requete<CarrefourResume>('/api/carrefours', { method: 'POST', body: JSON.stringify(creation) }),
  modifierCarrefour: (id: string, modification: ModifierCarrefour) =>
    requete<CarrefourResume>(`/api/carrefours/${id}`, { method: 'PATCH', body: JSON.stringify(modification) }),
  supprimerCarrefour: (id: string) => requete<void>(`/api/carrefours/${id}`, { method: 'DELETE' }),
  branches: (carrefourId: string) => requete<BranchesCarrefour>(`/api/carrefours/${carrefourId}/branches`),
  detecterBranches: (carrefourId: string) =>
    requete<DetectionBranches>(`/api/carrefours/${carrefourId}/branches/detection`),
  /**
   * Met le carrefour dans la file des propositions OSM + IA (~1 min par analyse).
   * `emprise` : zone de la photo dessinée sur la carte, sinon calculée d'après les feux.
   */
  demanderAnalyseIa: (carrefourId: string, emprise?: EmpriseIa) =>
    requete<AnalyseIa>(`/api/carrefours/${carrefourId}/branches/detection-ia`, { method: 'POST', body: JSON.stringify({ emprise }) }),
  /** Cadre automatique de la photo envoyée à l'IA, montré avant qu'on dessine la zone. */
  cadreIa: (carrefourId: string) => requete<CadrePhotoIa>(`/api/carrefours/${carrefourId}/branches/detection-ia/cadre`),
  analysesIa: () => requete<AnalyseIa[]>('/api/analyses-ia'),
  analyseIa: (id: string) => requete<AnalyseIaDetail>(`/api/analyses-ia/${id}`),
  consulterAnalyseIa: (id: string) => requete<AnalyseIa>(`/api/analyses-ia/${id}/consultee`, { method: 'PUT' }),
  /** Essais IA d'un carrefour (un par modèle et par analyse), du plus récent au plus ancien. */
  essaisIa: (carrefourId: string) => requete<EssaiIa[]>(`/api/analyses-ia/essais?carrefour=${carrefourId}`),
  essaiIa: (id: string) => requete<EssaiIaDetail>(`/api/analyses-ia/essais/${id}`),
  retirerAnalyseIa: (id: string) => requete<void>(`/api/analyses-ia/${id}`, { method: 'DELETE' }),
  enregistrerBranches: (carrefourId: string, configuration: ConfigurationBranches) =>
    requete<BranchesCarrefour>(`/api/carrefours/${carrefourId}/branches`, {
      method: 'PUT',
      body: JSON.stringify(configuration),
    }),
  /** Carrefour bâti sur le réseau : oublie ses liaisons saisies, reprend celles proposées. */
  proposerConnexions: (carrefourId: string) =>
    requete<BranchesCarrefour>(`/api/carrefours/${carrefourId}/branches/connexions`, { method: 'DELETE' }),
  lignes: (carrefourId: string) => requete<LignesCarrefour>(`/api/carrefours/${carrefourId}/lignes`),
  enregistrerLignes: (carrefourId: string, configuration: ConfigurationLignes) =>
    requete<LignesCarrefour>(`/api/carrefours/${carrefourId}/lignes`, {
      method: 'PUT',
      body: JSON.stringify(configuration),
    }),
  programme: (carrefourId: string) => requete<ProgrammeCarrefour>(`/api/carrefours/${carrefourId}/programme`),
  enregistrerProgramme: (carrefourId: string, configuration: ConfigurationProgramme) =>
    requete<ProgrammeCarrefour>(`/api/carrefours/${carrefourId}/programme`, {
      method: 'PUT',
      body: JSON.stringify(configuration),
    }),
  /** Carrefours programmés de l'emprise : de quoi rejouer leurs feux à l'heure réelle. */
  feuxTempsReel: (bbox: Bbox) => requete<FeuxTempsReel>(`/api/temps-reel/feux?bbox=${parametreBbox(bbox)}`),
  tops: (carrefourId: string) => requete<TopsCarrefour>(`/api/carrefours/${carrefourId}/tops`),
  /** Débuts de vert relevés sur place, pour caler le cycle sur l'heure réelle. */
  ajouterTops: (carrefourId: string, ajout: AjoutTops) =>
    requete<TopsCarrefour>(`/api/carrefours/${carrefourId}/tops`, { method: 'POST', body: JSON.stringify(ajout) }),
  supprimerTop: (carrefourId: string, id: string) =>
    requete<TopsCarrefour>(`/api/carrefours/${carrefourId}/tops/${id}`, { method: 'DELETE' }),
  reseauTram: () => requete<ReseauTram>('/api/tram/reseau'),
  tramsTempsReel: () => requete<TramsTempsReel>('/api/tram/temps-reel'),
  historiqueTroncons: (typeJour: TypeJour, heure: number | null) =>
    requete<HistoriqueTroncons>(
      `/api/tram/historique/troncons?typeJour=${typeJour}${heure === null ? '' : `&heure=${heure}`}`,
    ),
  historiqueEtat: () => requete<EtatHistoriqueTram>('/api/tram/historique/etat'),

  // ── Réseau routier (docs/RESEAU.md) ──
  reseau: (bbox: Bbox) => requete<ReseauGeoJson>(`/api/reseau?bbox=${parametreBbox(bbox)}`),
  semerReseau: (reinitialiser: boolean) =>
    requete<BilanSemis>('/api/reseau/semer', { method: 'POST', body: JSON.stringify({ reinitialiser }) }),
  creerTroncon: (nouveau: NouveauTroncon) =>
    requete<Troncon>('/api/reseau/troncons', { method: 'POST', body: JSON.stringify(nouveau) }),
  modifierTroncon: (id: string, modification: ModificationTroncon) =>
    requete<Troncon>(`/api/reseau/troncons/${id}`, { method: 'PATCH', body: JSON.stringify(modification) }),
  supprimerTroncon: (id: string) => requete<void>(`/api/reseau/troncons/${id}`, { method: 'DELETE' }),
  couperTroncon: (id: string, position: [number, number]) =>
    requete<Noeud>(`/api/reseau/troncons/${id}/couper`, { method: 'POST', body: JSON.stringify({ position }) }),
  modifierNoeud: (id: string, modification: ModificationNoeud) =>
    requete<Noeud>(`/api/reseau/noeuds/${id}`, { method: 'PATCH', body: JSON.stringify(modification) }),
  fusionnerNoeud: (id: string) => requete<void>(`/api/reseau/noeuds/${id}`, { method: 'DELETE' }),
  enregistrerLiaisons: (noeudId: string, saisie: SaisieLiaisons) =>
    requete<SaisieLiaisons>(`/api/reseau/noeuds/${noeudId}/liaisons`, { method: 'PUT', body: JSON.stringify(saisie) }),
  /** Lien de téléchargement d'un fichier de l'export SUMO (de l'emprise, ou de toute la ville). */
  urlSumo: (fichier: string, bbox?: Bbox) => `/api/reseau/sumo/${fichier}${bbox ? `?bbox=${parametreBbox(bbox)}` : ''}`,
  /** Essais SUMO de la ville, du plus récent au plus ancien. */
  essaisSumo: () => requete<EssaiSumoResume[]>('/api/sumo/essais'),
  essaiSumo: (id: string) => requete<EssaiSumo>(`/api/sumo/essais/${encodeURIComponent(id)}`),
  tronconsSumo: (id: string) => requete<TronconsSumoGeoJson>(`/api/sumo/essais/${encodeURIComponent(id)}/troncons`),
  /** Mesures par tranche et par tronçon : uint16 [tranche][grandeur][tronçon]. */
  seriesSumo: async (id: string) => {
    const reponse = await fetch(`/api/sumo/essais/${encodeURIComponent(id)}/series`)
    if (!reponse.ok) throw new Error(`HTTP ${reponse.status}`)
    return new Uint16Array(await reponse.arrayBuffer())
  },
  /** Itinéraire et heures de sortie de chaque voiture (format dans data/sumo/ville/essai.py). */
  vehiculesSumo: async (id: string) => {
    const reponse = await fetch(`/api/sumo/essais/${encodeURIComponent(id)}/vehicules`)
    if (!reponse.ok) throw new Error(`HTTP ${reponse.status}`)
    return reponse.arrayBuffer()
  },
  /** Toutes les options de SUMO, par catégorie. */
  optionsSumo: () => requete<OptionsSumo>('/api/sumo/options'),
  lancementsSumo: () => requete<LancementSumo[]>('/api/sumo/lancements'),
  lancerEssaiSumo: (demande: LancerEssaiSumo) =>
    requete<LancementSumo>('/api/sumo/lancements', { method: 'POST', body: JSON.stringify(demande) }),
  annulerLancementSumo: (id: string) =>
    requete<LancementSumo>(`/api/sumo/lancements/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  /** URL du flux SSE d'avancement d'un lancement. */
  fluxLancementSumo: (id: string) => `/api/sumo/lancements/${encodeURIComponent(id)}/flux`,
}

export type Troncon = ReseauGeoJson['troncons']['features'][number]
export type Noeud = ReseauGeoJson['noeuds']['features'][number]
