import type { ArtifactEnvelope } from '../../services/artifactService'
import type { CloudWorkspace } from '../../services/workspaceService'
import type { ConversationDelivery } from '../../services/conversationService'
import { firstText, numberValue, record, records, text } from '../../components/artifacts/payload'
import { readRouteArtifact } from '../../services/routeArtifact'
import type { Activity, PricePresentation, SourcePresentation, TripDay, TripFlightPresentation, TripPresentation } from './presentation'

type Item = Record<string, unknown>
const locationName = (value: unknown) => { const item = record(value); return firstText(item?.name, item?.city, item?.iata, item?.cityCode) ?? '地点待确认' }
export function safeSourceUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return
  try { const url = new URL(value); if (['http:', 'https:'].includes(url.protocol) && url.hostname && !url.username && !url.password) return url.href } catch { /* unsupported URL */ }
}
function sources(item: Item): SourcePresentation[] {
  const verification = record(item.verification)
  const state = text(verification?.status)
  const status: SourcePresentation['status'] = state === 'verified' ? 'verified' : state === 'partially_verified' ? 'partial' : state === 'stale' ? 'stale' : 'unverified'
  return records(verification?.sources, 30).map(source => ({ label: firstText(source.title, source.provider, source.domain) ?? '资料来源', url: safeSourceUrl(source.reference ?? source.url), status }))
}
function verificationStatus(value: unknown): SourcePresentation['status'] {
  const state = text(record(value)?.status)
  return state === 'verified' ? 'verified' : state === 'partially_verified' ? 'partial' : state === 'stale' ? 'stale' : 'unverified'
}
function duration(minutes: number | undefined): string | null {
  if (minutes === undefined) return null
  const hours = Math.floor(minutes / 60), rest = minutes % 60
  return `${hours ? `${hours} 小时` : ''}${hours && rest ? ' ' : ''}${rest ? `${rest} 分钟` : ''}` || '0 分钟'
}
function selectedRouteVerification(path: Item, fallback: unknown): Item {
  const edgeVerifications = records(path.edges, 31).map(edge => record(edge.verification)).filter((value): value is Item => Boolean(value))
  if (!edgeVerifications.length) return record(fallback) ?? {}
  const states = edgeVerifications.map(verificationStatus)
  const status = states.includes('unverified') ? 'unverified' : states.includes('stale') ? 'stale' : states.includes('partial') ? 'partially_verified' : 'verified'
  const sourceValues = edgeVerifications.flatMap(value => records(value.sources, 20))
  return { status, sources: [...new Map(sourceValues.map(source => [`${firstText(source.provider, source.title, source.domain) ?? ''}:${firstText(source.reference, source.url) ?? ''}`, source])).values()].slice(0, 20) }
}
function priceStatus(status: SourcePresentation['status']): PricePresentation['status'] {
  return status === 'verified' ? 'verified' : status === 'partial' ? 'partial' : status === 'stale' ? 'stale' : 'unknown'
}
/** A saved route is the only route-set relationship strong enough to appear as
 * an itinerary flight. Unsupported or malformed snapshots stay an empty state. */
export function savedRouteFlights(artifact: ArtifactEnvelope | undefined, routeId: string | undefined): TripFlightPresentation[] {
  const payload = record(artifact?.payload)
  if (!artifact || !routeId || artifact.type !== 'route_set' || artifact.schemaVersion !== 1 || payload?.schemaVersion !== 1 || payload.kind !== 'optimized_routes') return []
  const raw = records(payload.representatives, 50).map(value => record(value.path)).find(path => text(path?.id) === routeId)
  if (!raw) return []
  let selected
  try { selected = readRouteArtifact(artifact).find(route => route.id === routeId) } catch { return [] }
  if (!selected) return []
  const verification = selectedRouteVerification(raw, payload.verification)
  const status = verificationStatus(verification)
  const source = sources({ verification })[0] ?? { label: '已保存的航班路线', status }
  const routeSegments = selected.edges.flatMap(edge => edge.segments.length ? edge.segments : [edge])
  const legs = routeSegments.map((segment, index) => {
    const next = routeSegments[index + 1]
    const wait = segment.arrivalAt && next?.departureAt ? Math.round((Date.parse(next.departureAt) - Date.parse(segment.arrivalAt)) / 60000) : undefined
    const changedAirport = next && segment.to.id !== next.from.id
    return {
      from: segment.from.name, to: segment.to.name,
      fromCode: segment.from.iata, toCode: segment.to.iata,
      depart: segment.departureDisplay, arrive: segment.arrivalDisplay,
      duration: duration(segment.durationMinutes),
      carrier: [segment.marketingCarrier, segment.flightNumber].filter(Boolean).join(' · ') || '航司待确认',
      ...(next ? { transfer: `${changedAirport ? `${segment.to.name}至${next.from.name}换机场` : `在${segment.to.name}中转`}${wait !== undefined && wait >= 0 ? ` · ${duration(wait)}` : ' · 衔接时长待确认'}` } : {})
    }
  })
  if (!legs.length) return []
  const firstRawEdge = records(raw.edges, 31)[0]
  const carriers = [...new Set(routeSegments.map(segment => segment.marketingCarrier).filter((value): value is string => Boolean(value)))]
  const warnings = [...new Set([...selected.warnings, ...selected.edges.flatMap(edge => edge.warnings)])]
  const amount = selected.totalFare && status !== 'unverified' ? selected.totalFare.amount : null
  const waits = routeSegments.slice(0, -1).map((segment, index) => segment.arrivalAt && routeSegments[index + 1]?.departureAt
    ? Math.round((Date.parse(routeSegments[index + 1].departureAt!) - Date.parse(segment.arrivalAt)) / 60000) : undefined)
  const totalWait = waits.length > 0 && waits.every((value): value is number => value !== undefined && value >= 0)
    ? waits.reduce((sum, value) => sum + value, 0) : undefined
  return [{
    id: `${artifact.id}:${selected.id}`,
    title: selected.nodes.map(node => node.location.iata ?? node.location.name).join(' → '),
    dateLabel: text(firstRawEdge?.departureDate) ?? '', legs,
    price: { amount, currency: selected.totalFare?.currency ?? '', unit: 'total', status: priceStatus(status), source },
    airlineLabel: carriers.join(' / ') || '航司待确认',
    transferLabel: selected.transferCount === 0 ? '直飞' : `${selected.transferCount} 次中转`,
    transferDuration: duration(totalWait) ?? undefined,
    ...(warnings.length ? { warning: warnings.join('；') } : {}), source
  }]
}
function activity(item: Item, index: number): Activity {
  const time = text(item.timeOfDay)
  return { id: text(item.id) ?? `activity-${index}`, name: firstText(item.title, item.name) ?? '活动待补充',
    time: time ? ({ morning: '上午', afternoon: '下午', evening: '晚上', flexible: '灵活安排' } as Record<string, string>)[time] ?? null : null,
    until: null, category: text(item.category) ?? '活动', summary: firstText(item.description, item.summary, item.planningNote) ?? '活动资料待补充。',
    // The guide contract currently has city coordinates only, not venue coordinates.
    latitude: null, longitude: null, media: null, source: sources(item)[0] ?? null }
}
function delivered(delivery: ConversationDelivery | undefined, id: string): boolean {
  return Boolean(delivery && ((delivery.status === 'satisfied' && delivery.artifactIds.includes(id)) || delivery.goals?.some(goal => delivered(goal, id))))
}
export function artifactToTripPresentation(routeArtifact: ArtifactEnvelope, guideArtifact?: ArtifactEnvelope, workspace?: CloudWorkspace, savedRouteArtifact?: ArtifactEnvelope): TripPresentation {
  const route = record(routeArtifact.payload)
  if (routeArtifact.type !== 'route' || route?.kind !== 'trip_route_plan') throw new Error('不支持的路线快照')
  const guide = guideArtifact ? record(guideArtifact.payload) : undefined
  if (guideArtifact && (guideArtifact.type !== 'travel_guide' || guide?.kind !== 'trip_travel_guide' || guideArtifact.tripId !== routeArtifact.tripId || guide.routeArtifactId !== routeArtifact.id)) throw new Error('攻略与路线快照不匹配')
  const current = workspace?.trip.id === routeArtifact.tripId && workspace.trip.contextVersion === route.tripContextVersion
  const context = current ? workspace?.tripContextSummary : undefined
  const start = context?.departureWindow?.precision === 'exact' ? context.departureWindow.from : null
  const end = context?.returnWindow?.precision === 'exact' ? context.returnWindow.to ?? context.returnWindow.from : null
  const dayValues = records(guide?.days ?? route.days, 60)
  const days: TripDay[] = dayValues.map((day, index) => ({ id: numberValue(day.day) ?? index + 1, label: `第 ${numberValue(day.day) ?? index + 1} 天`,
    title: firstText(day.theme) ?? (guide ? day.kind === 'rest' ? '休息与自由活动' : '每日安排' : '每日安排待补充'), subtitle: locationName(day.city), status: guide ? 'ready' : 'pending',
    activities: guide ? records(day.items, 6).map((item, itemIndex) => activity(item, index * 6 + itemIndex)) : [] }))
  const routeNames = records(route.cities, 12).map(city => locationName(city.location))
  const allSources = dayValues.flatMap(day => records(day.items, 6).flatMap(sources))
  const warnings = [...(Array.isArray(route.warnings) ? route.warnings : []), ...(Array.isArray(guide?.warnings) ? guide.warnings : [])].filter(value => typeof value === 'string')
  const satisfied = Boolean(current && guideArtifact && workspace?.messages.some(message => delivered(message.delivery, guideArtifact.id)))
  const savedSelection = workspace?.trip.savedRoute
  let savedRoute: TripFlightPresentation[] = []
  if (current && savedSelection && savedRouteArtifact && savedSelection.contextVersion === route.tripContextVersion
    && savedSelection.artifactId === savedRouteArtifact.id && savedRouteArtifact.tripId === routeArtifact.tripId) {
    savedRoute = savedRouteFlights(savedRouteArtifact, savedSelection.routeId)
  }
  return { id: routeArtifact.tripId, title: (workspace?.trip.id === routeArtifact.tripId ? firstText(workspace.trip.title) : undefined) ?? (guide ? '我的旅行安排' : '我的路线草案'),
    destination: routeNames[0] ?? days[0]?.subtitle ?? '目的地待确认', route: routeNames,
    dates: { start: start ?? null, end: end ?? null, label: !start && !end ? '日期待确认' : '' }, durationDays: context?.travelDays ?? (days.length || null),
    travelers: null, cover: null, description: `${current ? '' : '这是此前保存的行程版本。'}${guide ? '每日安排已保存，活动及开放时间仍需核验。' : '路线草案已保存，每日安排待补充。'}${warnings.length ? '含待确认事项，请查看规划记录。' : ''}`,
    days, status: satisfied ? 'ready' : 'partial', flights: savedRoute, alternatives: [],
    sources: [...new Map(allSources.map(source => [`${source.url ?? source.label}:${source.status}`, source])).values()] }
}
