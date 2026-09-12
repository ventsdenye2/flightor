import { useMemo, useState } from 'react'
import { Button, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import AppExperience from '../../../../../src/features/ui-experience/AppExperience'
import type { PreviewPage } from '../../../../../src/features/ui-experience/AppExperience'
import { experienceSamples } from '../../../../../src/features/ui-experience/experienceSamples'
import { lisbonTrip } from '../../../../../src/features/ui-experience/sampleTrips'

export default function Index() {
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
      trip={trip}
      requestedPage={navigation.page}
      navigationVersion={navigation.revision}
      onOpenSource={url => Taro.setClipboardData({ data: url, success: () => Taro.showToast({ title: '来源链接已复制', icon: 'success' }) })}
    />
  </View>
}
