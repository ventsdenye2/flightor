import { useEffect, useState } from 'react'
import { Button, Input, Text, View } from '@tarojs/components'
import type { ConversationClient, FlightLocation } from './backendClient'
import { Sheet } from './SharedUI'
import { Icon } from './VisualMedia'
import { flightMonthDays, localFlightToday, selectFlightDate, shiftFlightMonth } from './flightSearchDates'
import './flight-search-pickers.scss'

export function FlightLocationPicker({ title, initial, client, onSelect, onClose }: {
  title: string; initial: string; client: ConversationClient; onSelect: (location: FlightLocation) => void; onClose: () => void
}) {
  const [query, setQuery] = useState(initial)
  const [items, setItems] = useState<FlightLocation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => {
    let current = true
    setLoading(true); setError(''); setItems([])
    const timer = setTimeout(() => {
      if (!client.searchLocations) { setError('地点查询暂不可用，请稍后重试。'); setLoading(false); return }
      client.searchLocations(query.trim()).then(locations => { if (current) setItems(locations) })
        .catch(() => { if (current) setError('地点查询失败，请检查后端后重试。') })
        .finally(() => { if (current) setLoading(false) })
    }, 200)
    return () => { current = false; clearTimeout(timer) }
  }, [query, client])
  return <Sheet title={title} onClose={onClose}>
    <View className='fl-location-search'><Icon name='compass' /><Input className='fl-location-query' ariaLabel={`${title}，输入中文、英文或机场代码`} placeholder='城市、机场中文 / English / 代码' value={query} maxlength={100} focus onInput={event => setQuery(event.detail.value)} /><Button className='ux-icon-button' ariaLabel='清空地点搜索' onClick={() => setQuery('')}><Icon name='close' /></Button></View>
    <View className='fl-location-results'>
      {loading ? <View className='fl-picker-status' role='status'>正在查找…</View> : error ? <View className='fl-picker-status' role='alert'>{error}</View> : !items.length ? <Text className='fl-picker-status'>没有匹配地点，试试英文名称或机场代码。</Text> : items.map(item => <Button key={`${item.kind}-${item.code}`} className='fl-location-option' onClick={() => onSelect(item)}>
        <View className='fl-location-copy'><Text className='fl-location-label'>{item.label}</Text><Text className='fl-location-description'>{item.name}{item.city && item.city !== item.name ? ` · ${item.city}` : ''}</Text><Text className='fl-location-scope'>{item.kind === 'city' ? `城市 · ${item.airports.length > 1 ? '全部机场 ' + item.airports.join(' / ') : item.airports.join(' / ')}` : `机场${item.country ? ' · ' + item.country : ''}`}</Text></View><Text className='fl-location-code'>{item.code}</Text>
      </Button>)}
    </View>
  </Sheet>
}

export function FlightDatePicker({ departure, returning, roundTrip, initialTarget, onConfirm, onClose }: {
  departure: string; returning: string; roundTrip: boolean; initialTarget: 'departure' | 'return'; onConfirm: (departure: string, returning: string) => void; onClose: () => void
}) {
  const today = localFlightToday()
  const [selection, setSelection] = useState({ departure, returning, target: initialTarget })
  const [month, setMonth] = useState((initialTarget === 'return' ? returning || departure || today : departure || today).slice(0, 7))
  const pick = (date: string) => setSelection(selectFlightDate(date, selection.departure, selection.returning, selection.target, roundTrip))
  const complete = !!selection.departure && selection.departure >= today && (!roundTrip || (!!selection.returning && selection.returning >= selection.departure))
  return <Sheet title={roundTrip ? '选择往返日期' : '选择出发日期'} onClose={onClose}>
    <View className='fl-calendar-selection'>
      <Button className={`fl-calendar-date ${selection.target === 'departure' ? 'is-active' : ''}`} onClick={() => setSelection({ ...selection, target: 'departure' })}><Text>去程</Text><Text>{selection.departure || '请选择'}</Text></Button>
      {roundTrip ? <Button className={`fl-calendar-date ${selection.target === 'return' ? 'is-active' : ''}`} onClick={() => setSelection({ ...selection, target: 'return' })}><Text>返程</Text><Text>{selection.returning || '请选择'}</Text></Button> : null}
    </View>
    <View className='fl-calendar-month'><Button className='ux-icon-button' ariaLabel='上个月' disabled={month <= today.slice(0, 7)} onClick={() => setMonth(shiftFlightMonth(month, -1))}><Icon name='chevron-left' /></Button><Text>{Number(month.slice(0, 4))} 年 {Number(month.slice(5))} 月</Text><Button className='ux-icon-button' ariaLabel='下个月' onClick={() => setMonth(shiftFlightMonth(month, 1))}><Icon name='chevron-right' /></Button></View>
    <View className='fl-calendar-week'>{['日', '一', '二', '三', '四', '五', '六'].map(day => <Text key={day}>{day}</Text>)}</View>
    <View className='fl-calendar-grid'>{flightMonthDays(month).map((date, index) => date ? <Button key={date} className={`fl-calendar-day ${date === selection.departure || (roundTrip && date === selection.returning) ? 'is-selected' : ''} ${roundTrip && date > selection.departure && date < selection.returning ? 'is-between' : ''}`} ariaLabel={date} aria-pressed={date === selection.departure || (roundTrip && date === selection.returning)} disabled={date < today} onClick={() => pick(date)}>{Number(date.slice(8))}</Button> : <View key={`blank-${index}`} />)}</View>
    <Button className='ux-primary fl-calendar-confirm' disabled={!complete} onClick={() => onConfirm(selection.departure, roundTrip ? selection.returning : '')}>确定日期</Button>
  </Sheet>
}
