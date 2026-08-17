// src/components/hub/HubExperienceCard.tsx — Hub 停留体验卡
import { useMemo, useState } from 'react'
import { View, Text, Image } from '@tarojs/components'
import { observer } from 'mobx-react-lite'
import type { HubExperience, Interest } from '../../types/flight'
import { t, fd } from '../../i18n'
import './HubExperienceCard.scss'

interface HubExperienceCardProps {
  hub: HubExperience
  layoverDuration: number // 分钟
  interests: Interest[]
}

// 兴趣 → 活动 icon 映射（用于优先排序推荐）
const INTEREST_ICON: Record<Interest, string> = {
  food: '🍜',
  culture: '🏛',
  nature: '🌿',
  shopping: '🛍',
  nightlife: '🌙'
}

function HubExperienceCard({ hub, layoverDuration, interests }: HubExperienceCardProps) {
  // 默认选中最接近实际停留时长的方案
  const defaultIdx = useMemo(() => {
    const hours = layoverDuration / 60
    let best = 0
    let bestDiff = Infinity
    hub.layoverOptions.forEach((opt, i) => {
      const diff = Math.abs(parseInt(opt.duration, 10) - hours)
      if (diff < bestDiff) {
        bestDiff = diff
        best = i
      }
    })
    return best
  }, [hub, layoverDuration])

  const [activeIdx, setActiveIdx] = useState(defaultIdx)
  const option = hub.layoverOptions[Math.min(activeIdx, hub.layoverOptions.length - 1)]

  // 按用户兴趣排序：命中兴趣的活动排前
  const sortedActivities = useMemo(() => {
    const preferred = interests.map(i => INTEREST_ICON[i])
    return [...option.activities].sort((a, b) => {
      const ai = preferred.includes(a.icon) ? 0 : 1
      const bi = preferred.includes(b.icon) ? 0 : 1
      return ai - bi
    })
  }, [option, interests])

  return (
    <View className='hec'>
      <View className='hec__cover'>
        <Image className='hec__cover-img' src={hub.coverImage} mode='aspectFill' lazyLoad />
        <View className='hec__cover-info'>
          <Text className='hec__city'>{hub.city} <Text className='font-code hec__city-iata'>{hub.iata}</Text></Text>
          <Text className='hec__layover'>{t('hec.stay', { dur: fd(layoverDuration) })}</Text>
        </View>
      </View>

      {/* 签证 & 交通 */}
      <View className='hec__meta'>
        <View className='hec__meta-row'>
          <Text className='hec__meta-icon'>🛂</Text>
          <Text className='hec__meta-text'>{hub.transitVisa}</Text>
        </View>
        <View className='hec__meta-row'>
          <Text className='hec__meta-icon'>🚇</Text>
          <Text className='hec__meta-text'>{hub.transportFromAirport}</Text>
        </View>
      </View>

      {/* 停留时长 Tab */}
      <View className='hec__tabs'>
        {hub.layoverOptions.map((opt, i) => (
          <View
            key={opt.duration}
            className={`hec__tab ${i === activeIdx ? 'is-active' : ''}`}
            hoverClass='tap-dim'
            onClick={() => setActiveIdx(i)}
          >
            <Text>{t('hec.plan', { h: parseInt(opt.duration, 10) })}</Text>
          </View>
        ))}
      </View>

      {/* 活动列表 */}
      <View className='hec__activities'>
        {sortedActivities.map(act => (
          <View key={act.title} className='hec__activity'>
            <Text className='hec__activity-icon'>{act.icon}</Text>
            <View className='hec__activity-body'>
              <View className='hec__activity-head'>
                <Text className='hec__activity-title'>{act.title}</Text>
                <Text className='hec__activity-source'>{t(`src.${act.source}`)}</Text>
              </View>
              <Text className='hec__activity-desc'>{act.description}</Text>
            </View>
          </View>
        ))}
      </View>

      <View className='hec__budget'>
        <Text>{t('hec.budget', { cur: option.budget.currency, min: option.budget.min, max: option.budget.max })}</Text>
      </View>
    </View>
  )
}

export default observer(HubExperienceCard)
