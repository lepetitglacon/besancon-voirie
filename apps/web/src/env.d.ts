/** Variables `VITE_*` lues dans le .env à la racine du monorepo (`envDir` de vite.config.ts). */
interface ImportMetaEnv {
  /** URL de l'instance Streetmix locale (docs/integration-streetmix.md) ; absente : pas d'éditeur de profil. */
  readonly VITE_STREETMIX_URL?: string
}
