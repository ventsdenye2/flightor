import { useState } from 'react'
import { Button, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import AppExperience from '../../../../../src/features/ui-experience/AppExperience'
import type { PreviewPage } from '../../../../../src/features/ui-experience/AppExperience'
import type { Scenario } from '../../../../../src/features/ui-experience/fixtures'

const scenarios: Array<{ id: Scenario; label: string }> = [
  { id: 'ready', label: '完整行程' },
  { id: 'partial', label: '部分结果' },
  { id: 'image-error', label: '图片失败' },
  { id: 'connection', label: '复杂中转' }
]

export default function Index() {
  const [scenario, setScenario] = useState<Scenario>('ready')
  const [revision, setRevision] = useState(0)
  const [navigation, setNavigation] = useState<{ page: PreviewPage; revision: number }>({ page: 'plan', revision: 0 })
  return <View className='ui-experience-entry'>
    <View className='ui-experience-entry__controls'>
      {scenarios.map(item => <Button key={item.id} size='mini' className={scenario === item.id ? 'is-active' : ''} onClick={() => { setScenario(item.id); setNavigation(current => ({ page: 'trip', revision: current.revision + 1 })) }}>{item.label}</Button>)}
      <Button size='mini' onClick={() => setRevision(value => value + 1)}>重置</Button>
    </View>
    <AppExperience
      key={revision}
      scenario={scenario}
      requestedPage={navigation.page}
      navigationVersion={navigation.revision}
      onOpenSource={url => Taro.setClipboardData({ data: url, success: () => Taro.showToast({ title: '来源链接已复制', icon: 'success' }) })}
    />
  </View>
}
