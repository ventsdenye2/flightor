import { useState } from 'react'
import { Button, Text, View } from '@tarojs/components'
import { Sheet } from './SharedUI'
import { Icon } from './VisualMedia'
import { arrivalDayOffset, flightDate, flightDuration, flightPrice, flightReasons, flightStops, flightTime, sortFlightOptions, transferCaution } from './flightOptions'
import type { FlightOption, FlightOptions, FlightOptionSort, FlightSelection } from './flightOptions'
import './flight-choices.scss'

export function FlightChoices({ result, selected, disabled = false, locked = false, sample = false, onSelect }: { result: FlightOptions; selected: FlightSelection | null; disabled?: boolean; locked?: boolean; sample?: boolean; onSelect: (option: FlightOption | null) => void; onOpenSource?: (url: string) => void }) {
  const [sort, setSort] = useState<FlightOptionSort>('recommended')
  const [detail, setDetail] = useState<FlightOption | null>(null)
  const [all, setAll] = useState(false)
  const options = sortFlightOptions(result.options, sort)
  const recommended = sortFlightOptions(result.options, 'recommended')[0]
  const selectedId = selected?.searchId === result.searchId ? selected.candidateId : null
  const picked = (option: FlightOption) => { if (!locked && !disabled) onSelect(option); setDetail(null) }
  return <View className='fc-options'>
    <View className='fc-heading'><View><Text className='fc-eyebrow'>{sample ? '航班选项 · 设计样例' : '本次查询 · 单程'}</Text><Text className='fc-title'>先选一班，旅程慢慢聊</Text></View><Icon name='plane' /></View>
    <View className='fc-route'><Text>{result.originName || result.origin}</Text><Icon name='arrow-right' /><Text>{result.destinationName || result.destination}</Text></View>
    <Text className='fc-query'>{result.date} · {result.adults}位成人 · {result.cabin === 'economy' ? '经济舱' : result.cabin} · {result.options.length}个选项</Text>
    <View className='fc-sorts' ariaLabel='航班排序'>{([{ id: 'recommended', label: '推荐顺序' }, { id: 'price', label: '价格优先' }, { id: 'duration', label: '用时最短' }] as const).map(item => <Button key={item.id} className={sort === item.id ? 'is-active' : ''} aria-pressed={sort === item.id} onClick={() => setSort(item.id)}>{item.label}</Button>)}</View>
    {!options.length ? <View className='fc-empty'><Icon name='plane' /><Text>本次查询还没有可选航班</Text><Text className='fc-small'>可以继续聊聊，或请我换日期再查一次。</Text></View> : null}
    <View className='fc-list'>{(all ? options : options.slice(0, 3)).map(option => { const chosen = selectedId === option.id; const offset = arrivalDayOffset(option); return <View className={`fc-ticket ${chosen ? 'is-selected' : ''}`} key={option.id}>
      <View className='fc-card-head'><Text className='fc-airlines'>{option.airlines.join(' / ') || '航司待确认'}</Text>{recommended.id === option.id ? <Text className='fc-badge'>优先看看</Text> : null}</View>
      <View className='fc-schedule'><View className='fc-endpoint'><Text className='fc-time'>{flightTime(option.departureLocal)}</Text><Text className='fc-airport'>{option.departureAirport || '机场待确认'}</Text></View><View className='fc-bridge'><Text>{flightDuration(option.durationMinutes)}</Text><View className='fc-flight-line'><Icon name='plane' /></View><Text>{flightStops(option.stopCount)}</Text></View><View className='fc-endpoint fc-endpoint-arrival'><View className='fc-arrival-clock'><Text className='fc-time'>{flightTime(option.arrivalLocal)}</Text>{offset ? <Text className='fc-offset'>{offset > 0 ? '+' : ''}{offset}天</Text> : null}</View><Text className='fc-airport'>{option.arrivalAirport || '机场待确认'}</Text></View></View>
      <Text className='fc-local-note'>当地时刻 · 抵达 {flightDate(option.arrivalLocal)}</Text>
      <View className='fc-reasons'><Text className='fc-reason-label'>推荐理由</Text>{flightReasons(option, result.options).map(reason => <Text key={reason} className='fc-reason'>{reason}</Text>)}</View>
      <View className='fc-card-foot'><View><Text className='fc-price'>{flightPrice(option)}<Text> / 人</Text></Text><Text className='fc-small'>{option.currency} · {sample ? '设计样例' : '查询快照'}</Text></View><Button className={`fc-select ${chosen ? 'is-selected' : ''}`} aria-pressed={chosen} ariaLabel={`${chosen ? locked ? '已选定' : '取消选择' : '选择'}航班 ${option.airlines.join(' / ')} ${flightTime(option.departureLocal)}`} disabled={disabled || locked} onClick={() => { if (!disabled && !locked) onSelect(chosen ? null : option) }}><View className='fc-radio'>{chosen ? <Icon name='check' /> : null}</View>{chosen ? '已选这班' : '选择这班'}</Button></View>
      <Button className='fc-detail' ariaLabel={`查看航班详情 ${option.airlines.join(' / ')} ${flightTime(option.departureLocal)}`} onClick={() => setDetail(option)}>航段、行李与中转<Icon name='chevron-right' /></Button>
    </View> })}</View>
    {options.length > 3 ? <Button className='fc-more' onClick={() => setAll(!all)}>{all ? '收起其他航班' : `查看其余 ${options.length - 3} 个航班`}<Icon name='chevron-right' /></Button> : null}
    {detail ? <Sheet title='航班详情' onClose={() => setDetail(null)}>
      <View className='fc-detail-heading'><Text className='fc-title'>{detail.departureAirport || result.origin} → {detail.arrivalAirport || result.destination}</Text><Text>{result.date} · {flightDuration(detail.durationMinutes)} · {flightStops(detail.stopCount)}</Text><Text className='fc-price'>{flightPrice(detail)}<Text> / 成人 · {detail.currency}</Text></Text></View>
      <Text className='fc-reason-label'>航段 · 均为当地日期和时刻</Text>
      {detail.segments.length ? detail.segments.map((segment, index) => <View key={`${detail.id}-${index}`}><View className='fc-leg'><Text className='fc-leg-carrier'>{segment.airline || '航司待确认'} · {segment.flightNumber || '航班号待确认'}</Text><Text>{segment.origin} {flightDate(segment.departureLocal)} {flightTime(segment.departureLocal)}</Text><Icon name='arrow-right' /><Text>{segment.destination} {flightDate(segment.arrivalLocal)} {flightTime(segment.arrivalLocal)}</Text><Text className='fc-small'>飞行 {flightDuration(segment.durationMinutes)}</Text></View>{detail.connections[index] ? <View className='fc-connection'><Text>{detail.connections[index].city} · 停留{flightDuration(detail.connections[index].durationMinutes)}</Text><Text className='fc-small'>{detail.connections[index].selfTransfer === true ? '自行中转' : detail.connections[index].selfTransfer === false ? '非自行中转' : '中转方式待确认'}{detail.connections[index].airportChange ? ' · 更换机场' : ''}{detail.connections[index].collectAndRecheckBaggage ? ' · 重新托运行李' : ''}</Text></View> : null}</View>) : <Text className='fc-missing'>本次仅取得航班摘要，详细航段尚未取得；仍可选择并继续沟通。</Text>}
      <View className='fc-baggage'><Text>随身行李：{detail.baggage?.carryOn || '待确认'}</Text><Text>托运行李：{detail.baggage?.checked || '待确认'}</Text><Text>退改签：待出票页面确认</Text></View>
      {transferCaution(detail) ? <View className='fc-caution'>{transferCaution(detail)}。请预留衔接时间，并确认所需入境或过境手续。</View> : null}
      {locked ? null : <><Button className='ux-primary fc-detail-select' disabled={disabled} onClick={() => picked(detail)}>{selectedId === detail.id ? '保留这班航班' : '选择这班航班'}</Button><Text className='fc-disclosure'>选择只记录偏好，不会开始规划或预订。</Text></>}
    </Sheet> : null}
  </View>
}
