import { View, Text } from '@tarojs/components'
import type { ArtifactEnvelope } from '../../services/artifactService'
import { ArtifactCard } from './ArtifactCard'
import { displayOffers, displayRoute, firstText, numberValue, record, text } from './payload'
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
  const offers = displayOffers(payload)
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
      label='FLIGHT SEARCH'
      title={routeLabel ?? 'Flight search results'}
      summary={`${count} offer${count === 1 ? '' : 's'}${dates ? ` · ${dates}` : ''}${provider ? ` · ${provider}` : ''}`}
      actionLabel={onAction ? 'Open flight explorer' : undefined}
      onAction={onAction}
    >
      {offers.length > 0 ? (
        <View className='artifact-flight__offers'>
          {offers.slice(0, 3).map((offer, index) => {
            const first = offer.segments[0]
            const last = offer.segments[offer.segments.length - 1]
            const routeText = first && last ? `${first.origin ?? '—'} → ${last.destination ?? '—'}` : undefined
            const price = amountLabel(offer.amount, offer.currency)
            return (
              <View key={offer.id ?? `${routeText ?? 'offer'}-${index}`} className='artifact-flight__offer'>
                <View className='artifact-flight__offer-main'>
                  <Text className='artifact-flight__route'>{routeText ?? 'Route details unavailable'}</Text>
                  <Text className='artifact-flight__meta'>
                    {offer.airlines.join(' · ') || 'Airline not provided'}
                    {offer.transferType ? ` · ${offer.transferType}` : ''}
                  </Text>
                </View>
                <View className='artifact-flight__offer-side'>
                  {price && <Text className='artifact-flight__price'>{price}</Text>}
                  {offer.durationMinutes !== undefined && <Text className='artifact-flight__meta'>{offer.durationMinutes} min</Text>}
                </View>
              </View>
            )
          })}
          {offers.length > 3 && <Text className='artifact-flight__more'>Showing 3 of {offers.length} returned offers</Text>}
        </View>
      ) : (
        <Text className='artifact-flight__empty'>No offer details were returned.</Text>
      )}
    </ArtifactCard>
  )
}
