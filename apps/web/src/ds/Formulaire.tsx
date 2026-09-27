import { Checkbox, NativeSelect, Switch, type CheckboxRootProps, type NativeSelectRootProps, type SwitchRootProps } from '@chakra-ui/react'
import type { ReactNode } from 'react'

interface SelecteurProps extends Omit<NativeSelectRootProps, 'onChange'> {
  valeur: string | number
  onChange: (valeur: string) => void
  'aria-label'?: string
  children: ReactNode
}

/** Liste déroulante native ; ses `<option>` sont passées en enfants. */
export function Selecteur({ valeur, onChange, children, 'aria-label': libelle, ...props }: SelecteurProps) {
  return (
    <NativeSelect.Root width="auto" {...props}>
      <NativeSelect.Field value={valeur} aria-label={libelle} onChange={(e) => onChange(e.currentTarget.value)}>
        {children}
      </NativeSelect.Field>
      <NativeSelect.Indicator />
    </NativeSelect.Root>
  )
}

interface BasculeProps extends Omit<SwitchRootProps, 'onChange' | 'checked'> {
  coche: boolean
  onChange: (coche: boolean) => void
  children?: ReactNode
}

/** Interrupteur : afficher une couche, activer un réglage. */
export function Bascule({ coche, onChange, children, ...props }: BasculeProps) {
  return (
    <Switch.Root checked={coche} onCheckedChange={(e) => onChange(e.checked)} {...props}>
      <Switch.HiddenInput />
      <Switch.Control>
        <Switch.Thumb />
      </Switch.Control>
      {children && <Switch.Label>{children}</Switch.Label>}
    </Switch.Root>
  )
}

interface CaseProps extends Omit<CheckboxRootProps, 'onChange' | 'checked'> {
  coche: boolean
  onChange: (coche: boolean) => void
  children?: ReactNode
}

/** Case à cocher : choix multiple dans une liste. */
export function Case({ coche, onChange, children, ...props }: CaseProps) {
  return (
    <Checkbox.Root checked={coche} onCheckedChange={(e) => onChange(e.checked === true)} {...props}>
      <Checkbox.HiddenInput />
      <Checkbox.Control />
      {children && <Checkbox.Label>{children}</Checkbox.Label>}
    </Checkbox.Root>
  )
}
