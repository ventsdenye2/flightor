import { useEffect, useState } from 'react'
import { ScrollView, View } from '@tarojs/components'
import type { ScrollPanelProps } from './ScrollPanel'

/** Native scroll-view owns touch scrolling and message anchoring in WeChat. */
export function ScrollPanel({ children, className = 'ux-scroll', style, followKey }: ScrollPanelProps) {
  const [anchor, setAnchor] = useState(0)
  const [target, setTarget] = useState('')
  useEffect(() => {
    if (!followKey) { setTarget(''); return }
    setAnchor(value => value + 1)
  }, [followKey])
  useEffect(() => {
    if (!followKey) return
    const timer = setTimeout(() => setTarget(`scroll-end-${anchor}`), 30)
    return () => clearTimeout(timer)
  }, [anchor, followKey])
  return <ScrollView className={`${className} ux-native-scroll`} style={style} scrollY enhanced showScrollbar={false} scrollWithAnimation scrollIntoView={target}>
    {children}<View id={`scroll-end-${anchor}`} style={{ height: '1px' }} />
  </ScrollView>
}
