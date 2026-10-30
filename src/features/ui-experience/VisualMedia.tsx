import { useEffect, useState } from 'react'
import { View, Text, Image, Button } from '@tarojs/components'
import { iconPath } from './media'

export function Icon({ name, className = '' }: { name: string; className?: string }) {
  return <Image className={`ux-icon ${className}`} src={iconPath(name)} aria-hidden mode='aspectFit' />
}
export function Photo({ src, description, className = '', forceError = false, retry = true, collapse = false, candidates = [] }: {
  src?: string | null; description: string; className?: string; forceError?: boolean; retry?: boolean; collapse?: boolean; candidates?: string[]
}) {
  const [failed, setFailed] = useState(forceError)
  const [attempt, setAttempt] = useState(0)
  const [candidate, setCandidate] = useState(0)
  const images = [src, ...candidates].filter((value): value is string => !!value).slice(0, 3)
  const actual = images[candidate]
  const signature = images.join('\n')
  useEffect(() => { setFailed(forceError); setCandidate(0) }, [signature, forceError])
  if (collapse && (!actual || failed)) return null
  if (!actual || failed) return <View className={`ux-photo-fallback ${className}`}>
    <Icon name='image' /><Text>{description}</Text>
    {images.length && retry ? <Button className='ux-text-button' onClick={() => { setFailed(false); setCandidate(0); setAttempt(n => n + 1) }}>重新加载图片</Button> : null}
  </View>
  return <Image key={`${actual}-${attempt}`} src={actual} className={`ux-photo ${className}`} mode='aspectFill'
    ariaLabel={description} onError={() => { if (candidate + 1 < images.length) setCandidate(value => value + 1); else setFailed(true) }} />
}
