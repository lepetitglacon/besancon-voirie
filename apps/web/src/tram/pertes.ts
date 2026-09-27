/** Seuils de temps perdu (s) et couleurs, du tronçon fluide au tronçon qui bloque. */
export const PALIERS_PERTE: Array<{ jusqua: number; couleur: string; libelle: string }> = [
  { jusqua: 5, couleur: '#1f8a4c', libelle: '< 5 s' },
  { jusqua: 15, couleur: '#d4a017', libelle: '5–15 s' },
  { jusqua: 30, couleur: '#e0701e', libelle: '15–30 s' },
  { jusqua: Infinity, couleur: '#c0392b', libelle: '≥ 30 s' },
]
