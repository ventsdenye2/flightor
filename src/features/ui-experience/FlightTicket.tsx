import { tripText } from '../../i18n/trip'
import { Fragment } from 'react'
import { View, Text, Button, Image } from '@tarojs/components'
import { Icon } from './VisualMedia'
import { formatPrice, hasKnownPrice, priceStatusLabel } from './presentation'
import type { MediaPresentation, TripFlightPresentation } from './presentation'

export function FlightTicket({ flight, expanded = false, onExpand, onOpenSource, locale = 'zh' }: {
  locale?: 'zh' | 'en'; flight: TripFlightPresentation; expanded?: boolean; onExpand?: () => void; onOpenSource?: (url: string) => void
}) {
  const tt = (key: string, params?: Record<string, string | number>) => tripText(locale, key, params)
  const departure = flight.legs[0]
  const arrival = flight.legs[flight.legs.length - 1]
  return <View className='ux-ticket'>
    <View className='ux-section-head'><Text className='ux-section-title'>{flight.title}</Text>
      {onExpand ? <Button className='ux-text-button' onClick={onExpand}>{tt('trip.viewFlights')}<Icon name='chevron-right' /></Button> : <Text className='ux-muted'>{flight.dateLabel || tt('trip.dateUnknown')}</Text>}
    </View>
    {departure && arrival ? <View className='ux-flight-times'>
      <View><Text className='ux-code'>{departure.fromCode || tt('trip.airportUnknown')}</Text><Text className='ux-time'>{departure.depart || tt('trip.timeUnknown')}</Text><Text className='ux-muted'>{departure.from}</Text></View>
      <View className='ux-flight-line'><Icon name='plane' /><View className='ux-airline-line' /><Text>{flight.transferLabel || tt('trip.connectionUnknown')}</Text>{flight.transferDuration ? <Text>{flight.transferDuration}</Text> : null}</View>
      <View className='ux-align-right'><Text className='ux-code'>{arrival.toCode || tt('trip.airportUnknown')}</Text><Text className='ux-time'>{arrival.arrive || tt('trip.timeUnknown')}{arrival.nextDay ? <Text className='ux-caption'> +1 {tt('trip.nextDay')}</Text> : null}</Text><Text className='ux-muted'>{arrival.to}</Text></View>
    </View> : <View className='ux-empty'><Icon name='plane' /><Text className='ux-muted'>{tt('trip.flightMissing')}</Text></View>}
    <View className='ux-airline'>{flight.airlineCode ? <View className='ux-airline-logo'>{flight.airlineCode}</View> : <Icon name='plane' />}<Text>{flight.airlineLabel || tt('trip.carrierUnknown')}{flight.source.status === 'sample' ? ` · ${tt('trip.price.sample')}` : ''}</Text></View>
    {expanded ? <View className='ux-flight-expanded'>
      <Text className='ux-section-title'>{tt('trip.flightLegs')}</Text>
      {flight.legs.map((leg, index) => <Fragment key={`${flight.id}-${index}`}><View className='ux-leg'><Text>{leg.depart || tt('trip.timeUnknown')}　{leg.from}{leg.fromCode ? ` ${leg.fromCode}` : ''}</Text><Text className='ux-muted'>{leg.duration ? tt('trip.flightDuration', { duration: leg.duration }) : tt('trip.timeUnknown')} · {leg.carrier || tt('trip.carrierUnknown')}</Text><Text>{leg.arrive || tt('trip.timeUnknown')}{leg.nextDay ? ` (${tt('trip.nextDay')})` : ''}　{leg.to}{leg.toCode ? ` ${leg.toCode}` : ''}</Text></View>{leg.transfer ? <View className='ux-transfer'><Icon name='info' /><Text>{leg.transfer}</Text></View> : null}</Fragment>)}
      {flight.warning ? <View className='ux-warning'>{flight.warning}</View> : null}
      <View className='ux-summary'><View><Text className='ux-summary-label'>{hasKnownPrice(flight.price) ? tt(`trip.price.${flight.price.status}`) : tt('trip.priceUnknown')}</Text><Text className='ux-price'>{hasKnownPrice(flight.price) ? formatPrice(flight.price) : tt('trip.priceUnknown')}{hasKnownPrice(flight.price) ? <Text className='ux-per'>{` / ${tt(flight.price.unit === 'person' ? 'trip.person' : 'trip.total')}`}</Text> : null}</Text></View></View>
      <Text className='ux-caption'>{flight.price.source?.label || tt('trip.priceUnknown')}</Text>
      {flight.source.url && onOpenSource ? <Button className='ux-text-button' onClick={() => onOpenSource(flight.source.url!)}>{flight.source.label}<Icon name='external' /></Button> : <Text className='ux-caption'>{flight.source.label}</Text>}
      <Text className='ux-caption'>{tt('trip.localTime')}</Text>
    </View> : null}
  </View>
}
export function FlightRoute({ route, illustration }: { route: string[]; illustration?: MediaPresentation | null }) {
  if (illustration?.src) return <Image className='ux-flight-map' src={illustration.src} mode='aspectFit' ariaLabel={illustration.description} />
  return route.length ? <View className='ux-route'>{route.map((place, index) => <Fragment key={`${place}-${index}`}>{index ? <Icon name='arrow-right' /> : null}<Text>{place}</Text></Fragment>)}</View> : <Text className='ux-muted'>出发地与目的地尚未确认</Text>
}
