import { Button, Text, View } from '@tarojs/components'
import type { FlightOption } from '../../types/flight'
import { t, fd } from '../../i18n'
import type { Locale } from '../../i18n'
import { formatPrice } from '../../utils/format'
import { airportTimeDisplay } from '../../services/airportTime'
import { baggageLabel, connectionLabel, flightConnections, flightPath } from '../../services/flightConnections'
import { Icon } from './VisualMedia'
import './production-flights.scss'

/** Presentation only: every displayed segment and price comes from FlightStore. */
export function ProductionFlightCard({ flight, locale, badge, expanded, roundtrip, savings, onExpand, onSelect }: {
  flight: FlightOption; locale: Locale; badge?: string; expanded: boolean; roundtrip: boolean; savings: number
  onExpand: () => void; onSelect: (flight: FlightOption) => void
}) {
  const copy = (zh: string, en: string) => locale === 'en' ? en : zh
  const first = flight.segments[0], last = flight.segments[flight.segments.length - 1]
  const legs = flight.segments.map(segment => ({ origin: segment.origin, destination: segment.destination, departureAt: segment.departTime, arrivalAt: segment.arriveTime }))
  const connections = flightConnections(legs, flight.layovers)
  const hasPrice = Number.isFinite(flight.totalPrice) && flight.totalPrice >= 0
  const showLegs = expanded || roundtrip
  return <View className='pf-flight-card'>
    <View className='pf-card-heading'><View className='pf-carrier-mark'><Icon name='plane' /></View><Text className='pf-airline'>{flight.airline || copy('航空公司待确认', 'Airline unconfirmed')}</Text>{badge && <Text className='pf-result-badge'>{badge}</Text>}</View>
    <Text className='pf-itinerary-path'>{flightPath(legs) || copy('航线待确认', 'Route unconfirmed')}</Text>
    {first && last && !roundtrip && <View className='pf-flight-times'>
      <View><Text className='pf-time'>{first.departTimeDisplay ?? airportTimeDisplay(first.departTime)}</Text><Text className='pf-caption'>{first.origin}</Text></View>
      <View className='pf-flight-bridge'><Text>{flight.totalDuration === undefined ? copy('时长待确认', 'Duration unconfirmed') : fd(flight.totalDuration)}</Text><View className='pf-flight-line'><View /><Icon name='plane' /></View><Text>{t(`fcc.${flight.transferType}`)}</Text></View>
      <View className='pf-arrival'><Text className='pf-time'>{last.arriveTimeDisplay ?? airportTimeDisplay(last.arriveTime)}</Text><Text className='pf-caption'>{last.destination}</Text></View>
    </View>}
    <View className='pf-flight-meta'><Text>{roundtrip ? copy('往返行程', 'Round trip') : copy('单程行程', 'One way')}</Text><Text>{flight.segments.length} {copy('个航段', 'segments')}</Text>{connections.length > 0 && <Text>{baggageLabel(flight.baggageRecheck ?? flight.hub?.baggageRecheck, locale)}</Text>}</View>
    {showLegs && <View className='pf-leg-list'>
      {flight.segments.map((segment, index) => <View key={`${segment.flightNo}-${index}`} className='pf-leg'>
        <View className='pf-leg-heading'><Text>{segment.flightNo} · {segment.airline}</Text><Text>{fd(segment.duration)}</Text></View>
        <View className='pf-leg-route'><Text>{segment.departTimeDisplay ?? airportTimeDisplay(segment.departTime)} {segment.origin}</Text><Icon name='arrow-right' /><Text>{segment.arriveTimeDisplay ?? airportTimeDisplay(segment.arriveTime)} {segment.destination}</Text></View>
        {connections.find(connection => connection.afterSegmentIndex === index) && <Text className='pf-connection'>{connectionLabel(connections.find(connection => connection.afterSegmentIndex === index)!, locale)}</Text>}
      </View>)}
      {flight.hub?.visaNote && <Text className='pf-connection'>{flight.hub.visaNote}</Text>}
    </View>}
    <View className='pf-price-row'><View><Text className='pf-price'>{hasPrice ? formatPrice(flight.totalPrice) : copy('价格待确认', 'Price unconfirmed')}</Text><Text className='pf-caption'>{roundtrip ? copy('往返搜索报价', 'Round-trip search quote') : copy('搜索报价', 'Search quote')}</Text></View><Button className='pf-detail-button' onClick={() => onSelect(flight)}>{copy('查看并确认价格', 'Details & current fare')}<Icon name='chevron-right' /></Button></View>
    <View className='pf-card-footer'>{roundtrip ? <Text>{copy('已展示全部航段', 'All segments shown')}</Text> : <Button className='pf-expand-button' onClick={onExpand}>{showLegs ? copy('收起航段', 'Hide segments') : copy('展开航段', 'Show segments')}<Icon name='chevron-right' className={expanded ? 'pf-chevron pf-chevron--open' : 'pf-chevron'} /></Button>}{savings > 0 && <Text>{copy('比直飞报价低 ', 'Below the direct quote by ')}{formatPrice(savings)}</Text>}</View>
  </View>
}
