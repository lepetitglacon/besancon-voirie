import { defineSlotRecipe } from '@chakra-ui/react'

/** Recettes des composants propres au projet (src/ds). */

/** Barre d'outils flottante, en bas de la carte. */
export const barreOutils = defineSlotRecipe({
  className: 'barre-outils',
  slots: ['root', 'outil', 'glyphe', 'libelle', 'raccourci', 'separateur'],
  base: {
    root: {
      display: 'flex',
      alignItems: 'center',
      gap: '1',
      p: '1.5',
      bg: 'bg.panel',
      borderRadius: 'barre',
      boxShadow: 'flottant',
    },
    outil: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '2px',
      w: '66px',
      py: '1.5',
      borderRadius: '9px',
      color: 'fg.secondary',
      cursor: 'pointer',
      transition: 'background 120ms',
      _hover: { bg: 'bg.muted' },
      focusVisibleRing: 'outside',
      _pressed: { bg: 'brand.solid', color: 'brand.contrast', _hover: { bg: 'brand.solid' } },
    },
    glyphe: { fontSize: '17px', lineHeight: '20px' },
    libelle: { textStyle: '2xs' },
    raccourci: { fontFamily: 'mono', color: 'fg.subtle', ms: '1', '[aria-pressed=true] &': { color: 'inherit', opacity: 0.8 } },
    separateur: { w: '1px', h: '34px', bg: 'border.subtle', mx: '1.5' },
  },
})

/** Popup courte ancrée à un élément de la carte (feu, voie, liaison…). */
export const popupCarte = defineSlotRecipe({
  className: 'popup-carte',
  slots: ['root', 'entete', 'icone', 'titres', 'titre', 'soustitre', 'fermer', 'corps', 'pied'],
  base: {
    root: {
      display: 'flex',
      flexDirection: 'column',
      w: '300px',
      bg: 'bg.panel',
      color: 'fg',
      borderWidth: '1px',
      borderColor: 'border.subtle',
      borderRadius: 'l3',
      boxShadow: 'popup',
      textStyle: 'sm',
    },
    entete: { display: 'flex', alignItems: 'center', gap: '2.5', p: '14px 14px 10px' },
    icone: { flexShrink: 0 },
    titres: { display: 'flex', flexDirection: 'column', flex: '1', minW: 0 },
    titre: { textStyle: 'md', fontWeight: 'semibold', lineHeight: '1.3' },
    soustitre: { textStyle: 'xs', color: 'fg.muted' },
    fermer: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
      w: '7',
      h: '7',
      borderRadius: '7px',
      bg: 'bg.muted',
      color: 'fg.secondary',
      cursor: 'pointer',
      _hover: { bg: 'bg.emphasized' },
      focusVisibleRing: 'outside',
    },
    corps: { display: 'flex', flexDirection: 'column', gap: '14px', p: '4px 14px 14px' },
    pied: {
      display: 'flex',
      alignItems: 'center',
      gap: '1.5',
      px: '14px',
      py: '2.5',
      borderTopWidth: '1px',
      borderColor: 'border.muted',
      bg: 'bg.subtle',
      borderBottomRadius: 'l3',
    },
  },
  variants: {
    taille: {
      compacte: { root: { w: '260px' }, entete: { p: '10px 12px 6px' }, corps: { gap: '1', p: '0 12px 10px', textStyle: 'xs' } },
      normale: {},
    },
  },
  defaultVariants: { taille: 'normale' },
})

/** Carte d'en-tête, en haut à gauche : projet, carrefour, badges d'état. */
export const carteEnTete = defineSlotRecipe({
  className: 'carte-en-tete',
  slots: ['root', 'surtitre', 'titre', 'badges'],
  base: {
    root: { display: 'flex', flexDirection: 'column', gap: '2px', p: '12px 14px', bg: 'bg.panel', borderRadius: 'l3', boxShadow: 'carte' },
    surtitre: { textStyle: 'xs', color: 'fg.muted' },
    titre: { textStyle: 'md', fontWeight: 'semibold', lineHeight: '1.35' },
    badges: { display: 'flex', flexWrap: 'wrap', gap: '1.5', mt: '1.5' },
  },
})

/** Bandeau du mode en cours : « Nouvelle route · Clic pour poser un point · Échap ». */
export const bandeauMode = defineSlotRecipe({
  className: 'bandeau-mode',
  slots: ['root', 'titre', 'aide'],
  base: {
    root: {
      display: 'flex',
      alignItems: 'center',
      gap: '14px',
      px: '4',
      py: '9px',
      bg: 'gray.900',
      color: 'white',
      borderRadius: 'full',
      textStyle: 'sm',
      boxShadow: '0 6px 20px rgba(0, 0, 0, 0.2)',
      _dark: { bg: 'gray.700' },
    },
    titre: { fontWeight: 'semibold' },
    aide: { display: 'flex', alignItems: 'center', gap: '1.5', color: 'gray.300' },
  },
})

/** Panneau ancré en bas de l'écran : plan de feux, chronogramme. */
export const panneauBas = defineSlotRecipe({
  className: 'panneau-bas',
  slots: ['root', 'entete', 'titre', 'corps'],
  base: {
    root: {
      display: 'flex',
      flexDirection: 'column',
      bg: 'bg.panel',
      borderTopWidth: '1px',
      borderColor: 'border.subtle',
      boxShadow: { _light: '0 -10px 30px rgba(20, 24, 33, 0.12)', _dark: '0 -10px 30px rgba(0, 0, 0, 0.5)' },
    },
    entete: { display: 'flex', alignItems: 'center', gap: '14px', px: '5', py: '3', borderBottomWidth: '1px', borderColor: 'border.muted' },
    titre: { textStyle: 'lg', fontWeight: 'semibold' },
    corps: { flex: '1', minH: 0, overflow: 'auto', px: '5', py: '3' },
  },
})

/** Chiffre clé : « 4 branches », « 90 s cycle ». */
export const chiffre = defineSlotRecipe({
  className: 'chiffre',
  slots: ['root', 'valeur', 'libelle'],
  base: {
    root: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0', px: '2.5', py: '2', bg: 'bg.muted', borderRadius: 'l2', flex: '1' },
    valeur: { fontFamily: 'mono', textStyle: 'lg', fontWeight: 'medium' },
    libelle: { textStyle: '2xs', color: 'fg.muted' },
  },
})

/** Zoom et orientation de la carte. */
export const controleZoom = defineSlotRecipe({
  className: 'controle-zoom',
  slots: ['root', 'bouton', 'separateur'],
  base: {
    root: { display: 'flex', flexDirection: 'column', bg: 'bg.panel', borderRadius: '10px', boxShadow: 'carte', overflow: 'hidden' },
    bouton: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      w: '9',
      h: '9',
      fontSize: '18px',
      color: 'fg',
      cursor: 'pointer',
      _hover: { bg: 'bg.muted' },
      focusVisibleRing: 'inside',
    },
    separateur: { h: '1px', bg: 'border.muted' },
  },
})

export const recettesProjet = { barreOutils, popupCarte, carteEnTete, bandeauMode, panneauBas, chiffre, controleZoom }
