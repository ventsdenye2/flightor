import type { Activity, SourcePresentation, TripFlightPresentation, TripPresentation } from './presentation'
import { initialDays, alternative } from './fixtures'
import { media, photoDescriptions } from './media'

const sampleSource: SourcePresentation = { label: '固定设计样例 · 未核验票价、班次与可用性', status: 'sample' }
const lisbonFlight: TripFlightPresentation = {
  id: 'lisbon-outbound', title: '去程航班', dateLabel: '10 月 12 日',
  airlineLabel: '卡塔尔航空', airlineCode: 'QR', transferLabel: '多哈转机', transferDuration: '2h 20m',
  price: { amount: 5280, currency: 'CNY', unit: 'person', status: 'sample', source: sampleSource }, source: sampleSource,
  legs: [
    { from: '上海浦东', fromCode: 'PVG', to: '多哈', toCode: 'DOH', depart: '01:50', arrive: '05:55', duration: '9h 05m', carrier: '卡塔尔航空', transfer: '多哈停留 2h 20m · 中转条件待核验' },
    { from: '多哈', fromCode: 'DOH', to: '里斯本', toCode: 'LIS', depart: '08:15', arrive: '14:00', duration: '7h 45m', carrier: '卡塔尔航空' }
  ]
}
export const lisbonTrip: TripPresentation = {
  id: 'lisbon-seven-days', title: '去里斯本，慢一点。', destination: '里斯本', country: '葡萄牙', route: ['上海', '多哈', '里斯本'],
  dates: { start: '2026-10-12', end: '2026-10-18', label: '10.12 – 10.18' }, durationDays: 7, travelers: 2,
  cover: { src: media.hero, description: photoDescriptions.hero, atmosphere: true },
  description: '老城、河岸、海风，还有一点留白。', status: 'ready', days: initialDays, initialDayId: 2,
  flights: [lisbonFlight], alternatives: [alternative, ...initialDays[1].activities],
  routeIllustration: { src: '/assets/ui-experience/flight-route.svg', description: '航线示意：上海经多哈前往里斯本，非实际飞行轨迹' },
  returnNote: '10 月 18 日 · 返程航班与机场接驳尚未补充',
  sources: [
    { label: 'Aswin / Unsplash · 城市与河岸', url: 'https://unsplash.com/photos/es7bSg9VPP0', status: 'verified' },
    { label: 'Pamela Hallam / Unsplash · 城堡景观', url: 'https://unsplash.com/photos/jabczusxopU', status: 'verified' },
    { label: 'Dmitry Voronov / Unsplash · 阿尔法玛街区', url: 'https://unsplash.com/photos/JejHeHnfb0E', status: 'verified' },
    { label: 'Timur Seyfelmlyukov / Unsplash · 城市日落，来源待复核', url: 'https://unsplash.com/photos/i5j0kB6FcA', status: 'unverified' },
    sampleSource
  ]
}

const kyotoWalk: Activity = { id: 'kyoto-walk', name: '京都街区散步', time: null, until: null, category: '轻松漫步', summary: '安顿之后，按住宿位置选择方便的一段街区。具体起点、时间和步行路线留待确认。', latitude: null, longitude: null, media: null, source: null }
const kyotoRest: Activity = { id: 'kyoto-rest', name: '留一段休息时间', time: null, until: null, category: '自由安排', summary: '根据当天体力选择休息或继续漫步；具体地点和时刻尚未安排。', media: null, source: null }
export const kyotoTrip: TripPresentation = {
  id: 'kyoto-three-days', title: '在京都，留三天给自己。', destination: '京都', country: '日本', route: ['上海', '大阪', '京都'],
  dates: { start: '2026-11-03', end: '2026-11-05', label: '11.03 – 11.05' }, durationDays: 3, travelers: 1,
  cover: { src: null, description: '京都目的地照片待补充' }, description: '短途、散步与自由安排，按自己的节奏出发。', status: 'ready', initialDayId: 'arrival-kyoto',
  days: [
    { id: 'arrival-kyoto', status: 'ready', label: '抵达', title: '先安顿，再认识附近', subtitle: '接驳与住宿位置待确认', activities: [kyotoWalk] },
    { id: '2026-11-04', status: 'ready', label: '慢游', title: '给散步和休息留些时间', subtitle: '具体地点与时间待确认', activities: [kyotoRest] },
    { id: 'departure-kyoto', status: 'ready', label: '返程', title: '从容收拾，留够返程时间', subtitle: '航班与机场交通待确认', activities: [] }
  ],
  flights: [{
    id: 'kyoto-outbound', title: '去程候选', dateLabel: '11 月 3 日', airlineLabel: '航司待确认',
    transferLabel: '中转情况待确认', source: sampleSource,
    price: { amount: null, currency: 'CNY', unit: 'person', status: 'unknown', source: sampleSource },
    legs: [{ from: '上海浦东', fromCode: 'PVG', to: '大阪关西', toCode: 'KIX', depart: null, arrive: null, duration: null, carrier: '航司待确认' }]
  }], alternatives: [kyotoWalk, kyotoRest], sources: [sampleSource],
  returnNote: '11 月 5 日 · 返程航班、京都至机场交通待确认'
}
export const partialTrip: TripPresentation = {
  ...lisbonTrip, id: 'lisbon-partial', status: 'partial',
  days: lisbonTrip.days.map((day, index) => index < 2 ? day : { ...day, status: 'pending', activities: [] })
}
export const complexTrip: TripPresentation = {
  ...lisbonTrip, id: 'lisbon-connections', route: ['上海', '多哈', '马德里', '里斯本'], routeIllustration: null,
  flights: [{
    ...lisbonFlight, id: 'lisbon-multi-segment', airlineLabel: '卡塔尔航空 + 葡萄牙航空', airlineCode: 'QR+',
    transferLabel: '2 次转机', transferDuration: '含自行中转',
    warning: '分开出票，行李需提取并重新托运。入境资格、航站楼与中转时间待核验。',
    legs: [
      lisbonFlight.legs[0],
      { from: '多哈', fromCode: 'DOH', to: '马德里', toCode: 'MAD', depart: '08:15', arrive: '14:15', duration: '7h 00m', carrier: '卡塔尔航空', transfer: '马德里停留 2h 55m · 自行中转' },
      { from: '马德里', fromCode: 'MAD', to: '里斯本', toCode: 'LIS', depart: '17:10', arrive: '17:40', duration: '1h 30m', carrier: '葡萄牙航空' }
    ]
  }]
}
export const emptyTrip: TripPresentation = {
  id: 'trip-awaiting-details', title: '下一站，留待你来写。', destination: '目的地待定', route: [],
  dates: { start: null, end: null, label: '' }, durationDays: null, travelers: null, cover: null,
  description: '日期、目的地与同行人确定后，再展开每天的安排。', status: 'pending',
  days: [], flights: [], alternatives: [], sources: [sampleSource]
}
export const sampleTrips: TripPresentation[] = [lisbonTrip, kyotoTrip, partialTrip, emptyTrip, complexTrip]
export function getSampleTrip(id: string): TripPresentation | undefined { return sampleTrips.find(trip => trip.id === id) }
