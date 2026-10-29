import type { ReactNode } from 'react'

export interface MarkdownLinkProps {
  href: string
  children: ReactNode
  onOpenSource?: (url: string) => void
}

export function MarkdownLink({ href, children }: MarkdownLinkProps) {
  return <a className='pl-md-link' href={href} target='_blank' rel='noopener noreferrer'>{children}</a>
}
