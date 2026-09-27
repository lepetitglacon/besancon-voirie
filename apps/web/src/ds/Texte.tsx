import { Text, type TextProps } from '@chakra-ui/react'

/** Libellé de section en petites capitales : « DURÉES », « CONFLITS (3) ». */
export function LibelleSection(props: TextProps) {
  return <Text textStyle="overline" color="fg.muted" {...props} />
}

/** Texte d'aide, en retrait. */
export function Aide(props: TextProps) {
  return <Text textStyle="xs" color="fg.muted" {...props} />
}

const TONS = { erreur: 'fg.error', avertissement: 'fg.warning', ok: 'fg.success' } as const

/** Message d'état : erreur, modification à enregistrer, succès. */
export function Message({ ton, ...props }: TextProps & { ton: keyof typeof TONS }) {
  return <Text textStyle="xs" color={TONS[ton]} {...props} />
}

/** Valeur chiffrée en police à chasse fixe : « 28 s », « 86 m ». */
export function Valeur(props: TextProps) {
  return <Text as="span" textStyle="valeur" {...props} />
}
