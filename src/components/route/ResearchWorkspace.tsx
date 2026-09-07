import { useState } from 'react'
import { View, Text } from '@tarojs/components'
import Taro from '@tarojs/taro'
import type { ArtifactEnvelope } from '../../services/artifactService'
import { displayLocation, firstText, record, records, strings } from '../artifacts/payload'

export function ResearchWorkspace({ artifact }: { artifact: ArtifactEnvelope }) {
  const [selected, setSelected] = useState(0)
  const payload = record(artifact.payload)
  if (!payload) return <Text>内容暂不可用</Text>
  const isResearch = artifact.type === 'research' && [1, 2].includes(artifact.schemaVersion) && payload.type === 'research'
  const isGuide = artifact.type === 'travel_guide' && artifact.schemaVersion === 1 && payload.kind === 'trip_travel_guide'
  const isPlan = artifact.type === 'route' && artifact.schemaVersion === 1 && payload.kind === 'trip_route_plan'
  if (artifact.type === 'destination_set' && artifact.schemaVersion === 1 && ['destination_candidates', 'destination_recommendations'].includes(String(payload.kind))) return <View className='route-workspace'><Text className='route-workspace__title'>目的地建议</Text>{records(payload.candidates, 50).map((candidate, i) => <View key={i} className='route-workspace__section'><Text className='route-workspace__heading'>{firstText(candidate.cityZh, candidate.cityEn) ?? displayLocation(candidate.location)}</Text><Text>{typeof candidate.minStayDays === 'number' ? `建议至少停留 ${candidate.minStayDays} 天` : ''}</Text>{strings(candidate.reasons, 12).map(reason => <Text key={reason}>{reason}</Text>)}<Text className='route-workspace__muted'>航班价格与行程可行性需在规划中进一步查询。</Text></View>)}{strings(payload.warnings, 30).map(warning => <Text key={warning}>{warning}</Text>)}</View>
  if (!isResearch && !isGuide && !isPlan) return <Text>此内容版本暂不支持。</Text>
  const days = isResearch ? [] : records(payload.days, 60)
  const items: Record<string, unknown>[] = isResearch ? records(payload.findings, 50) : days.flatMap(day => records(isGuide ? day.items : day.activityRefs, 32).map(item => ({ ...item, day: day.day, city: day.city })))
  const item = items[selected]
  const verification = record(item?.verification)
  const sourceUrls = item ? [...strings(item.sourceUrls, 20), ...records(item.sources, 20).flatMap(s => firstText(s.url) ? [String(s.url)] : [])].filter(url => /^https?:\/\//i.test(url)) : []
  return <View className='route-workspace'>
    <Text className='route-workspace__eyebrow'>TRAVEL NOTES</Text>
    <Text className='route-workspace__title'>{isResearch ? '目的地与活动' : '每日行程'}</Text>
    {days.map((day, index) => <View key={index} className='route-workspace__section'>
      <Text className='route-workspace__heading'>第 {String(day.day)} 天 · {displayLocation(day.city) ?? '地点待确认'}</Text>
      {records(isGuide ? day.items : day.activityRefs, 32).length === 0 && <Text className='route-workspace__muted'>自由安排 · 暂未添加活动</Text>}
      {items.map((activity, i) => activity.day === day.day ? <View key={i} className={`route-workspace__leg ${selected === i ? 'is-active' : ''}`} onClick={() => setSelected(i)}><Text>{firstText(activity.title) ?? '活动'}</Text></View> : null)}
    </View>)}
    {isResearch && items.map((activity, i) => <View key={i} className={`route-workspace__leg ${selected === i ? 'is-active' : ''}`} onClick={() => setSelected(i)}><Text>{firstText(activity.title) ?? '活动'}</Text></View>)}
    {item ? <View className='route-workspace__section'>
      <Text className='route-workspace__heading'>{firstText(item.title) ?? '活动详情'}</Text>
      <Text>{firstText(item.summary, item.description) ?? '这是你希望安排的活动，具体内容待进一步核实。'}</Text>
      {verification && <Text className='route-workspace__muted'>核验状态：{firstText(verification.status) ?? '未核验'} · {firstText(verification.checkedAt) ?? ''}</Text>}
      {strings(item.warnings, 20).map(w => <Text key={w} className='route-workspace__warning'>{w}</Text>)}
      {sourceUrls.map(url => <View key={url} className='route-workspace__action' onClick={() => Taro.setClipboardData({ data: url })}><Text>复制资料链接</Text></View>)}
    </View> : <Text className='route-workspace__muted'>尚无活动详情。</Text>}
    {isPlan && records(payload.landTransfers, 24).map((leg, i) => <View key={i} className='route-workspace__leg'>
      <Text>{displayLocation(leg.from)} → {displayLocation(leg.to)} · {firstText(leg.mode) ?? '地面交通'}</Text>
      <Text className='route-workspace__muted'>{typeof leg.durationMinutes === 'number' ? `${leg.durationMinutes} 分钟` : '时长和票价待确认'}</Text>
    </View>)}
    {strings(payload.warnings, 40).map(w => <Text key={w} className='route-workspace__warning'>{w}</Text>)}
  </View>
}
