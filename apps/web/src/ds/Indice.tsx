import { Box, HStack, type StackProps } from '@chakra-ui/react'

/** Indication contextuelle en couleur d'accent : « Accroché à Avenue d'Helvétie ». */
export function Indice({ children, ...props }: StackProps) {
  return (
    <HStack gap="2" textStyle="xs" color="brand.fg" bg="brand.subtle" px="9px" py="7px" borderRadius="l2" {...props}>
      <Box as="span" w="2" h="2" flexShrink={0} borderRadius="full" borderWidth="2px" borderColor="brand.solid" />
      {children}
    </HStack>
  )
}
