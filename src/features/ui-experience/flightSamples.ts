import type { FlightLegDisplay } from './presentation'

/** Search presentation data only; no inventory, booking or provider authority. */
export interface FlightSearchItem {
  id: string
  airline: string
  monogram: string
  /** CNY, per adult, tax-inclusive display amount. null means unknown. */
  price: number | null
  departure: string | null
  arrival: string | null
  minutes: number | null
  stops: number | null
  via: string | null
  badge: string
  selfTransfer: boolean | null
  nextDay?: boolean
  legs: FlightLegDisplay[]
  sourceNote?: string
}
export interface FlightSearchDataset {
  origin: string
  destination: string
  date: string
  travelers?: number
  originName?: string
  destinationName?: string
  originAliases?: string[]
  destinationAliases?: string[]
  flights: FlightSearchItem[]
  sourceNote?: string
  tripLinkLabel?: string
}
export type FlightSearchInput = { from: string; to: string; date: string; travelers: number }
export type FlightFilters = { price: number; oneStop: boolean; protectedOnly: boolean }
export type FlightSort = 'recommended' | 'price' | 'duration'
export const DEFAULT_FLIGHT_FILTERS: FlightFilters = { price: 0, oneStop: false, protectedOnly: false }
export const knownAmount = (value: number | null | undefined): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0
export const formatFlightAmount = (value: number | null) => knownAmount(value) ? value.toLocaleString('en-US') : '待核验'
export const formatFlightDuration = (minutes: number | null) => knownAmount(minutes) ? `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m` : '用时待核验'
export const formatFlightStops = (stops: number | null) => knownAmount(stops) ? stops === 0 ? '直飞' : `${stops} 次中转` : '中转待核验'
export const canonicalAirport = (value: string, dataset: FlightSearchDataset) => {
  const normalized = value.trim().toLocaleLowerCase()
  if ([dataset.origin, dataset.originName, ...(dataset.originAliases || [])].some(alias => alias?.toLocaleLowerCase() === normalized)) return dataset.origin.toUpperCase()
  if ([dataset.destination, dataset.destinationName, ...(dataset.destinationAliases || [])].some(alias => alias?.toLocaleLowerCase() === normalized)) return dataset.destination.toUpperCase()
  return value.trim().toUpperCase()
}
export const initialFlightSearch = (dataset: FlightSearchDataset): FlightSearchInput => ({
  from: dataset.origin.toUpperCase(), to: dataset.destination.toUpperCase(), date: dataset.date,
  travelers: Number.isInteger(dataset.travelers) && dataset.travelers! >= 1 && dataset.travelers! <= 4 ? dataset.travelers! : 1
})
export const matchesFlightDataset = (search: FlightSearchInput, dataset: FlightSearchDataset) => canonicalAirport(search.from, dataset) === dataset.origin.toUpperCase() && canonicalAirport(search.to, dataset) === dataset.destination.toUpperCase() && search.date === dataset.date
export const selectFlightResults = (dataset: FlightSearchDataset, search: FlightSearchInput, filters: FlightFilters = DEFAULT_FLIGHT_FILTERS, sort: FlightSort = 'recommended'): FlightSearchItem[] => {
  if (!matchesFlightDataset(search, dataset)) return []
  const matches = dataset.flights.filter(flight =>
    (!filters.price || (knownAmount(flight.price) && flight.price <= filters.price)) &&
    (!filters.oneStop || (knownAmount(flight.stops) && flight.stops <= 1)) &&
    (!filters.protectedOnly || flight.selfTransfer === false)
  )
  if (sort === 'recommended') return matches
  return matches.sort((a, b) => {
    const first = sort === 'price' ? a.price : a.minutes
    const second = sort === 'price' ? b.price : b.minutes
    if (!knownAmount(first)) return knownAmount(second) ? 1 : 0
    if (!knownAmount(second)) return -1
    return first - second
  })
}
export const validFlightDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

const defaultFlights: FlightSearchItem[] = [
  { id: 'qr', airline: '卡塔尔航空', monogram: 'QR', price: 5280, departure: '01:50', arrival: '14:00', minutes: 1150, stops: 1, via: '多哈 DOH', badge: '均衡之选', selfTransfer: false, legs: [
    { from: '上海浦东 PVG', to: '多哈 DOH', depart: '01:50', arrive: '05:55', duration: '9 小时 05 分', carrier: '卡塔尔航空', transfer: '多哈停留 2 小时 20 分' },
    { from: '多哈 DOH', to: '里斯本 LIS', depart: '08:15', arrive: '14:00', duration: '7 小时 45 分', carrier: '卡塔尔航空' }
  ] },
  { id: 'af', airline: '法国航空', monogram: 'AF', price: 6790, departure: '22:15', arrival: '08:50', minutes: 1055, stops: 1, via: '巴黎 CDG', badge: '用时最短', selfTransfer: false, nextDay: true, legs: [
    { from: '上海浦东 PVG', to: '巴黎戴高乐 CDG', depart: '22:15', arrive: '06:00', duration: '13 小时 45 分', carrier: '法国航空', nextDay: true, transfer: '巴黎停留 1 小时 20 分' },
    { from: '巴黎戴高乐 CDG', to: '里斯本 LIS', depart: '07:20', arrive: '08:50', duration: '2 小时 30 分', carrier: '法国航空' }
  ] },
  { id: 'mixed', airline: '卡塔尔航空 + 葡萄牙航空', monogram: 'QR+', price: 4590, departure: '01:50', arrival: '17:40', minutes: 1370, stops: 2, via: '多哈 · 马德里', badge: '票价较低', selfTransfer: true, legs: [
    { from: '上海浦东 PVG', to: '多哈 DOH', depart: '01:50', arrive: '05:55', duration: '9 小时 05 分', carrier: '卡塔尔航空', transfer: '多哈停留 2 小时 20 分' },
    { from: '多哈 DOH', to: '马德里 MAD', depart: '08:15', arrive: '14:15', duration: '7 小时', carrier: '卡塔尔航空', transfer: '马德里停留 2 小时 55 分 · 自行中转' },
    { from: '马德里 MAD', to: '里斯本 LIS', depart: '17:10', arrive: '17:40', duration: '1 小时 30 分', carrier: '葡萄牙航空' }
  ] }
]

export const defaultFlightDataset: FlightSearchDataset = {
  origin: 'PVG', destination: 'LIS', originName: '上海浦东', destinationName: '里斯本', originAliases: ['上海'],
  date: '2026-10-12', travelers: 1, flights: defaultFlights,
  sourceNote: '数据来源：FlightOR 设计样例，非航司或机票服务商报价。税费拆分、余位、行李、退改签与中转资格均待核验。',
  tripLinkLabel: '看看里斯本 7 日行程样例'
}
export const kyotoFlightDataset: FlightSearchDataset = {
  origin: 'PVG', destination: 'KIX', originName: '上海浦东', destinationName: '大阪关西', originAliases: ['上海'], destinationAliases: ['大阪', '关西'],
  date: '2026-11-03', travelers: 1, tripLinkLabel: '看看京都行程样例',
  sourceNote: '京都体验固定样例：经大阪关西抵达。票价、时间和交通均未向服务商核验。',
  flights: [
    { id: 'kyoto-known', airline: '示例航空 A', monogram: 'A', price: 1680, departure: '09:10', arrival: '12:10', minutes: 120, stops: 0, via: null, badge: '短途样例', selfTransfer: false,
      legs: [{ from: '上海浦东 PVG', to: '大阪关西 KIX', depart: '09:10', arrive: '12:10', duration: '2 小时', carrier: '示例航空 A', fromCode: 'PVG', toCode: 'KIX' }] },
    { id: 'kyoto-unknown', airline: '示例航空 B', monogram: 'B', price: null, departure: null, arrival: null, minutes: null, stops: 0, via: null, badge: '票价待核验', selfTransfer: false,
      legs: [{ from: '上海浦东 PVG', to: '大阪关西 KIX', depart: null, arrive: null, duration: null, carrier: '示例航空 B', fromCode: 'PVG', toCode: 'KIX' }] }
  ]
}
export const emptyFlightDataset: FlightSearchDataset = { ...kyotoFlightDataset, flights: [], sourceNote: '当前数据集尚无航班结果，未补造票价或航段。' }
