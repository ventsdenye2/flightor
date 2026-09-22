import type { ArtifactEnvelope } from '../../services/artifactService'
import type { CloudWorkspace } from '../../services/workspaceService'
import type { ConversationDelivery } from '../../services/conversationService'
import { displaySupportingEvidence, displayTravelGuideBudget, displayTravelGuidePublication, firstText, formatResearchDescription, numberValue, record, records, text } from '../../components/artifacts/payload'
import { readRouteArtifact } from '../../services/routeArtifact'
import type { Activity, PricePresentation, SourcePresentation, TripDay, TripFlightPresentation, TripPresentation } from './presentation'
import { displayOfferById } from '../../components/artifacts/payload'

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
export function savedOfferFlights(artifact: ArtifactEnvelope | undefined, offerId: string | undefined): TripFlightPresentation[] {
  if (!artifact || artifact.type !== 'flight_search' || !offerId) return []
  const payload = record(artifact.payload)
  const offer = payload ? displayOfferById(payload, offerId, artifact.presentation) : undefined
  if (!offer || !offer.segments.length) return []
  const status = verificationStatus(artifact.verification ?? payload?.verification)
  const source = sources({ verification: artifact.verification ?? payload?.verification })[0]
    ?? { label: firstText(payload?.provider) ?? '航班搜索快照', status }
  const connections = new Map(offer.layovers.map(value => [value.afterSegmentIndex, value]))
  const legs = offer.segments.map((segment, index) => {
    const connection = connections.get(index)
    return {
      from: segment.origin || '出发机场待确认', to: segment.destination || '到达机场待确认', fromCode: segment.origin, toCode: segment.destination,
      depart: segment.departure ?? null, arrive: segment.arrival ?? null,
      duration: duration(segment.durationMinutes),
      carrier: [segment.airline, segment.flightNumber].filter(Boolean).join(' · ') || '航司待确认',
      ...(connection ? { transfer: `${connection.airportChange ? `${connection.airport}至${connection.departureAirport ?? '下一机场'}换机场` : `在${connection.airport}中转`}${connection.durationMinutes === undefined ? ' · 衔接时长待确认' : ` · ${duration(connection.durationMinutes)}`}` } : {})
    }
  })
  const totalWait = offer.layovers.length && offer.layovers.every(value => value.durationMinutes !== undefined)
    ? offer.layovers.reduce((sum, value) => sum + value.durationMinutes!, 0) : undefined
  return [{
    id: `${artifact.id}:${offerId}`,
    title: offer.segments.map((segment, index) => index === 0 ? `${segment.origin} → ${segment.destination}` : `→ ${segment.destination}`).join(' '),
    dateLabel: offer.segments[0]?.departure?.slice(0, 10) ?? '', legs,
    price: { amount: offer.amount ?? null, currency: offer.currency ?? '', unit: 'total', status: priceStatus(status), source },
    airlineLabel: offer.airlines.join(' / ') || '航司待确认',
    transferLabel: offer.layovers.length ? `${offer.layovers.length} 次中转` : '直飞',
    transferDuration: duration(totalWait) ?? undefined,
    ...(offer.transferType === 'self' ? { warning: '自行中转；行李、入境和衔接保障需另行确认。' } : {}),
    source
  }]
}
function activity(item: Item, index: number, accepted = false, locale = 'zh'): Activity {
  const time = text(item.timeOfDay)
  const summary = formatResearchDescription(firstText(item.description, item.summary, item.planningNote), item.sourceApplicability)
  return { id: text(item.id) ?? `activity-${index}`, name: firstText(item.title, item.name) ?? '活动待补充',
    time: time ? (locale === 'en' ? time : ({ morning: '上午', afternoon: '下午', evening: '晚上', flexible: '灵活安排' } as Record<string, string>)[time]) ?? null : null,
    until: null, category: text(item.category) ?? '活动', summary: accepted ? [summary.description, text(item.recommendationReason)].filter(Boolean).join('\n') : summary.description || '活动资料待补充。', sourceApplicabilityNotice: accepted ? '' : summary.notice,
    // The guide contract currently has city coordinates only, not venue coordinates.
    latitude: null, longitude: null, media: null, source: sources(item)[0] ?? null }
}
function delivered(delivery: ConversationDelivery | undefined, id: string): boolean {
  return Boolean(delivery && ((delivery.status === 'satisfied' && delivery.artifactIds.includes(id)) || delivery.goals?.some(goal => delivered(goal, id))))
}
export function artifactToTripPresentation(routeArtifact: ArtifactEnvelope, guideArtifact?: ArtifactEnvelope, workspace?: CloudWorkspace, savedRouteArtifact?: ArtifactEnvelope): TripPresentation {
  const route = record(routeArtifact.payload)
  if (routeArtifact.type !== 'route' || route?.kind !== 'trip_route_plan') throw new Error('不支持的路线快照')
  const guideCandidate = guideArtifact ? record(guideArtifact.payload) : undefined
  if (guideArtifact && (guideArtifact.type !== 'travel_guide' || guideCandidate?.kind !== 'trip_travel_guide' || guideArtifact.tripId !== routeArtifact.tripId || guideCandidate.routeArtifactId !== routeArtifact.id)) throw new Error('攻略与路线快照不匹配')
  const publication = guideArtifact && guideCandidate
    ? displayTravelGuidePublication(guideCandidate.publication, guideArtifact.id, numberValue(route.tripContextVersion))
    : undefined
  // Old local caches/replays may contain plausible guide prose without the
  // server publication binding. Keep the route/flight boundary, but drop all
  // guide-owned titles, notes, evidence, warnings, and activities.
  const guide = publication ? guideCandidate : undefined
  const staleGuide = Boolean(guideArtifact && !publication)
  const current = workspace?.trip.id === routeArtifact.tripId && workspace.trip.contextVersion === route.tripContextVersion
  const context = current ? workspace?.tripContextSummary : undefined
  const savedSelection = workspace?.trip.selectedFlight
  const guideSelection = record(guide?.flightSelection)
  const guideMatchesSelection = savedSelection
    ? Boolean(guideSelection
      && text(guideSelection.kind) === savedSelection.kind
      && text(guideSelection.artifactId) === savedSelection.artifactId
      && text(guideSelection.choiceId) === (savedSelection.kind === 'offer' ? savedSelection.offerId : savedSelection.routeId)
      && numberValue(guideSelection.revision) === savedSelection.revision)
    : !guideSelection
  const guideApplicable = Boolean(guide && current && guideMatchesSelection && (!publication?.status || publication.status === 'accepted'))
  const start = context?.departureWindow?.precision === 'exact' ? context.departureWindow.from : null
  const end = context?.returnWindow?.precision === 'exact' ? context.returnWindow.to ?? context.returnWindow.from : null
  const dayValues = records(guide?.days ?? route.days, 60)
  const days: TripDay[] = dayValues.map((day, index) => ({ id: numberValue(day.day) ?? index + 1, label: publication?.locale === 'en' ? `Day ${numberValue(day.day) ?? index + 1}` : `第 ${numberValue(day.day) ?? index + 1} 天`,
    title: firstText(day.theme) ?? (guide ? day.kind === 'rest' ? '休息与自由活动' : '每日安排' : '每日安排待补充'), subtitle: locationName(day.city), status: guideApplicable ? 'ready' : 'pending',
    activities: guide ? records(day.items, 6).map((item, itemIndex) => activity(item, index * 6 + itemIndex, publication?.status === 'accepted', publication?.locale)) : [] }))
  const routeNames = records(route.cities, 12).map(city => locationName(city.location))
  const allSources = dayValues.flatMap(day => records(day.items, 6).flatMap(sources))
  const warnings = [...(Array.isArray(route.warnings) ? route.warnings : []), ...(Array.isArray(guide?.warnings) ? guide.warnings : [])].filter(value => typeof value === 'string')
  const budget = displayTravelGuideBudget(guide?.budget)
  const supportingEvidence = displaySupportingEvidence(guide?.supportingEvidence)
  const satisfied = Boolean(guideApplicable && guideArtifact && workspace?.messages.some(message => delivered(message.delivery, guideArtifact.id)))
  let savedRoute: TripFlightPresentation[] = []
  if (current && savedSelection && savedRouteArtifact && savedSelection.contextVersion === route.tripContextVersion
    && savedSelection.artifactId === savedRouteArtifact.id && savedRouteArtifact.tripId === routeArtifact.tripId) {
    savedRoute = savedSelection.kind === 'offer'
      ? savedOfferFlights(savedRouteArtifact, savedSelection.offerId)
      : savedRouteFlights(savedRouteArtifact, savedSelection.routeId)
  }
  const description = `${current ? '' : '这是此前保存的行程版本。'}${staleGuide ? '这份旧攻略无法安全展示，已保留路线和航班边界。' : guide && !guideMatchesSelection ? '航班已更换，这份安排需要按新航班调整。' : guide ? '每日安排已保存，活动及开放时间仍需核验。' : '路线草案已保存，每日安排待补充。'}${publication ? ` ${publication.budgetNotice}` : ''}${warnings.length ? '含待确认事项，请查看规划记录。' : ''}`
  return { id: routeArtifact.tripId, title: (workspace?.trip.id === routeArtifact.tripId ? firstText(workspace.trip.title) : undefined) ?? (guide ? '我的旅行安排' : '我的路线草案'),
    destination: routeNames[0] ?? days[0]?.subtitle ?? '目的地待确认', route: routeNames,
    dates: { start: start ?? null, end: end ?? null, label: !start && !end ? '日期待确认' : '' }, durationDays: context?.travelDays ?? (days.length || null),
    travelers: null, cover: null, description: publication?.status ? publication.overview ?? publication.reply : description,
    days, status: satisfied ? 'ready' : 'partial', flights: savedRoute, alternatives: [],
     sources: [...new Map(allSources.map(source => [`${source.url ?? source.label}:${source.status}`, source])).values()], ...(budget ? { budget } : {}), ...(supportingEvidence.length ? { supportingEvidence } : {}) }
}
