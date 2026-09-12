import { Fragment } from 'react'
import { View, Text, Button, Image } from '@tarojs/components'
import { Icon } from './VisualMedia'
import { formatPrice, hasKnownPrice, priceStatusLabel } from './presentation'
import type { MediaPresentation, TripFlightPresentation } from './presentation'

export function FlightTicket({ flight, expanded = false, onExpand, onOpenSource }: {
  flight: TripFlightPresentation; expanded?: boolean; onExpand?: () => void; onOpenSource?: (url: string) => void
}) {
  const departure = flight.legs[0]
  const arrival = flight.legs[flight.legs.length - 1]
  return <View className='ux-ticket'>
    <View className='ux-section-head'><Text className='ux-section-title'>{flight.title}</Text>
      {onExpand ? <Button className='ux-text-button' onClick={onExpand}>查看航班<Icon name='chevron-right' /></Button> : <Text className='ux-muted'>{flight.dateLabel || '日期待确认'}</Text>}
    </View>
    {departure && arrival ? <View className='ux-flight-times'>
      <View><Text className='ux-code'>{departure.fromCode || '机场待确认'}</Text><Text className='ux-time'>{departure.depart || '待确认'}</Text><Text className='ux-muted'>{departure.from}</Text></View>
      <View className='ux-flight-line'><Icon name='plane' /><View className='ux-airline-line' /><Text>{flight.transferLabel || '中转情况待确认'}</Text>{flight.transferDuration ? <Text>{flight.transferDuration}</Text> : null}</View>
      <View className='ux-align-right'><Text className='ux-code'>{arrival.toCode || '机场待确认'}</Text><Text className='ux-time'>{arrival.arrive || '待确认'}{arrival.nextDay ? <Text className='ux-caption'> +1 天</Text> : null}</Text><Text className='ux-muted'>{arrival.to}</Text></View>
    </View> : <View className='ux-empty'><Icon name='plane' /><Text className='ux-muted'>航段信息尚未补充</Text></View>}
    <View className='ux-airline'>{flight.airlineCode ? <View className='ux-airline-logo'>{flight.airlineCode}</View> : <Icon name='plane' />}<Text>{flight.airlineLabel || '航司待确认'}{flight.source.status === 'sample' ? ' · 示例航班' : ''}</Text></View>
    {expanded ? <View className='ux-flight-expanded'>
      <Text className='ux-section-title'>航段与中转</Text>
      {flight.legs.map((leg, index) => <Fragment key={`${flight.id}-${index}`}><View className='ux-leg'><Text>{leg.depart || '时间待确认'}　{leg.from}{leg.fromCode ? ` ${leg.fromCode}` : ''}</Text><Text className='ux-muted'>{leg.duration ? `飞行 ${leg.duration}` : '飞行时长待确认'} · {leg.carrier || '航司待确认'}</Text><Text>{leg.arrive || '时间待确认'}{leg.nextDay ? '（次日）' : ''}　{leg.to}{leg.toCode ? ` ${leg.toCode}` : ''}</Text></View>{leg.transfer ? <View className='ux-transfer'><Icon name='info' /><Text>{leg.transfer}</Text></View> : null}</Fragment>)}
      {flight.warning ? <View className='ux-warning'>{flight.warning}</View> : null}
      <View className='ux-summary'><View><Text className='ux-summary-label'>{priceStatusLabel(flight.price)}</Text><Text className='ux-price'>{formatPrice(flight.price)}{hasKnownPrice(flight.price) ? <Text className='ux-per'>{flight.price.unit === 'person' ? ' / 人' : ' / 总计'}</Text> : null}</Text></View></View>
      <Text className='ux-caption'>{flight.price.source?.label || '报价来源待补充'}</Text>
      {flight.source.url && onOpenSource ? <Button className='ux-text-button' onClick={() => onOpenSource(flight.source.url!)}>{flight.source.label}<Icon name='external' /></Button> : <Text className='ux-caption'>{flight.source.label}</Text>}
      <Text className='ux-caption'>时刻按当地时间展示；未确认信息保持待确认状态。示例不用于购票。</Text>
    </View> : null}
  </View>
}
export function FlightRoute({ route, illustration }: { route: string[]; illustration?: MediaPresentation | null }) {
  if (illustration?.src) return <Image className='ux-flight-map' src={illustration.src} mode='aspectFit' ariaLabel={illustration.description} />
  return route.length ? <View className='ux-route'>{route.map((place, index) => <Fragment key={`${place}-${index}`}>{index ? <Icon name='arrow-right' /> : null}<Text>{place}</Text></Fragment>)}</View> : <Text className='ux-muted'>出发地与目的地尚未确认</Text>
}
