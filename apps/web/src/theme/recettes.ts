import { defineRecipe, defineSlotRecipe } from '@chakra-ui/react'

/**
 * Surcharges des recettes Chakra : fusionnées avec celles par défaut, elles ne redéfinissent
 * que ce qui diffère de la maquette.
 */

const button = defineRecipe({
  base: { fontWeight: 'normal', gap: '1.5' },
  variants: {
    size: {
      '2xs': { h: '6', minW: '6', px: '1.5', textStyle: '2xs' },
      xs: { h: '7', minW: '7', px: '2', textStyle: 'xs' },
      sm: { h: '8', minW: '8', px: '3', textStyle: 'sm' },
      md: { h: '10', minW: '10', px: '4', textStyle: 'sm', fontWeight: 'medium' },
    },
    variant: {
      solid: { fontWeight: 'medium' },
      outline: {
        bg: 'bg.panel',
        borderColor: 'border',
        color: 'fg',
        _hover: { bg: 'bg.muted' },
        _expanded: { bg: 'bg.muted' },
      },
      ghost: { color: 'fg.secondary', _hover: { bg: 'bg.muted' } },
      /** Action principale d'un écran : « Enregistrer », « ▶ Simuler ». */
      encre: {
        bg: 'bg.encre',
        color: 'fg.encre',
        fontWeight: 'medium',
        _hover: { opacity: 0.88 },
      },
      /** Lien d'action dans un texte : « retirer », « + plage horaire ». */
      lien: {
        h: 'auto',
        minW: 'auto',
        px: '0',
        color: 'colorPalette.fg',
        _hover: { textDecoration: 'underline' },
      },
    },
  },
  defaultVariants: { size: 'sm', variant: 'outline' },
})

const badge = defineRecipe({
  base: { borderRadius: 'full', fontWeight: 'normal' },
  variants: {
    size: {
      xs: { textStyle: '2xs', px: '1.5', minH: '4' },
      sm: { textStyle: '2xs', px: '7px', py: '2px', minH: '5' },
      md: { textStyle: 'xs', px: '2', py: '3px', minH: '6' },
    },
    variant: { subtle: {} },
  },
  defaultVariants: { size: 'sm', variant: 'subtle' },
})

const kbd = defineRecipe({
  base: { fontFamily: 'mono', fontWeight: 'normal', borderRadius: '4px' },
  variants: {
    variant: {
      raised: { bg: 'bg.muted', color: 'fg.secondary', borderColor: 'border' },
      /** Sur fond sombre (bandeau de mode). */
      inverse: { bg: 'whiteAlpha.200', color: 'white', borderWidth: '0' },
    },
    size: { sm: {} },
  },
  defaultVariants: { size: 'sm' },
})

const input = defineRecipe({
  base: { borderRadius: 'l2' },
  variants: {
    size: {
      xs: { h: '7', px: '2', textStyle: 'xs' },
      sm: { h: '8', px: '2.5', textStyle: 'sm' },
    },
    variant: {
      outline: { bg: 'bg.panel', borderColor: 'border' },
    },
  },
  defaultVariants: { size: 'sm' },
})

/** Titres serrés : les panneaux sont étroits, un titre y tient souvent sur deux lignes. */
const heading = defineRecipe({ base: { lineHeight: '1.35' } })

export const recettes = { button, badge, kbd, input, heading }

/** Contrôle segmenté : « Double sens / Sens unique », « Heure pleine / creuse ». */
const segmentGroup = defineSlotRecipe({
  slots: ['root', 'item', 'indicator', 'itemText', 'itemControl', 'label'],
  base: {
    root: {
      '--segment-radius': 'radii.l1',
      '--segment-indicator-bg': 'colors.bg.panel',
      '--segment-indicator-shadow': 'shadows.segment',
      p: '3px',
      gap: '2px',
      borderRadius: 'l2',
      boxShadow: 'none',
    },
    item: {
      color: 'fg.secondary',
      cursor: 'pointer',
      _before: { display: 'none' },
      _checked: { color: 'fg', fontWeight: 'medium' },
    },
  },
  variants: {
    size: {
      xs: { item: { textStyle: '2xs', px: '2', height: '5' } },
      sm: { item: { textStyle: 'xs', px: '2.5', gap: '1.5', height: '6' } },
      md: { item: { textStyle: 'xs', px: '3', gap: '1.5', height: '7' } },
    },
    /** Segments de même largeur sur toute la ligne. */
    fitted: {
      true: { root: { display: 'flex', width: 'full' }, item: { flex: '1' } },
    },
  },
  defaultVariants: { size: 'sm' },
})

const tabs = defineSlotRecipe({
  slots: ['root', 'list', 'trigger', 'content', 'contentGroup', 'indicator'],
  variants: {
    variant: {
      enclosed: {
        list: { p: '3px', gap: '2px', borderRadius: 'l2', minH: 'auto' },
        trigger: {
          color: 'fg.secondary',
          _selected: { bg: 'bg.panel', color: 'fg', fontWeight: 'medium', shadow: 'segment' },
        },
      },
    },
    size: {
      sm: { root: { '--tabs-height': 'sizes.7', '--tabs-trigger-radius': 'radii.l1' }, trigger: { textStyle: 'xs', px: '2', whiteSpace: 'nowrap' } },
    },
    fitted: { true: {} },
  },
  defaultVariants: { size: 'sm', variant: 'enclosed', fitted: true },
})

const switchRecipe = defineSlotRecipe({
  slots: ['root', 'label', 'indicator', 'control', 'thumb'],
  base: {
    control: { _checked: { bg: 'brand.solid' } },
    label: { fontWeight: 'normal' },
  },
  variants: {
    size: {
      sm: { root: { '--switch-width': '34px', '--switch-height': '20px' }, label: { textStyle: 'sm' } },
    },
  },
  defaultVariants: { size: 'sm' },
})

const checkbox = defineSlotRecipe({
  slots: ['root', 'label', 'control', 'indicator', 'group'],
  base: { label: { fontWeight: 'normal' } },
  variants: {
    size: { sm: { label: { textStyle: 'xs' } } },
  },
  defaultVariants: { size: 'sm' },
})

const card = defineSlotRecipe({
  slots: ['root', 'header', 'body', 'footer', 'title', 'description'],
  base: { root: { borderRadius: 'l3' } },
  variants: {
    variant: {
      elevated: { root: { bg: 'bg.panel', boxShadow: 'carte' } },
      outline: { root: { borderColor: 'border.subtle' } },
    },
  },
})

const popover = defineSlotRecipe({
  slots: ['content', 'header', 'body', 'footer', 'title', 'description', 'arrow', 'arrowTip', 'anchor', 'trigger', 'positioner', 'indicator', 'closeTrigger'],
  base: {
    content: { borderRadius: 'l3', borderWidth: '1px', borderColor: 'border.subtle', boxShadow: 'popup' },
  },
})

/** Menus, dont le menu contextuel de la carte. */
const menu = defineSlotRecipe({
  slots: ['content', 'item', 'itemText', 'itemCommand', 'separator', 'itemGroupLabel', 'trigger', 'positioner', 'itemGroup', 'arrow', 'arrowTip', 'contextTrigger', 'itemIndicator', 'triggerItem', 'indicator'],
  base: {
    content: { borderRadius: 'l3', borderWidth: '1px', borderColor: 'border.subtle', boxShadow: 'popup', p: '6px' },
    item: { borderRadius: '7px', gap: '2.5', _highlighted: { bg: 'bg.muted' } },
    itemCommand: { fontFamily: 'mono', textStyle: '2xs', color: 'fg.subtle' },
    separator: { bg: 'border.muted', mx: '1.5', my: '1' },
    itemGroupLabel: { fontFamily: 'mono', fontWeight: 'normal', textStyle: '2xs', color: 'fg.subtle' },
  },
  variants: {
    size: { md: { item: { h: '34px', px: '2.5', textStyle: 'sm' } } },
  },
})

const tooltip = defineSlotRecipe({
  slots: ['trigger', 'arrow', 'arrowTip', 'positioner', 'content'],
  base: { content: { bg: 'bg.encre', color: 'fg.encre', borderRadius: 'l1', textStyle: 'xs' } },
})

/** Choix exclusif sous forme de cartes : régime d'une liaison. */
const radioCard = defineSlotRecipe({
  slots: ['root', 'label', 'item', 'itemText', 'itemDescription', 'itemControl', 'itemContent', 'itemAddon', 'itemIndicator', 'indicator'],
  base: {
    item: { borderRadius: 'l2', color: 'fg.secondary', cursor: 'pointer', _checked: { color: 'fg' } },
    itemText: { fontWeight: 'normal', '[data-state=checked] &': { fontWeight: 'medium' } },
  },
  variants: {
    size: { sm: { item: { textStyle: 'xs' }, itemControl: { px: '2.5', py: '2' } } },
    variant: {
      surface: {
        item: {
          borderColor: 'border',
          _checked: { borderColor: 'colorPalette.solid', boxShadow: 'inset 0 0 0 0.5px var(--chakra-colors-brand-solid)', bg: 'colorPalette.subtle', color: 'fg' },
        },
      },
    },
  },
  defaultVariants: { size: 'sm', variant: 'surface' },
})

/** Choix multiple sous forme de tuiles : mouvements autorisés d'une voie. */
const checkboxCard = defineSlotRecipe({
  slots: ['root', 'control', 'label', 'description', 'addon', 'indicator', 'content'],
  base: {
    root: { borderRadius: 'l2', cursor: 'pointer', color: 'fg.subtle', borderColor: 'border' },
    control: { flex: '1', justifyContent: 'center', alignItems: 'center' },
  },
  variants: {
    size: { sm: { root: { minH: '10' }, control: { px: '2', py: '1.5' }, label: { textStyle: 'sm' } } },
    variant: { solid: {} },
  },
  defaultVariants: { size: 'sm', variant: 'solid' },
})

const nativeSelect = defineSlotRecipe({
  slots: ['root', 'field', 'indicator'],
  base: { field: { borderRadius: 'l2' } },
  variants: {
    variant: { outline: { field: { bg: 'bg.panel', borderColor: 'border' } } },
    size: {
      xs: { field: { h: '7', textStyle: 'xs', ps: '2' } },
      sm: { field: { h: '8', textStyle: 'sm', ps: '2.5' } },
    },
  },
  defaultVariants: { size: 'sm' },
})

const table = defineSlotRecipe({
  slots: ['root', 'header', 'body', 'row', 'columnHeader', 'cell', 'footer', 'caption'],
  base: { columnHeader: { color: 'fg.muted', fontWeight: 'normal' } },
  variants: {
    size: {
      sm: { root: { textStyle: 'xs' }, columnHeader: { px: '1.5', py: '1' }, cell: { px: '1.5', py: '1' } },
    },
  },
  defaultVariants: { size: 'sm' },
})

const field = defineSlotRecipe({
  slots: ['root', 'errorText', 'helperText', 'input', 'label', 'select', 'textarea', 'requiredIndicator', 'requiredIndicator'],
  base: {
    label: { textStyle: 'overline', color: 'fg.muted', fontWeight: 'normal' },
    helperText: { textStyle: 'xs' },
  },
})

export const recettesMulti = {
  segmentGroup,
  tabs,
  switch: switchRecipe,
  checkbox,
  card,
  popover,
  menu,
  tooltip,
  radioCard,
  checkboxCard,
  nativeSelect,
  table,
  field,
}
