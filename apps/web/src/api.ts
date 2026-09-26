import type {
  Bbox,
  CarrefourResume,
  CarrefoursGeoJson,
  CreerCarrefour,
  FeuxGeoJson,
  ModifierCarrefour,
  NatureCarrefour,
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
    const corps = (await reponse.json().catch(() => null)) as { message?: unknown } | null
    const message = typeof corps?.message === 'string' ? corps.message : `HTTP ${reponse.status}`
    throw new Error(message)
  }
  return (reponse.status === 204 ? undefined : await reponse.json()) as T
}

const parametreBbox = (bbox: Bbox) => bbox.map((v) => v.toFixed(5)).join(',')

export const api = {
  sante: () => requete<Sante>('/api/health'),
  carrefours: (bbox: Bbox) => requete<CarrefoursGeoJson>(`/api/carrefours?bbox=${parametreBbox(bbox)}`),
  feux: (bbox: Bbox) => requete<FeuxGeoJson>(`/api/feux?bbox=${parametreBbox(bbox)}`),
  suggestionNom: (feux: string[], nature: NatureCarrefour) =>
    requete<{ nom: string }>(`/api/carrefours/suggestion-nom?feux=${feux.join(',')}&nature=${nature}`),
  creerCarrefour: (creation: CreerCarrefour) =>
    requete<CarrefourResume>('/api/carrefours', { method: 'POST', body: JSON.stringify(creation) }),
  modifierCarrefour: (id: string, modification: ModifierCarrefour) =>
    requete<CarrefourResume>(`/api/carrefours/${id}`, { method: 'PATCH', body: JSON.stringify(modification) }),
  supprimerCarrefour: (id: string) => requete<void>(`/api/carrefours/${id}`, { method: 'DELETE' }),
}
