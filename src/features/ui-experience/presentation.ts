// UI-owned display values. This module has no dependency on providers, stores or model output.
export interface SourcePresentation { label: string; url?: string; status: 'sample' | 'unverified' | 'verified' | 'partial' | 'stale' }
export interface MediaPresentation { src: string | null; description: string; source?: SourcePresentation; atmosphere?: boolean }
export interface PricePresentation { amount: number | null; currency: string; unit: 'person' | 'total'; status: 'sample' | 'estimate' | 'unknown'; source?: SourcePresentation }
export interface FlightLegDisplay { from: string; to: string; depart: string | null; arrive: string | null; duration: string | null; carrier: string; nextDay?: boolean; transfer?: string; fromCode?: string; toCode?: string }
export interface TripFlightPresentation {
  id: string; title: string; dateLabel: string; legs: FlightLegDisplay[]; price: PricePresentation
  airlineLabel: string; airlineCode?: string; transferLabel?: string; transferDuration?: string; warning?: string; source: SourcePresentation
}
export interface Activity {
  id: string; name: string; time: string | null; until: string | null; category: string; summary: string
  latitude?: number | null; longitude?: number | null; media: MediaPresentation | null; source: SourcePresentation | null
}
export interface TripDay { id: string | number; label: string; title: string; subtitle: string; status: 'ready' | 'pending'; activities: Activity[] }
export interface TripPresentation {
  id: string; title: string; destination: string; country?: string; route: string[]
  dates: { start: string | null; end: string | null; label: string }; durationDays: number | null; travelers: number | null
  cover: MediaPresentation | null; description: string; days: TripDay[]; status: 'ready' | 'partial' | 'pending'
  flights: TripFlightPresentation[]; alternatives: Activity[]; sources: SourcePresentation[]
  routeIllustration?: MediaPresentation | null; initialDayId?: TripDay['id']; returnNote?: string
}

export function hasCoordinates(activity: Pick<Activity, 'latitude' | 'longitude'>): activity is Pick<Activity, 'latitude' | 'longitude'> & { latitude: number; longitude: number } {
  return typeof activity.latitude === 'number' && Number.isFinite(activity.latitude) && Math.abs(activity.latitude) <= 90
    && typeof activity.longitude === 'number' && Number.isFinite(activity.longitude) && Math.abs(activity.longitude) <= 180
}
// Viewport bounds only. Keep these separate from real markers and route points:
// fitting directly to a northernmost coordinate clips the 40px map pin above it.
export function mapViewportPoints(points: Array<{ latitude: number; longitude: number }>): Array<{ latitude: number; longitude: number }> {
  if (points.length < 2) return points
  const south = Math.min(...points.map(point => point.latitude))
  const north = Math.max(...points.map(point => point.latitude))
  const west = Math.min(...points.map(point => point.longitude))
  const east = Math.max(...points.map(point => point.longitude))
  const latitudePadding = (north - south) * 0.4
  const longitudePadding = (east - west) * 0.4
  return [
    { latitude: Math.max(-90, south - latitudePadding), longitude: Math.max(-180, west - longitudePadding) },
    { latitude: Math.min(90, north + latitudePadding), longitude: Math.min(180, east + longitudePadding) }
  ]
}
export function selectTripDay(days: TripDay[], selectedId?: TripDay['id'] | null): TripDay | undefined {
  return days.find(day => day.id === selectedId && day.status === 'ready') || days.find(day => day.status === 'ready')
}
export function findAlternative(day: TripDay, candidates: Activity[], excludedId?: string): Activity | undefined {
  return candidates.find(candidate => candidate.id !== excludedId && !day.activities.some(activity => activity.id === candidate.id))
}
export function hasKnownPrice(price?: PricePresentation | null): price is PricePresentation & { amount: number } {
  return !!price && price.status !== 'unknown' && price.amount !== null && Number.isFinite(price.amount) && price.amount >= 0
}
export function formatPrice(price?: PricePresentation | null): string {
  if (!hasKnownPrice(price)) return '价格待确认'
  const symbol = ({ CNY: '¥', JPY: '¥', USD: '$', EUR: '€', GBP: '£' } as Record<string, string>)[price.currency]
  const amount = price.amount.toLocaleString('en-US', { maximumFractionDigits: 2 })
  return symbol ? `${symbol}${amount}` : `${amount} ${price.currency || '币种待确认'}`
}
export function priceStatusLabel(price?: PricePresentation | null): string {
  return !hasKnownPrice(price) ? '尚无报价' : price.status === 'sample' ? '示例价' : '估算价'
}
export function formatTripDates(trip: Pick<TripPresentation, 'dates'>): string {
  if (trip.dates.label) return trip.dates.label
  if (trip.dates.start && trip.dates.end) return `${trip.dates.start} – ${trip.dates.end}`
  if (trip.dates.start) return `${trip.dates.start} 起 · 结束日期待确认`
  if (trip.dates.end) return `开始日期待确认 – ${trip.dates.end}`
  return '日期待确认'
}
export function tripDurationLabel(trip: Pick<TripPresentation, 'durationDays'>): string {
  return trip.durationDays !== null && Number.isInteger(trip.durationDays) && trip.durationDays > 0 ? `${trip.durationDays} 天` : '天数待确认'
}
export function travelerLabel(trip: Pick<TripPresentation, 'travelers'>): string {
  return trip.travelers !== null && Number.isInteger(trip.travelers) && trip.travelers > 0 ? `${trip.travelers} 人同行` : '同行人数待确认'
}
