import type { LonLat } from '@voirie/engine'
import type {
  AnalyseIa,
  AnalyseIaDetail,
  Bbox,
  BranchesCarrefour,
  CarrefourResume,
  CarrefoursGeoJson,
  ConfigurationBranches,
  ConfigurationLignes,
  ConfigurationProgramme,
  CreerCarrefour,
  DetectionBranches,
  EtatHistoriqueTram,
  FeuxGeoJson,
  HistoriqueTroncons,
  LignesCarrefour,
  ModifierCarrefour,
  NatureCarrefour,
  ProgrammeCarrefour,
  ReseauTram,
  TramsTempsReel,
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
  /** Met le carrefour dans la file des propositions OSM + IA (~1 min par analyse). */
  demanderAnalyseIa: (carrefourId: string) =>
    requete<AnalyseIa>(`/api/carrefours/${carrefourId}/branches/detection-ia`, { method: 'POST' }),
  analysesIa: () => requete<AnalyseIa[]>('/api/analyses-ia'),
  analyseIa: (id: string) => requete<AnalyseIaDetail>(`/api/analyses-ia/${id}`),
  consulterAnalyseIa: (id: string) => requete<AnalyseIa>(`/api/analyses-ia/${id}/consultee`, { method: 'PUT' }),
  retirerAnalyseIa: (id: string) => requete<void>(`/api/analyses-ia/${id}`, { method: 'DELETE' }),
  enregistrerBranches: (carrefourId: string, configuration: ConfigurationBranches) =>
    requete<BranchesCarrefour>(`/api/carrefours/${carrefourId}/branches`, {
      method: 'PUT',
      body: JSON.stringify(configuration),
    }),
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
  reseauTram: () => requete<ReseauTram>('/api/tram/reseau'),
  tramsTempsReel: () => requete<TramsTempsReel>('/api/tram/temps-reel'),
  historiqueTroncons: (typeJour: TypeJour, heure: number | null) =>
    requete<HistoriqueTroncons>(
      `/api/tram/historique/troncons?typeJour=${typeJour}${heure === null ? '' : `&heure=${heure}`}`,
    ),
  historiqueEtat: () => requete<EtatHistoriqueTram>('/api/tram/historique/etat'),
}
