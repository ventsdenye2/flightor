import { Button, Text, View } from '@tarojs/components'
import type { ArtifactEnvelope } from '../../services/artifactService'
import { baggageLabel, connectionLabel, flightPath, flightTypeLabel } from '../../services/flightConnections'
import { displayOfferById, record } from '../artifacts/payload'
import './FlightDetail.scss'

export function FlightDetail({ artifact, offerId, adopting = false, layoverPreference = 'airport_only', onLayoverPreference, onAdopt }: {
  artifact: ArtifactEnvelope; offerId: string; adopting?: boolean
  layoverPreference?: 'airport_only' | 'consider_city'
  onLayoverPreference?: (value: 'airport_only' | 'consider_city') => void
  onAdopt?: () => void
}) {
  const payload = record(artifact.payload)
  const offer = payload && displayOfferById(payload, offerId, artifact.presentation)
  if (!offer) return <Text>此报价不在当前搜索结果中，请返回航班搜索重新选择。</Text>
  const connections = new Map(offer.layovers.map(connection => [connection.afterSegmentIndex, connection]))
  return <View className='route-workspace flight-detail'>
    <Text className='route-workspace__eyebrow'>航班详情</Text>
    <Text className='route-workspace__title'>{flightPath(offer.segments) || '航线待确认'}</Text>
    <Text className='route-workspace__price'>{offer.amount === undefined ? '未提供价格' : `${offer.currency || ''} ${offer.amount.toLocaleString()}`}</Text>
    <Text className='flight-detail__text'>{offer.airlines.join(' · ') || '航空公司待确认'}</Text>
    <Text className='flight-detail__text'>{flightTypeLabel(offer.transferType, offer.segments.length)}{offer.durationMinutes !== undefined ? ` · 全程 ${offer.durationMinutes} 分钟` : ' · 全程时长待确认'}</Text>
    {offer.transferType === 'airline' && <Text className='flight-detail__muted'>供应商返回的联程方案，出票及衔接保障以购票规则为准。</Text>}
    {offer.transferType === 'self' && <Text className='flight-detail__muted'>自行中转 · 请确认行李提取、重新值机及入境要求。</Text>}
    {offer.segments.map((segment, index) => <View key={`${segment.flightNumber ?? 'segment'}-${index}`}>
      <View className='route-workspace__leg'>
        <Text className='route-workspace__heading'>第 {index + 1} 段 · {segment.origin} → {segment.destination}</Text>
        <Text className='flight-detail__text'>{segment.flightNumber || '未提供航班号'}{segment.airline ? ` · ${segment.airline}` : ''}</Text>
        <Text className='flight-detail__text'>出发 {segment.departure || '待确认'}</Text>
        <Text className='flight-detail__text'>到达 {segment.arrival || '待确认'}</Text>
        {segment.durationMinutes !== undefined && <Text className='flight-detail__muted'>飞行 {segment.durationMinutes} 分钟</Text>}
      </View>
      {connections.has(index) && <View className='flight-detail__connection'><Text>{connectionLabel(connections.get(index)!)}</Text></View>}
    </View>)}
    <View className='route-workspace__section'>
      <Text className='route-workspace__heading'>费用与时效</Text>
      {offer.layovers.length > 0 && <Text className='flight-detail__text'>{baggageLabel(offer.baggageRecheck)}</Text>}
      <Text className='flight-detail__muted'>本价格来自搜索结果，可能随库存变化。未列明的行李、选座和其他附加费需另行确认。</Text>
      <Text className='flight-detail__muted'>查询时间 {artifact.createdAt}</Text>
    </View>
    {offer.layovers.length > 0 && onLayoverPreference && <View className='flight-detail__decision'>
      <Text className='route-workspace__heading'>中转时怎么安排</Text>
      <View className='flight-detail__choice' role='group' ariaLabel='中转安排偏好'>
        <Button className={layoverPreference === 'airport_only' ? 'is-active' : ''} onClick={() => onLayoverPreference('airport_only')}>留在机场</Button>
        <Button className={layoverPreference === 'consider_city' ? 'is-active' : ''} onClick={() => onLayoverPreference('consider_city')}>时间合适时考虑进城</Button>
      </View>
      <Text className='flight-detail__muted'>只有时间、入境、行李和往返机场条件都合适时，才会给出市区安排。</Text>
    </View>}
    {onAdopt && <View className='flight-detail__adopt'>
      <Button className='ux-primary' disabled={adopting} onClick={onAdopt}>{adopting ? '正在保存…' : '采用此航线，继续规划'}</Button>
      <Text className='flight-detail__muted'>用于后续行程规划，不代表已购票、锁价或获得转机保障。</Text>
    </View>}
  </View>
}
