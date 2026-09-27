import { Toaster as ToasterChakra, Portal, Spinner, Stack, Toast } from '@chakra-ui/react'
import { notifications } from './notifications'

/** Affichage des notifications, à monter une fois au-dessus de l'application. */
export function Notifications() {
  return (
    <Portal>
      <ToasterChakra toaster={notifications} insetInline={{ mdDown: '4' }}>
        {(toast) => (
          <Toast.Root width={{ md: 'sm' }}>
            {toast.type === 'loading' ? <Spinner size="sm" color="fg.muted" /> : <Toast.Indicator />}
            <Stack gap="1" flex="1" maxWidth="100%">
              {toast.title && <Toast.Title>{toast.title}</Toast.Title>}
              {toast.description && <Toast.Description>{toast.description}</Toast.Description>}
            </Stack>
            {toast.action && <Toast.ActionTrigger>{toast.action.label}</Toast.ActionTrigger>}
            {toast.closable && <Toast.CloseTrigger />}
          </Toast.Root>
        )}
      </ToasterChakra>
    </Portal>
  )
}
