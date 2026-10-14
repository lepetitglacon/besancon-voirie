import { createSystem, defaultConfig, defineConfig } from '@chakra-ui/react'
import { CONFLIT, FEU, STATUT } from './couleurs'
import { recettes, recettesMulti } from './recettes'
import { recettesProjet } from './recettes-projet'

/**
 * Design system « Traffic Manager » (documents/Traffic Manager UX.html).
 * La maquette n'existe qu'en clair : les valeurs sombres en sont dérivées.
 */
const config = defineConfig({
  globalCss: {
    // body à part : sa hauteur dépend du zoom de l'interface (plus bas).
    'html, #root': { height: '100%', margin: 0 },
    html: {
      colorPalette: 'brand',
      bg: 'bg.canvas',
      // Réglages d'accessibilité (src/accessibilite), posés sur <html>.
      '--echelle-texte': '1',
      '--echelle-ui': '1',
      // Taille de la fenêtre dans l'interface zoomée : `zoom` multiplie aussi les vh et vw.
      '--ecran-h': 'calc(100vh / var(--echelle-ui))',
      '--ecran-w': 'calc(100vw / var(--echelle-ui))',
    },
    // Zoom de l'interface : tout le body, portails compris. La carte annule ce zoom (.carte-plein-ecran).
    // minHeight : Chakra le fixe à la hauteur de la fenêtre, que le zoom agrandirait (ascenseur).
    body: { textStyle: 'sm', margin: 0, zoom: 'var(--echelle-ui)', height: 'var(--ecran-h)', minHeight: 0 },
    'html[data-espacement] body': { letterSpacing: '0.05em', wordSpacing: '0.15em' },
  },
  theme: {
    tokens: {
      // --police : police choisie dans les réglages d'accessibilité.
      fonts: {
        body: { value: "var(--police, 'IBM Plex Sans'), system-ui, sans-serif" },
        heading: { value: "var(--police, 'IBM Plex Sans'), system-ui, sans-serif" },
        mono: { value: "'IBM Plex Mono', ui-monospace, monospace" },
      },
      // Interface dense : la maquette travaille en 11–15 px. Multipliées par le réglage de
      // taille du texte (src/accessibilite), comme les interlignes des textStyles plus bas.
      fontSizes: {
        '2xs': { value: 'calc(11px * var(--echelle-texte))' },
        xs: { value: 'calc(12px * var(--echelle-texte))' },
        sm: { value: 'calc(13px * var(--echelle-texte))' },
        md: { value: 'calc(14px * var(--echelle-texte))' },
        lg: { value: 'calc(15px * var(--echelle-texte))' },
        xl: { value: 'calc(17px * var(--echelle-texte))' },
        '2xl': { value: 'calc(1.5rem * var(--echelle-texte))' },
        '3xl': { value: 'calc(1.875rem * var(--echelle-texte))' },
        '4xl': { value: 'calc(2.25rem * var(--echelle-texte))' },
      },
      radii: {
        barre: { value: '14px' },
      },
      colors: {
        // Neutres de la maquette.
        gray: {
          50: { value: '#fafbfc' },
          100: { value: '#f0f1f4' },
          200: { value: '#e3e5ea' },
          300: { value: '#c9cdd5' },
          400: { value: '#9aa0aa' },
          500: { value: '#6b717d' },
          600: { value: '#4a505b' },
          700: { value: '#343842' },
          800: { value: '#25282f' },
          900: { value: '#1b1d22' },
          950: { value: '#121418' },
        },
        // Accent : oklch(0.56 0.16 255).
        brand: {
          50: { value: 'oklch(0.97 0.02 255)' },
          100: { value: 'oklch(0.94 0.04 255)' },
          200: { value: 'oklch(0.88 0.07 255)' },
          300: { value: 'oklch(0.79 0.11 255)' },
          400: { value: 'oklch(0.68 0.15 255)' },
          500: { value: 'oklch(0.56 0.16 255)' },
          600: { value: 'oklch(0.50 0.16 255)' },
          700: { value: 'oklch(0.45 0.14 255)' },
          800: { value: 'oklch(0.38 0.12 255)' },
          900: { value: 'oklch(0.30 0.09 255)' },
          950: { value: 'oklch(0.22 0.06 255)' },
        },
      },
    },
    semanticTokens: {
      colors: {
        bg: {
          DEFAULT: { value: { _light: 'white', _dark: '{colors.gray.950}' } },
          canvas: { value: { _light: '#eef0f3', _dark: '#0d0f12' } },
          panel: { value: { _light: 'white', _dark: '{colors.gray.900}' } },
          subtle: { value: { _light: '{colors.gray.50}', _dark: '#16181c' } },
          muted: { value: { _light: '{colors.gray.100}', _dark: '{colors.gray.800}' } },
          emphasized: { value: { _light: '{colors.gray.200}', _dark: '{colors.gray.700}' } },
          encre: { value: { _light: '{colors.gray.900}', _dark: '{colors.gray.100}' } },
        },
        fg: {
          DEFAULT: { value: { _light: '{colors.gray.900}', _dark: '#e8eaee' } },
          secondary: { value: { _light: '{colors.gray.600}', _dark: '{colors.gray.300}' } },
          muted: { value: { _light: '{colors.gray.500}', _dark: '{colors.gray.400}' } },
          subtle: { value: { _light: '{colors.gray.400}', _dark: '{colors.gray.500}' } },
          encre: { value: { _light: 'white', _dark: '{colors.gray.900}' } },
          error: { value: '{colors.red.fg}' },
          warning: { value: '{colors.orange.fg}' },
          success: { value: '{colors.green.fg}' },
        },
        border: {
          DEFAULT: { value: { _light: '#dfe2e7', _dark: '{colors.gray.700}' } },
          subtle: { value: { _light: '{colors.gray.200}', _dark: '{colors.gray.800}' } },
          muted: { value: { _light: '#eceef1', _dark: '{colors.gray.800}' } },
          emphasized: { value: { _light: '{colors.gray.300}', _dark: '{colors.gray.600}' } },
        },
        brand: {
          solid: { value: '{colors.brand.500}' },
          contrast: { value: 'white' },
          fg: { value: { _light: '{colors.brand.700}', _dark: '{colors.brand.300}' } },
          muted: { value: { _light: '{colors.brand.100}', _dark: '{colors.brand.900}' } },
          subtle: { value: { _light: '{colors.brand.50}', _dark: '{colors.brand.950}' } },
          emphasized: { value: { _light: '{colors.brand.200}', _dark: '{colors.brand.800}' } },
          focusRing: { value: '{colors.brand.500}' },
          border: { value: '{colors.brand.500}' },
        },
        // Tons des badges et messages, repris de la maquette.
        green: {
          subtle: { value: { _light: '#e3f6ec', _dark: 'rgba(47, 191, 106, 0.16)' } },
          fg: { value: { _light: '#1d7a47', _dark: '#6fdc9c' } },
        },
        orange: {
          subtle: { value: { _light: '#fff4e0', _dark: 'rgba(242, 165, 22, 0.16)' } },
          fg: { value: { _light: '#8a5a00', _dark: '#f2c46b' } },
        },
        red: {
          subtle: { value: { _light: '#fde8e6', _dark: 'rgba(226, 69, 60, 0.18)' } },
          fg: { value: { _light: '#c23a31', _dark: '#f5877f' } },
        },
        feu: {
          vert: { value: FEU.vert },
          orange: { value: FEU.orange },
          rouge: { value: FEU.rouge },
          // Lampes éteintes de la tête de feu.
          eteint: { value: '#3a3d44' },
        },
        statut: {
          a_confirmer: { value: STATUT.a_confirmer },
          non_releve: { value: STATUT.non_releve },
          estime: { value: STATUT.estime },
          mesure: { value: STATUT.mesure },
          verifie: { value: STATUT.verifie },
        },
        conflit: {
          croisement: { value: CONFLIT.croisement },
          insertion: { value: CONFLIT.insertion },
          convergence: { value: CONFLIT.convergence },
          pieton: { value: CONFLIT.pieton },
          admis: { value: CONFLIT.admis },
        },
      },
      radii: {
        l1: { value: '6px' },
        l2: { value: '8px' },
        l3: { value: '12px' },
      },
      shadows: {
        /** Cartes posées sur la carte (en-tête, zoom). */
        carte: { value: { _light: '0 4px 16px rgba(20, 24, 33, 0.12)', _dark: '0 4px 16px rgba(0, 0, 0, 0.5)' } },
        /** Popups ancrées et menus. */
        popup: { value: { _light: '0 12px 32px rgba(20, 24, 33, 0.16)', _dark: '0 12px 32px rgba(0, 0, 0, 0.6)' } },
        /** Barre d'outils flottante. */
        flottant: { value: { _light: '0 10px 30px rgba(20, 24, 33, 0.18)', _dark: '0 10px 30px rgba(0, 0, 0, 0.6)' } },
        /** Segment sélectionné. */
        segment: { value: { _light: '0 1px 2px rgba(0, 0, 0, 0.1)', _dark: '0 1px 2px rgba(0, 0, 0, 0.5)' } },
        lg: { value: '{shadows.popup}' },
      },
    },
    textStyles: {
      // Interlignes de Chakra, suivant la taille du texte.
      '2xs': { value: { fontSize: '2xs', lineHeight: 'calc(0.75rem * var(--echelle-texte))' } },
      xs: { value: { fontSize: 'xs', lineHeight: 'calc(1rem * var(--echelle-texte))' } },
      sm: { value: { fontSize: 'sm', lineHeight: 'calc(1.25rem * var(--echelle-texte))' } },
      md: { value: { fontSize: 'md', lineHeight: 'calc(1.5rem * var(--echelle-texte))' } },
      lg: { value: { fontSize: 'lg', lineHeight: 'calc(1.75rem * var(--echelle-texte))' } },
      xl: { value: { fontSize: 'xl', lineHeight: 'calc(1.875rem * var(--echelle-texte))' } },
      '2xl': { value: { fontSize: '2xl', lineHeight: 'calc(2rem * var(--echelle-texte))' } },
      '3xl': { value: { fontSize: '3xl', lineHeight: 'calc(2.375rem * var(--echelle-texte))' } },
      '4xl': {
        value: { fontSize: '4xl', lineHeight: 'calc(2.75rem * var(--echelle-texte))', letterSpacing: '-0.025em' },
      },
      label: { value: { fontSize: 'sm', lineHeight: 'calc(1.25rem * var(--echelle-texte))', fontWeight: 'medium' } },
      /** Libellé de section : « DURÉES », « CONFLITS (3) ». */
      overline: {
        value: {
          fontSize: '2xs',
          lineHeight: 'calc(1rem * var(--echelle-texte))',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
        },
      },
      /** Valeurs chiffrées : durées, distances, coordonnées. */
      valeur: { value: { fontFamily: 'mono', fontSize: 'sm', fontVariantNumeric: 'tabular-nums' } },
    },
    recipes: recettes,
    slotRecipes: { ...recettesMulti, ...recettesProjet },
  },
})

export const system = createSystem(defaultConfig, config)
