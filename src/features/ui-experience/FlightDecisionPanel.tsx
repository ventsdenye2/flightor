import { useState } from 'react'
import { Button, Text, View } from '@tarojs/components'
import { FlightSearchCard } from '../../components/artifacts/FlightSearchCard'
import { displayOfferById, displayOffers, record } from '../../components/artifacts/payload'
import type { ArtifactEnvelope } from '../../services/artifactService'
import type { WorkspaceTrip } from '../../services/workspaceService'
import { connectionLabel, flightPath } from '../../services/flightConnections'
import './flight-decision.scss'

export function FlightDecisionPanel({ artifact, selection, busy = false, onOpenCandidates, onChange, onPlan }: {
  artifact?: ArtifactEnvelope
  selection?: WorkspaceTrip['selectedFlight']
  busy?: boolean
  onOpenCandidates: (artifactId: string) => void
  onChange: (artifactId: string) => void
  onPlan: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  if (!selection) {
    if (!artifact) return null
    const payload = record(artifact.payload)
    const offers = payload ? displayOffers(payload, artifact.presentation) : []
    return <View className={`flight-decision ${busy ? 'flight-decision--locked' : ''}`}>
      <View className='flight-decision__head'><Text>先选航班</Text><Text>比较后再安排行程</Text></View>
      <FlightSearchCard artifact={artifact} onAction={busy ? undefined : () => onOpenCandidates(artifact.id)} />
      {busy && offers.length > 0 && <>
        <Button className='flight-decision__details-toggle' onClick={() => setExpanded(value => !value)}>{expanded ? '收起航段详情' : '展开只读航段详情'}</Button>
        {expanded && <View className='flight-decision__readonly-details'>{offers.map((offer, index) => <View className='flight-decision__readonly-offer' key={offer.id ?? index}><Text className='flight-decision__muted'>{flightPath(offer.segments) || '航线详情待补充'} · {offer.segments.length} 个航段</Text>{offer.segments.map((segment, segmentIndex) => <Text className='flight-decision__segment' key={`${index}-${segmentIndex}`}>{segment.departure ?? '出发时间待确认'} → {segment.arrival ?? '抵达时间待确认'} · {segment.flightNumber ?? '航班号待确认'}</Text>)}</View>)}</View>}
      </>}
    </View>
  }
  if (selection.kind !== 'offer') return <View className='flight-decision flight-decision--selected'>
    <Text className='flight-decision__eyebrow'>已选航空路线</Text>
    <Text className='flight-decision__title'>路线方案已保存</Text>
    <Text className='flight-decision__muted'>后续安排会读取这条路线的全部航段。</Text>
    <View className='flight-decision__actions'><Button className='ux-secondary' disabled={busy} onClick={() => onChange(selection.artifactId)}>更换航班</Button><Button className='ux-primary' disabled={busy} onClick={onPlan}>{busy ? '正在规划…' : '根据航班安排行程'}</Button></View>
  </View>
  const payload = artifact ? record(artifact.payload) : undefined
  const offer = payload ? displayOfferById(payload, selection.offerId, artifact?.presentation) : undefined
  if (!artifact || !offer) return <View className='flight-decision flight-decision--selected'><Text className='flight-decision__title'>正在读取已选航班…</Text></View>
  return <View className='flight-decision flight-decision--selected'>
    <View className='flight-decision__head'><Text className='flight-decision__eyebrow'>已选航班</Text><Text>选择修订 {selection.revision}</Text></View>
    <Text className='flight-decision__title'>{flightPath(offer.segments) || '航线待确认'}</Text>
    <View className='flight-decision__metrics'>
      <View><Text>{offer.amount === undefined ? '价格待确认' : `${offer.currency} ${offer.amount.toLocaleString()}`}</Text><Text>供应商搜索报价</Text></View>
      <View><Text>{offer.durationMinutes === undefined ? '时长待确认' : `${Math.floor(offer.durationMinutes / 60)} 小时 ${offer.durationMinutes % 60} 分`}</Text><Text>总耗时</Text></View>
    </View>
    <Text className='flight-decision__muted'>{offer.airlines.join(' · ') || '航空公司待确认'} · {offer.segments.length} 个航段</Text>
    {offer.layovers.map(value => <Text className='flight-decision__connection' key={value.afterSegmentIndex}>{connectionLabel(value)}</Text>)}
    <Text className='flight-decision__muted'>{selection.layoverPreference === 'consider_city' ? '已记录进城偏好；只有时间和必要条件都合适时才会安排。' : '中转按留在机场安排。'}</Text>
    <Button className='flight-decision__details-toggle' onClick={() => setExpanded(value => !value)}>{expanded ? '收起航段详情' : '展开只读航段详情'}</Button>
    {expanded && <View className='flight-decision__readonly-details'>{offer.segments.map((segment, index) => <Text className='flight-decision__segment' key={index}>{segment.departure ?? '出发时间待确认'} → {segment.arrival ?? '抵达时间待确认'} · {segment.flightNumber ?? '航班号待确认'}</Text>)}</View>}
    <View className='flight-decision__actions'><Button className='ux-secondary' disabled={busy} onClick={() => onChange(artifact.id)}>更换航班</Button><Button className='ux-primary' disabled={busy} onClick={onPlan}>{busy ? '正在规划…' : '根据航班安排行程'}</Button></View>
    <Text className='flight-decision__disclaimer'>此选择只用于规划，不代表已购票或锁价。</Text>
  </View>
}
