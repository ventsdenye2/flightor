export interface FlightSelection { searchId: string; candidateId: string }
export interface FlightJourney {
  direction?: 'outbound' | 'return'; airlines: string[]
  departureAirport: string | null; arrivalAirport: string | null
  departureLocal: string | null; arrivalLocal: string | null
  durationMinutes: number | null; stopCount: number | null
  segments: Array<{ airline: string | null; flightNumber: string; origin: string; destination: string; departureLocal: string | null; arrivalLocal: string | null; durationMinutes: number | null; cabin?: string | null; stops?: Array<{ city: string; durationMinutes: number | null }> }>
  connections: Array<{ city: string; durationMinutes: number | null; selfTransfer: boolean | null; airportChange: boolean | null; collectAndRecheckBaggage: boolean | null }>
  baggage: { carryOn: string | null; checked: string | null } | null
}
export interface FlightOption extends FlightJourney {
  id: string; amount: number | null; currency: string; journeys?: FlightJourney[]
}
export const flightJourneys = (option: FlightOption): FlightJourney[] => option.journeys?.length ? option.journeys : [option]
export interface FlightOptions {
  searchId: string; source: string; sourceUrl: string | null; observedAt: string; status: string
  origin: string; destination: string; originName: string; destinationName: string; date: string; adults: number; cabin: string; options: FlightOption[]
  tripType?: 'one_way' | 'round_trip'; returnDate?: string | null
}
export type FlightOptionSort = 'recommended' | 'price' | 'duration'
export const flightValue = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0
export const flightTime = (value: string | null) => value?.match(/T(\d{2}:\d{2})/)?.[1] || value?.match(/^\d{2}:\d{2}$/)?.[0] || '待确认'
export const flightDate = (value: string | null) => value?.match(/^\d{4}-\d{2}-\d{2}/)?.[0] || '日期待确认'
export const flightDuration = (value: number | null) => flightValue(value) ? `${Math.floor(value / 60)}小时${value % 60 ? `${value % 60}分` : ''}` : '用时待确认'
export const flightStops = (value: number | null, technicalStops = 0) => flightValue(value) ? value === 0 ? '直飞' : technicalStops > 0 && technicalStops <= value ? [value > technicalStops ? `${value - technicalStops}次中转` : '', `${technicalStops}次经停`].filter(Boolean).join(' · ') : `${value}次中转` : '中转待确认'
export const flightPrice = (option: FlightOption) => flightValue(option.amount) ? `${({ CNY: '¥', USD: '$', EUR: '€', GBP: '£', HKD: 'HK$', SGD: 'S$' } as Record<string, string>)[option.currency] || option.currency + ' '}${option.amount.toLocaleString('en-US')}` : '价格待确认'
export function arrivalDayOffset(option: FlightJourney) {
  const from = Date.parse(flightDate(option.departureLocal) + 'T00:00:00Z'), to = Date.parse(flightDate(option.arrivalLocal) + 'T00:00:00Z')
  return Number.isFinite(from) && Number.isFinite(to) ? Math.round((to - from) / 86400000) : 0
}
export const transferCaution = (option: FlightJourney & { journeys?: FlightJourney[] }) => {
  const connections = option.journeys?.flatMap(journey => journey.connections) || option.connections
  return [connections.some(c => c.selfTransfer === true) ? '需自行中转' : '', connections.some(c => c.airportChange === true) ? '需更换机场' : '', connections.some(c => c.collectAndRecheckBaggage === true) ? '需重新托运行李' : ''].filter(Boolean).join(' · ')
}
const comparablePrices = (items: FlightOption[]) => new Set(items.filter(item => flightValue(item.amount)).map(item => item.currency)).size <= 1
function score(option: FlightOption, items: FlightOption[]) {
  const prices = items.filter(item => flightValue(item.amount)).map(item => item.amount!), times = items.filter(item => flightValue(item.durationMinutes)).map(item => item.durationMinutes!)
  const normalize = (value: number | null, list: number[]) => flightValue(value) && list.length ? (value - Math.min(...list)) / (Math.max(...list) - Math.min(...list) || 1) : 1
  return (comparablePrices(items) ? normalize(option.amount, prices) * .45 : 0) + normalize(option.durationMinutes, times) * .4 + (flightValue(option.stopCount) ? Math.min(option.stopCount, 3) / 3 : 1) * .15 + (transferCaution(option) ? .3 : 0)
}
export function sortFlightOptions(items: FlightOption[], sort: FlightOptionSort): FlightOption[] {
  return [...items].sort((a, b) => {
    if (sort === 'recommended') return score(a, items) - score(b, items)
    if (sort === 'price' && !comparablePrices(items)) return a.currency.localeCompare(b.currency) || (a.amount ?? Infinity) - (b.amount ?? Infinity)
    const x = sort === 'price' ? a.amount : a.durationMinutes, y = sort === 'price' ? b.amount : b.durationMinutes
    return (flightValue(x) ? x : Infinity) - (flightValue(y) ? y : Infinity)
  })
}
export function flightReasons(option: FlightOption, items: FlightOption[]) {
  const reasons: string[] = []
  const prices = items.filter(item => item.currency === option.currency && flightValue(item.amount)).map(item => item.amount!)
  const times = items.filter(item => flightValue(item.durationMinutes)).map(item => item.durationMinutes!)
  if (flightValue(option.amount) && prices.length > 1 && option.amount === Math.min(...prices)) reasons.push('本次同币种结果中票价最低，适合优先控制机票预算。')
  if (flightValue(option.durationMinutes) && times.length > 1 && option.durationMinutes === Math.min(...times)) reasons.push('本次结果中总用时最短，能把更多时间留给目的地。')
  if (option.stopCount === 0) reasons.push(option.journeys?.length ? '去返程均直飞，旅途安排更简单。' : '直飞无需中转，旅途安排更简单。')
  if (!reasons.length) reasons.push(flightValue(option.durationMinutes) ? `总用时${flightDuration(option.durationMinutes)}，可以结合预算与抵达时刻比较。` : '可作为备选，先比较已知票价和当地起降时刻。')
  if (transferCaution(option)) reasons.push(transferCaution(option) + '，选择前留意衔接安排。')
  return reasons.slice(0, 3)
}
export const flightSelectionMessage = (result: FlightOptions, option: FlightOption) => `我已选择${result.tripType === 'round_trip' ? '往返组合' : '这班单程航班'}：${flightJourneys(option).map(j => `${j.direction === 'return' ? '返程' : '去程'} ${j.departureAirport || result.origin} → ${j.arrivalAirport || result.destination}，${flightDate(j.departureLocal)} ${flightTime(j.departureLocal)}出发，${flightDate(j.arrivalLocal)} ${flightTime(j.arrivalLocal)}抵达`).join('；')}。查询价格${flightPrice(option)} / 成人。请结合此前对话，确认去返程及抵达、离开时间都确定后，现在开始规划行程；若还缺交通信息请先询问。`
