import { Text, View } from '@tarojs/components'
import type { ArtifactEnvelope } from '../../services/artifactService'
import { displayOfferById, record } from '../artifacts/payload'

export function FlightDetail({ artifact, offerId }: { artifact: ArtifactEnvelope; offerId: string }) {
  const payload = record(artifact.payload)
  const offer = payload && displayOfferById(payload, offerId, artifact.presentation)
  if (!offer) return <Text>此报价不在当前搜索结果中，请返回航班搜索重新选择。</Text>
  return <View className='route-workspace'><Text className='route-workspace__eyebrow'>FLIGHT DETAILS</Text><Text className='route-workspace__title'>{offer.segments[0]?.origin} → {offer.segments[offer.segments.length - 1]?.destination}</Text><Text className='route-workspace__price'>{offer.amount === undefined ? '未提供价格' : `${offer.currency || ''} ${offer.amount.toLocaleString()}`}</Text><Text>{offer.airlines.join(' · ')}</Text><Text>{offer.transferType === 'self' ? '自行中转 · 请确认行李提取、重新值机及入境要求' : offer.transferType === 'airline' ? '供应商标记为联程' : '航班行程'}</Text>{offer.segments.map((segment, i) => <View className='route-workspace__leg' key={i}><Text className='route-workspace__heading'>{segment.origin} → {segment.destination}</Text><Text>{segment.flightNumber || '未提供航班号'}</Text><Text>出发 {segment.departure || '待确认'}</Text><Text>到达 {segment.arrival || '待确认'}</Text></View>)}<View className='route-workspace__section'><Text className='route-workspace__heading'>费用与时效</Text><Text>本价格来自搜索结果，可能随库存变化。未列明的行李、选座和其他附加费需另行确认。</Text><Text>查询时间 {artifact.createdAt}</Text></View></View>
}
