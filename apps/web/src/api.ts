import type { Bbox, CarrefoursGeoJson, ReseauTram, TramsTempsReel } from '@voirie/schema'

export interface Sante {
  status: 'ok'
  db: { postgis: string; pgrouting: string }
}

async function lireJson<T>(url: string): Promise<T> {
  const reponse = await fetch(url)
  if (!reponse.ok) throw new Error(`${url} : HTTP ${reponse.status}`)
  return (await reponse.json()) as T
}

export const api = {
  sante: () => lireJson<Sante>('/api/health'),
  carrefours: (bbox: Bbox) =>
    lireJson<CarrefoursGeoJson>(`/api/carrefours?bbox=${bbox.map((v) => v.toFixed(5)).join(',')}`),
  reseauTram: () => lireJson<ReseauTram>('/api/tram/reseau'),
  tramsTempsReel: () => lireJson<TramsTempsReel>('/api/tram/temps-reel'),
}
