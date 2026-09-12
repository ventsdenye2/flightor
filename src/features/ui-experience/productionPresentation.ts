import type { ArtifactEnvelope } from '../../services/artifactService'
import type { CloudWorkspace } from '../../services/workspaceService'
import type { ConversationDelivery } from '../../services/conversationService'
import { firstText, numberValue, record, records, text } from '../../components/artifacts/payload'
import type { Activity, SourcePresentation, TripDay, TripPresentation } from './presentation'

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
export function artifactToTripPresentation(routeArtifact: ArtifactEnvelope, guideArtifact?: ArtifactEnvelope, workspace?: CloudWorkspace): TripPresentation {
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
  return { id: routeArtifact.tripId, title: (workspace?.trip.id === routeArtifact.tripId ? firstText(workspace.trip.title) : undefined) ?? (guide ? '我的旅行安排' : '我的路线草案'),
    destination: routeNames[0] ?? days[0]?.subtitle ?? '目的地待确认', route: routeNames,
    dates: { start: start ?? null, end: end ?? null, label: !start && !end ? '日期待确认' : '' }, durationDays: context?.travelDays ?? (days.length || null),
    travelers: null, cover: null, description: `${current ? '' : '这是保存的历史快照。'}${guide ? '每日安排已保存，活动及开放时间仍需核验。' : '路线草案已保存，每日安排待补充。'}${warnings.length ? '含待确认事项，请查看规划记录。' : ''}`,
    days, status: satisfied ? 'ready' : 'partial', flights: [], alternatives: [],
    sources: [...new Map(allSources.map(source => [`${source.url ?? source.label}:${source.status}`, source])).values()] }
}
