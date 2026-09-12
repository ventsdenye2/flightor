import { useEffect, useState } from 'react'
import { View, Text, Image, Button } from '@tarojs/components'
import { iconPath } from './media'

export function Icon({ name, className = '' }: { name: string; className?: string }) {
  return <Image className={`ux-icon ${className}`} src={iconPath(name)} aria-hidden mode='aspectFit' />
}
export function Photo({ src, description, className = '', forceError = false, retry = true }: {
  src?: string | null; description: string; className?: string; forceError?: boolean; retry?: boolean
}) {
  const [failed, setFailed] = useState(forceError)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => { setFailed(forceError) }, [src, forceError])
  if (!src || failed) return <View className={`ux-photo-fallback ${className}`}>
    <Icon name='image' /><Text>{description}</Text>
    {src && retry ? <Button className='ux-text-button' onClick={() => { setFailed(false); setAttempt(n => n + 1) }}>重新加载图片</Button> : null}
  </View>
  return <Image key={`${src}-${attempt}`} src={src} className={`ux-photo ${className}`} mode='aspectFill'
    ariaLabel={description} onError={() => setFailed(true)} />
}
