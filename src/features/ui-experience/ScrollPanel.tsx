import { useEffect, useRef } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { View } from '@tarojs/components'

export interface ScrollPanelProps {
  children: ReactNode
  className?: string
  style?: CSSProperties
  followKey?: string
}

/** Web scrolling; Taro resolves ScrollPanel.weapp for the native client. */
export function ScrollPanel({ children, className = 'ux-scroll', style, followKey }: ScrollPanelProps) {
  const host = useRef<any>(null)
  useEffect(() => {
    if (followKey && host.current?.scrollTo) host.current.scrollTo({ top: host.current.scrollHeight, behavior: 'smooth' })
  }, [followKey])
  return <View className={className} style={style} ref={host}>{children}</View>
}
