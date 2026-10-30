import { Text } from '@tarojs/components'
import type { MarkdownLinkProps } from './MarkdownLink'

export function MarkdownLink({ href, children, onOpenSource }: MarkdownLinkProps) {
  return <Text className='pl-md-link' onClick={() => onOpenSource?.(href)}>{children}</Text>
}
