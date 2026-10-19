import { useEffect, useMemo, useState } from 'react'
import { Button, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import AppExperience from '../../../../../src/features/ui-experience/AppExperience'
import type { PreviewPage } from '../../../../../src/features/ui-experience/AppExperience'
import { experienceSamples } from '../../../../../src/features/ui-experience/experienceSamples'
import { lisbonTrip } from '../../../../../src/features/ui-experience/sampleTrips'
import { createConversationClient, createGenerator, createPlaceMediaLoader, createPlaceLocationLoader, restoreTrip } from '../../../../../src/features/ui-experience/backendClient'
import type { BackendTransport } from '../../../../../src/features/ui-experience/backendClient'
import type { TripPresentation } from '../../../../../src/features/ui-experience/presentation'

const storageKey = 'flightor-dsh-last-completed-v1'
const transport: BackendTransport = async (method, path, data) => {
  const base = Taro.getStorageSync('flightor-api-base-url') || 'http://127.0.0.1:3000'
  const response = await Taro.request({ url: base + path, method, data, timeout: 20000, header: { 'content-type': 'application/json' } })
  const value = response.data as any
  if (response.statusCode >= 400) throw Error(value.error || '后端请求失败')
  return value
}
const generateTrip = createGenerator(transport, id => Taro.setStorageSync(storageKey, id))
const loadPlaceMedia = createPlaceMediaLoader(transport)
const loadPlaceLocation = createPlaceLocationLoader(transport)
const conversationKey = 'flightor-dsh-conversation-v1'
const conversationClient = createConversationClient(transport, { get: () => Taro.getStorageSync(conversationKey) || null, set: id => Taro.setStorageSync(conversationKey, id), clear: () => Taro.removeStorageSync(conversationKey) }, id => Taro.setStorageSync(storageKey, id))

export default function Index() {
  const [restored, setRestored] = useState<TripPresentation | null>(null)
  useEffect(() => { let current = true; const id = Taro.getStorageSync(storageKey); if (id) restoreTrip(transport, id).then(value => { if (current) setRestored(value) }).catch(() => {}); return () => { current = false } }, [])
  const [sampleId, setSampleId] = useState('lisbon')
  const [controlsOpen, setControlsOpen] = useState(false)
  const sample = experienceSamples.find(item => item.id === sampleId) || experienceSamples[0]
  const [daysCompleted, setDaysCompleted] = useState(false)
  const trip = useMemo(() => sampleId === 'partial' && daysCompleted ? { ...lisbonTrip, id: sample.trip.id } : sample.trip, [sampleId, sample, daysCompleted])
  const [revision, setRevision] = useState(0)
  const [navigation, setNavigation] = useState<{ page: PreviewPage; revision: number }>({ page: 'plan', revision: 0 })
  return <View className='ui-experience-entry'>
    <View className='ui-experience-entry__controls'>
      <Button size='mini' onClick={() => setControlsOpen(value => !value)}>{sample.label} · 切换样例</Button>
      <Button size='mini' onClick={() => setRevision(value => value + 1)}>重置</Button>
      {sampleId === 'partial' ? <Button size='mini' disabled={daysCompleted} onClick={() => setDaysCompleted(true)}>{daysCompleted ? '当前日程已补齐' : '补齐当前日程'}</Button> : null}
    </View>
    {controlsOpen ? <View className='ui-experience-entry__controls'>{experienceSamples.map(item => <Button key={item.id} size='mini' className={sampleId === item.id ? 'is-active' : ''} onClick={() => { setSampleId(item.id); setDaysCompleted(false); setControlsOpen(false); setRevision(value => value + 1); setNavigation(current => ({ page: 'trip', revision: current.revision + 1 })) }}>{item.label}</Button>)}</View> : null}
    <AppExperience
      key={revision}
      {...sample}
      trip={restored || trip}
      onGenerate={generateTrip}
      conversationClient={conversationClient}
      loadPlaceMedia={loadPlaceMedia}
      loadPlaceLocation={loadPlaceLocation}
      requestedPage={navigation.page}
      navigationVersion={navigation.revision}
      onOpenSource={url => Taro.setClipboardData({ data: url, success: () => Taro.showToast({ title: '来源链接已复制', icon: 'success' }) })}
    />
  </View>
}
