import { useEffect, useState } from 'react'
import { View, Text, Image, Button } from '@tarojs/components'
import { iconPath } from './media'
import { t } from '../../i18n'

export function Icon({ name, className = '' }: { name: string; className?: string }) {
  return <Image className={`ux-icon ${className}`} src={iconPath(name)} aria-hidden mode='aspectFit' />
}
export function Photo({ src, description, className = '', forceError = false, retry = true, collapse=false, candidates=[] }: {
  src?: string | null; description: string; className?: string; forceError?: boolean; retry?: boolean; collapse?:boolean; candidates?:string[]
}) {
  const [failed, setFailed] = useState(forceError)
  const [attempt, setAttempt] = useState(0)
  const [candidate,setCandidate]=useState(0)
  useEffect(() => { setFailed(forceError);setCandidate(0) }, [src, forceError])
  const actual=[src,...candidates.slice(0,2)][candidate]
  if(collapse&&(!actual||failed))return null
  if (!src || failed) return <View className={`ux-photo-fallback ${className}`}>
    <Icon name='image' /><Text>{description}</Text>
    {src && retry ? <Button className='ux-text-button' onClick={() => { setFailed(false); setAttempt(n => n + 1) }}>{t('trip.reloadImage')}</Button> : null}
  </View>
  return <Image key={`${actual}-${attempt}`} src={actual!} className={`ux-photo ${className}`} mode='aspectFill' lazyLoad
    ariaLabel={description} onError={() => {if(candidate<Math.min(candidates.length,2))setCandidate(n=>n+1);else setFailed(true)}} />
}
