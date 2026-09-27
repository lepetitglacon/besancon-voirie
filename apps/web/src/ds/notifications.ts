import { createToaster } from '@chakra-ui/react'

/** File des notifications de l'application : `notifications.create({ title, type, action… })`. */
export const notifications = createToaster({ placement: 'bottom-start', pauseOnPageIdle: true, max: 5 })
