import { IconButton, type IconButtonProps } from '@chakra-ui/react'
import { useTheme } from 'next-themes'

/** Bascule clair / sombre. Le choix est retenu ; sans choix, on suit le système. */
export function ModeCouleur(props: Omit<IconButtonProps, 'aria-label'>) {
  const { resolvedTheme, setTheme } = useTheme()
  const sombre = resolvedTheme === 'dark'
  return (
    <IconButton
      variant="ghost"
      size="xs"
      aria-label={sombre ? 'Passer en mode clair' : 'Passer en mode sombre'}
      title={sombre ? 'Mode clair' : 'Mode sombre'}
      onClick={() => setTheme(sombre ? 'light' : 'dark')}
      {...props}
    >
      {sombre ? '☀' : '☾'}
    </IconButton>
  )
}
