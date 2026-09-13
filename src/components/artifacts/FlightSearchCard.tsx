import { View, Text } from '@tarojs/components'
import type { ArtifactEnvelope } from '../../services/artifactService'
import { ArtifactCard } from './ArtifactCard'
import { displayOffers, firstText, record, text } from './payload'
import { baggageLabel, connectionLabel, flightPath, flightTypeLabel } from '../../services/flightConnections'
import './FlightSearchCard.scss'

export interface FlightSearchCardProps {
  artifact: ArtifactEnvelope
  onAction?: () => void
}

function amountLabel(amount: number | undefined, currency: string | undefined): string | undefined {
  if (amount === undefined) return undefined
  return `${currency ?? ''}${amount.toLocaleString()}`
}

export function FlightSearchCard({ artifact, onAction }: FlightSearchCardProps) {
  const payload = record(artifact.payload)
  if (!payload) return null
  const offers = displayOffers(payload, artifact.presentation)
  const query = record(payload.query) ?? record(payload.window)
  const route = query ? `${firstText(query.origin, query.originCode) ?? ''} → ${firstText(query.destination, query.destinationCode) ?? ''}` : undefined
  const routeLabel = route && route !== ' → ' ? route : undefined
  const dates = query ? firstText(query.departureDate, query.departureDateFrom) : undefined
  const provider = text(payload.provider)
  const count = Array.isArray(payload.offers)
    ? payload.offers.length
    : Array.isArray(payload.results)
      ? payload.results.reduce((total, item) => {
        const result = record(item)
        return total + (result && Array.isArray(result.offers) ? result.offers.length : 0)
      }, 0)
      : offers.length

  return (
    <ArtifactCard
      artifact={artifact}
      accent='flight'
      label='航班搜索'
      title={routeLabel ?? '航班搜索结果'}
      summary={`共 ${count} 个报价${dates ? ` · ${dates}` : ''}${provider ? ` · 数据来源 ${provider}` : ''}`}
      actionLabel={onAction ? '查看航班搜索' : undefined}
      onAction={onAction}
    >
      {offers.length > 0 ? (
        <View className='artifact-flight__offers'>
          {offers.slice(0, 3).map((offer, index) => {
            const first = offer.segments[0]
            const last = offer.segments[offer.segments.length - 1]
            const routeText = flightPath(offer.segments)
            const price = amountLabel(offer.amount, offer.currency)
            return (
              <View key={offer.id ?? `${routeText ?? 'offer'}-${index}`} className='artifact-flight__offer'>
                <View className='artifact-flight__offer-main'>
                  <Text className='artifact-flight__route'>{routeText || '航线详情待补充'}</Text>
                  <Text className='artifact-flight__meta'>
                    {offer.airlines.join(' · ') || '航空公司待确认'}
                    {` · ${flightTypeLabel(offer.transferType, offer.segments.length)}`}
                  </Text>
                  <Text className='artifact-flight__meta'>出发 {first?.departure ?? '时间未提供'}</Text>
                  <Text className='artifact-flight__meta'>抵达 {last?.arrival ?? '时间未提供'}</Text>
                  {offer.layovers.map(connection => <Text key={connection.afterSegmentIndex} className='artifact-flight__connection'>{connectionLabel(connection)}</Text>)}
                  {offer.layovers.length > 0 && <Text className='artifact-flight__meta'>{baggageLabel(offer.baggageRecheck)}</Text>}
                </View>
                <View className='artifact-flight__offer-side'>
                  {price && <Text className='artifact-flight__price'>{price}</Text>}
                  <Text className='artifact-flight__meta'>{offer.durationMinutes === undefined ? '全程时长待确认' : `${offer.durationMinutes} 分钟`}</Text>
                </View>
              </View>
            )
          })}
          {offers.length > 3 && <Text className='artifact-flight__more'>已展示前 3 个报价，共 {offers.length} 个</Text>}
        </View>
      ) : (
        <Text className='artifact-flight__empty'>当前搜索没有返回可展示的报价。</Text>
      )}
    </ArtifactCard>
  )
}
