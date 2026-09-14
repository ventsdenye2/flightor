import type { ReactNode } from 'react'
import { Button, Text, View } from '@tarojs/components'
import { Icon } from './VisualMedia'
import './shared.scss'

export function PageHeader({ title, onBack, action }: { title?: string; onBack?: () => void; action?: ReactNode }) {
  const replayTime = typeof FLIGHTOR_REPLAY_CAPTURED_AT === 'string' && FLIGHTOR_REPLAY_CAPTURED_AT
    ? FLIGHTOR_REPLAY_CAPTURED_AT.replace('T', ' ').replace(/:\d{2}\.\d{3}Z$/, ' UTC')
    : ''
  return <>
    <View className='ux-header'>
      {onBack ? <Button className='ux-icon-button' ariaLabel='返回上一页' onClick={onBack}><Icon name='chevron-left' /></Button> : !title ? <View className='ux-wordmark'><Icon name='plane' /><Text>FlightOR</Text></View> : null}
      {title ? <Text className='ux-header-title'>{title}</Text> : null}
      {action || (onBack ? <View className='ui-header-spacer' /> : null)}
    </View>
    {replayTime ? <View className='ui-replay-banner'><Text>真实查询快照 · 采集于 {replayTime}</Text></View> : null}
  </>
}

export function SectionHeading({ title, caption }: { title: string; caption?: string }) {
  return <View className='ui-section-heading'><Text className='ux-section-title'>{title}</Text>{caption ? <Text className='ux-muted'>{caption}</Text> : null}</View>
}

export function EmptyState({ title, description, actionLabel, onAction, icon = 'compass' }: { title: string; description: string; actionLabel?: string; onAction?: () => void; icon?: string }) {
  return <View className='ui-empty'><View className='ui-empty-icon'><Icon name={icon} /></View><Text className='ui-display'>{title}</Text><Text className='ux-muted'>{description}</Text>{actionLabel && onAction ? <Button className='ux-secondary' onClick={onAction}>{actionLabel}</Button> : null}</View>
}

export function DemoNote({ text = '界面示例 · 价格与安排未经实时核验' }: { text?: string }) {
  return <Text className='ui-demo-note'>{text}</Text>
}

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return <View className='ux-modal' onClick={onClose}>
    <View className='ux-sheet ui-sheet' role='dialog' aria-modal='true' ariaLabel={title} onClick={event => event.stopPropagation()}>
      <View className='ux-sheet-handle' /><Button className='ux-icon-button ux-sheet-close' ariaLabel={`关闭${title}`} onClick={onClose}><Icon name='close' /></Button>
      <Text className='ux-detail-title'>{title}</Text>{children}
    </View>
  </View>
}

export function MenuRow({ title, description, icon, value, onClick }: { title: string; description?: string; icon: string; value?: string; onClick: () => void }) {
  return <Button className='ui-menu-row' onClick={onClick}><View className='ui-menu-icon'><Icon name={icon} /></View><View className='ui-menu-copy'><Text>{title}</Text>{description ? <Text className='ux-muted'>{description}</Text> : null}</View>{value ? <Text className='ui-menu-value'>{value}</Text> : null}<Icon name='chevron-right' /></Button>
}
