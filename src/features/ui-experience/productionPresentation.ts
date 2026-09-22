import { tripText } from '../../i18n/trip'
import type { ArtifactEnvelope } from '../../services/artifactService'
import type { CloudWorkspace } from '../../services/workspaceService'
import type { ConversationDelivery } from '../../services/conversationService'
import { displayTravelGuideBudget, displayTravelGuidePublication, firstText, numberValue, record, records, text } from '../../components/artifacts/payload'
import { readRouteArtifact } from '../../services/routeArtifact'
import type { Activity, PricePresentation, SourcePresentation, TripDay, TripFlightPresentation, TripPresentation } from './presentation'
import { displayOfferById } from '../../components/artifacts/payload'

type Item = Record<string, unknown>
const locationName = (value: unknown, locale: 'zh' | 'en') => { const item = record(value); return firstText(item?.name, item?.city, item?.iata, item?.cityCode) ?? tripText(locale, 'trip.locationUnknown') }
export function safeSourceUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return
  try { const url = new URL(value); if (['http:', 'https:'].includes(url.protocol) && url.hostname && !url.username && !url.password) return url.href } catch { /* unsupported URL */ }
}
function sources(item: Item, locale: 'zh' | 'en'): SourcePresentation[] {
  const verification = record(item.verification)
  const state = text(verification?.status)
  const status: SourcePresentation['status'] = state === 'verified' ? 'verified' : state === 'partially_verified' ? 'partial' : state === 'stale' ? 'stale' : 'unverified'
  return records(verification?.sources, 30).map(source => ({ label: firstText(source.provider, source.domain) ?? tripText(locale, 'trip.sources'), url: safeSourceUrl(source.reference ?? source.url), status }))
}
function verificationStatus(value: unknown): SourcePresentation['status'] {
  const state = text(record(value)?.status)
  return state === 'verified' ? 'verified' : state === 'partially_verified' ? 'partial' : state === 'stale' ? 'stale' : 'unverified'
}
function duration(minutes: number | undefined, locale: 'zh' | 'en' = 'zh'): string | null {
  if (minutes === undefined) return null
  const hours = Math.floor(minutes / 60), rest = minutes % 60
  return [hours ? tripText(locale, 'trip.hours', { n: hours }) : '', rest ? tripText(locale, 'trip.minutes', { n: rest }) : ''].filter(Boolean).join(' ') || tripText(locale, 'trip.minutes', { n: 0 })
}
/** Translate only the clock adapter's fixed uncertainty labels, never place names or timestamps. */
function flightClock(value: string | undefined, locale: 'zh' | 'en'): string | null {
  if (!value || value === '时间未提供' || value === 'Time unavailable') return null
  return value.replace('airport timezone unavailable', tripText(locale, 'trip.airportZoneUnknown'))
    .replace('provider local; timezone unavailable', tripText(locale, 'trip.providerZoneUnknown'))
    .replace('UTC offset unavailable', tripText(locale, 'trip.offsetUnknown'))
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
export function savedRouteFlights(artifact: ArtifactEnvelope | undefined, routeId: string | undefined, locale: 'zh' | 'en' = 'zh'): TripFlightPresentation[] {
  const payload = record(artifact?.payload)
  if (!artifact || !routeId || artifact.type !== 'route_set' || artifact.schemaVersion !== 1 || payload?.schemaVersion !== 1 || payload.kind !== 'optimized_routes') return []
  const raw = records(payload.representatives, 50).map(value => record(value.path)).find(path => text(path?.id) === routeId)
  if (!raw) return []
  let selected
  try { selected = readRouteArtifact(artifact).find(route => route.id === routeId) } catch { return [] }
  if (!selected) return []
  const verification = selectedRouteVerification(raw, payload.verification)
  const status = verificationStatus(verification)
  const source = sources({ verification }, locale)[0] ?? { label: tripText(locale, 'trip.selectedFlight'), status }
  const routeSegments = selected.edges.flatMap(edge => edge.segments.length ? edge.segments : [edge])
  const legs = routeSegments.map((segment, index) => {
    const next = routeSegments[index + 1]
    const wait = segment.arrivalAt && next?.departureAt ? Math.round((Date.parse(next.departureAt) - Date.parse(segment.arrivalAt)) / 60000) : undefined
    const changedAirport = next && segment.to.id !== next.from.id
    return {
      from: segment.from.name, to: segment.to.name,
      fromCode: segment.from.iata, toCode: segment.to.iata,
      depart: flightClock(segment.departureDisplay, locale), arrive: flightClock(segment.arrivalDisplay, locale),
      duration: duration(segment.durationMinutes, locale),
      carrier: [segment.marketingCarrier, segment.flightNumber].filter(Boolean).join(' · ') || tripText(locale, 'trip.carrierUnknown'),
      ...(next ? { transfer: `${changedAirport ? tripText(locale, 'trip.airportChange', { from: segment.to.name, to: next.from.name }) : tripText(locale, 'trip.transferAt', { airport: segment.to.name })}${wait !== undefined && wait >= 0 ? ` · ${duration(wait, locale)}` : ` · ${tripText(locale, 'trip.connectionUnknown')}`}` } : {})
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
    airlineLabel: carriers.join(' / ') || tripText(locale, 'trip.carrierUnknown'),
    transferLabel: selected.transferCount === 0 ? tripText(locale, 'trip.direct') : tripText(locale, 'trip.transfers', { n: selected.transferCount }),
    transferDuration: duration(totalWait, locale) ?? undefined,
    ...(warnings.length ? { warning: tripText(locale, 'trip.reviewRisks') } : {}), source
  }]
}
export function savedOfferFlights(artifact: ArtifactEnvelope | undefined, offerId: string | undefined, locale: 'zh' | 'en' = 'zh'): TripFlightPresentation[] {
  if (!artifact || artifact.type !== 'flight_search' || !offerId) return []
  const payload = record(artifact.payload)
  const offer = payload ? displayOfferById(payload, offerId, artifact.presentation) : undefined
  if (!offer || !offer.segments.length) return []
  const status = verificationStatus(artifact.verification ?? payload?.verification)
  const source = sources({ verification: artifact.verification ?? payload?.verification }, locale)[0]
    ?? { label: firstText(payload?.provider) ?? tripText(locale, 'trip.selectedFlight'), status }
  const connections = new Map(offer.layovers.map(value => [value.afterSegmentIndex, value]))
  const legs = offer.segments.map((segment, index) => {
    const connection = connections.get(index)
    return {
      from: segment.origin || tripText(locale, 'trip.airportUnknown'), to: segment.destination || tripText(locale, 'trip.airportUnknown'), fromCode: segment.origin, toCode: segment.destination,
      depart: flightClock(segment.departure, locale), arrive: flightClock(segment.arrival, locale),
      duration: duration(segment.durationMinutes, locale),
      carrier: [segment.airline, segment.flightNumber].filter(Boolean).join(' · ') || tripText(locale, 'trip.carrierUnknown'),
      ...(connection ? { transfer: `${connection.airportChange ? tripText(locale, 'trip.airportChange', { from: connection.airport, to: connection.departureAirport ?? tripText(locale, 'trip.airportUnknown') }) : tripText(locale, 'trip.transferAt', { airport: connection.airport })}${connection.durationMinutes === undefined ? ` · ${tripText(locale, 'trip.connectionUnknown')}` : ` · ${duration(connection.durationMinutes, locale)}`}` } : {})
    }
  })
  const totalWait = offer.layovers.length && offer.layovers.every(value => value.durationMinutes !== undefined)
    ? offer.layovers.reduce((sum, value) => sum + value.durationMinutes!, 0) : undefined
  return [{
    id: `${artifact.id}:${offerId}`,
    title: offer.segments.map((segment, index) => index === 0 ? `${segment.origin} → ${segment.destination}` : `→ ${segment.destination}`).join(' '),
    dateLabel: offer.segments[0]?.departureAt?.slice(0, 10) ?? '', legs,
    price: { amount: offer.amount ?? null, currency: offer.currency ?? '', unit: 'total', status: priceStatus(status), source },
    airlineLabel: offer.airlines.join(' / ') || tripText(locale, 'trip.carrierUnknown'),
    transferLabel: offer.layovers.length ? tripText(locale, 'trip.transfers', { n: offer.layovers.length }) : tripText(locale, 'trip.direct'),
    transferDuration: duration(totalWait, locale) ?? undefined,
    ...(offer.transferType === 'self' ? { warning: tripText(locale, 'trip.selfTransfer') } : {}),
    source
  }]
}
function activity(item: Item, enrichment: Item | undefined, locale: 'zh' | 'en'): Activity {
  const tt = (key: string) => tripText(locale, key)
  const time = text(item.timeOfDay)
  const resolution=record(enrichment?.place),entity=record(resolution?.place),identityPoint=record(entity?.coordinates)
  const latitude = numberValue(identityPoint?.latitude), longitude = numberValue(identityPoint?.longitude)
  const confirmed=resolution?.status==='resolved'&&/^osm:(node|way|relation):\d+$/.test(text(entity?.placeId)??'')&&identityPoint?.system==='WGS84'&&['venue','park','district','street'].includes(String(entity?.kind))&&/^[A-Z]{2}$/.test(text(entity?.countryCode)??'')
  const located = confirmed && latitude !== undefined && longitude !== undefined && (latitude!==0||longitude!==0) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180
  const media = record(enrichment?.media), mediaUrl = safeSourceUrl(media?.src)
  const attribution = record(media?.source)
  const place = record(item.city)
  return { id: text(item.id)!, name: text(item.title)!, introduction: text(item.description)!,
    recommendationReason: text(item.recommendationReason)!, summary: text(item.description)!,
    area: locationName(item.city, locale), locationHint: { id: text(place?.id), name: text(place?.name), cityCode: text(place?.cityCode), countryCode: text(place?.countryCode) },
    time: time && ['morning', 'afternoon', 'evening', 'flexible'].includes(time) ? tt(`trip.${time}`) : null,
    until: null, category: tt(`trip.${['activity', 'event', 'seasonal', 'stopover', 'practical'].includes(String(item.category)) ? item.category : 'activity'}`),
    sourceApplicabilityNotice: '', latitude: located ? latitude : null, longitude: located ? longitude : null,
    place: {status:text(resolution?.status)??'unresolved',reason:text(resolution?.reason)??'not_requested',placeId:confirmed?text(entity?.placeId):undefined,
      name:confirmed?text(entity?.name):undefined,kind:confirmed?text(entity?.kind):undefined,countryCode:confirmed?text(entity?.countryCode):undefined,
      ...(confirmed?{system:'WGS84' as const}:{}),...(safeSourceUrl(record(entity?.source)?.url)?{source:{label:'© OpenStreetMap contributors',url:safeSourceUrl(record(entity?.source)?.url),status:'verified' as const}}:{})},
    media: mediaUrl ? { src: mediaUrl, description: text(media?.description) ?? text(item.title)!,
      ...(text(attribution?.label) ? { source: { label: text(attribution?.label)!, url: safeSourceUrl(attribution?.url), status: 'unverified' as const } } : {}) } : null,
    source: null }
}
function delivered(delivery: ConversationDelivery | undefined, id: string): boolean {
  return Boolean(delivery && ((delivery.status === 'satisfied' && delivery.artifactIds.includes(id)) || delivery.goals?.some(goal => delivered(goal, id))))
}
export function artifactToTripPresentation(routeArtifact: ArtifactEnvelope, guideArtifact?: ArtifactEnvelope, workspace?: CloudWorkspace,
  savedRouteArtifact?: ArtifactEnvelope, locale: 'zh' | 'en' = 'zh'): TripPresentation {
  const tt = (key: string, params?: Record<string, string | number>) => tripText(locale, key, params)
  const route = record(routeArtifact.payload)
  if (routeArtifact.type !== 'route' || route?.kind !== 'trip_route_plan') throw new Error('不支持的路线快照')
  const candidate = guideArtifact ? record(guideArtifact.payload) : undefined
  if (guideArtifact && (guideArtifact.type !== 'travel_guide' || candidate?.kind !== 'trip_travel_guide' || guideArtifact.tripId !== routeArtifact.tripId || candidate.routeArtifactId !== routeArtifact.id)) throw new Error('攻略与路线快照不匹配')
  const pub = guideArtifact && candidate ? displayTravelGuidePublication(candidate.publication, guideArtifact.id, numberValue(route.tripContextVersion)) : undefined
  const current = workspace?.trip.id === routeArtifact.tripId && workspace.trip.contextVersion === route.tripContextVersion
  const context = current ? workspace?.tripContextSummary : undefined
  const selection = workspace?.trip.selectedFlight, binding = record(candidate?.flightSelection)
  const matchesFlight = selection ? Boolean(binding && binding.kind === selection.kind && binding.artifactId === selection.artifactId
    && binding.choiceId === (selection.kind === 'offer' ? selection.offerId : selection.routeId) && binding.revision === selection.revision) : !binding
  const completeText = records(candidate?.days, 60).length > 0 && records(candidate?.days, 60).every(day => text(day.theme)
    && records(day.items, 6).every(item => text(item.id) && text(item.title) && text(item.description) && text(item.recommendationReason)))
  const state: NonNullable<TripPresentation['publication']>['status'] = !current || !matchesFlight ? 'stale'
    : !pub || pub.legacy || !pub.status ? 'legacy' : pub.locale !== locale ? 'preparing'
      : pub.status === 'accepted' ? completeText && text(pub.overview) && /^[a-f0-9]{64}$/.test(pub.guideContentHash ?? '') ? 'accepted' : 'revision_required'
        : pub.status === 'blocked' ? pub.failureKind === 'retryable' ? 'retryable' : 'revision_required' : 'preparing'
  const accepted = state === 'accepted'
  const guide = accepted ? candidate : undefined
  const dayValues = records(guide?.days ?? route.days, 60)
  const enrichment = guideArtifact?.enrichment?.contentVersion === pub?.guideContentHash ? guideArtifact?.enrichment : undefined
  const days: TripDay[] = dayValues.map((day, index) => ({ id: numberValue(day.day) ?? index + 1,
    label: tt('trip.day', { n: numberValue(day.day) ?? index + 1 }), title: accepted ? text(day.theme)! : tt('trip.preparing'),
    subtitle: locationName(day.city, locale), status: accepted ? 'ready' : 'pending',
    activities: accepted ? records(day.items, 6).map(item => activity(item, record(enrichment?.activities[text(item.id)!]), locale)) : [] }))
  const routeNames = records(route.cities, 12).map(city => locationName(city.location, locale))
  const issues = (pub?.locale === locale ? pub?.issues ?? [] : []).map((issue, index) => ({ activityId: issue.activityId, code: issue.code,
    label: `${issue.activityId ? `${tt('trip.issue.activity', { n: index + 1 })} · ` : ''}${tt(`trip.issue.${/closed|closure|闭馆|关闭/i.test(issue.detail ?? '') ? 'closed' : ['conflict', 'invalid_plan', 'missing_material', 'context_budget'].includes(issue.code) ? issue.code : 'technical'}`)}` }))
  const budget = pub && current ? displayTravelGuideBudget(candidate?.budget) : undefined
  let flights: TripFlightPresentation[] = []
  if (current && selection && savedRouteArtifact && selection.contextVersion === route.tripContextVersion
    && selection.artifactId === savedRouteArtifact.id && savedRouteArtifact.tripId === routeArtifact.tripId) {
    flights = selection.kind === 'offer' ? savedOfferFlights(savedRouteArtifact, selection.offerId, locale) : savedRouteFlights(savedRouteArtifact, selection.routeId, locale)
  }
  // Only an explicit positive statement in current authoritative notes establishes self-arranged flights.
  const selfProvided = (context?.notes ?? []).some(note => /^(?:机票自备|机票已自备|已自备机票|已自行购买机票|用户自备机票|flights? (?:already )?(?:booked|arranged)(?: independently)?|self[- ]provided (?:flights|tickets))(?=$|[，,。.;；!])/i.test(note.trim()))
  const references = Object.values(record(record(candidate?.publication)?.references) ?? {}).flatMap(value => records(value, 20))
  const sourceUrls = [...new Set(references.map(ref => safeSourceUrl(ref.url)).filter((url): url is string => Boolean(url)))]
  const routeRisks = (Array.isArray(route.warnings) ? route.warnings : []).map(warning =>
    tt(/closed|closure|闭馆|关闭/i.test(String(warning)) ? 'trip.issue.closed'
      : /date.{0,20}conflict|日期冲突/i.test(String(warning)) ? 'trip.issue.conflict' : 'trip.reviewRisks'))
  const mapPoint=(raw:unknown)=>{const p=record(raw),c=record(p?.coordinates)??p,latitude=numberValue(c?.latitude),longitude=numberValue(c?.longitude)
    return c?.system==='WGS84'&&latitude!==undefined&&longitude!==undefined&&(latitude!==0||longitude!==0)&&Math.abs(latitude)<=90&&Math.abs(longitude)<=180&&text(p?.countryCode)&&text(p?.placeId??p?.id)
      ?{id:text(p?.placeId??p?.id)!,name:text(p?.name)??'',countryCode:text(p?.countryCode)!,latitude,longitude,kind:text(p?.kind)}:undefined}
  return { id: routeArtifact.tripId, locale, title: tt('trip.title'), destination: routeNames[0] ?? days[0]?.subtitle ?? tt('trip.locationUnknown'), route: routeNames,
    dates: { start: context?.departureWindow?.precision === 'exact' ? context.departureWindow.from ?? null : null,
      end: context?.returnWindow?.precision === 'exact' ? context.returnWindow.to ?? context.returnWindow.from ?? null : null, label: '' },
    durationDays: context?.travelDays ?? (days.length || null), travelers: null, cover: null,
    description: accepted ? pub!.overview! : tt(`trip.${state === 'preparing' ? 'preparingHint' : state === 'retryable' ? 'retryableHint' : state === 'revision_required' ? 'revisionHint' : state === 'legacy' ? 'legacyHint' : 'staleHint'}`),
    days, status: accepted && guideArtifact && workspace?.messages.some(message => delivered(message.delivery, guideArtifact.id)) ? 'ready' : 'partial',
    publication: { artifactId: guideArtifact?.id, contentVersion: pub?.guideContentHash, status: state, revision: pub?.revision ?? 0,
      canLocalize: Boolean(current && matchesFlight && !pub?.legacy && pub?.locale === locale && pub?.canLocalize),
      canRetry: Boolean(current && matchesFlight && pub?.locale === locale && pub?.canLocalize && pub?.canRetry && state === 'retryable'), issues },
    mapCities:accepted?(enrichment?.cities??[]).map(mapPoint).filter((p):p is NonNullable<typeof p>=>!!p):[],
    flightPaths:accepted&&selection?(enrichment?.flightPaths??[]).map(line=>line.map(mapPoint).filter((p):p is NonNullable<typeof p>=>!!p)).filter(line=>line.length===2):[],
    flightArrangement: selection ? 'selected' : selfProvided ? 'self_provided' : 'unconfirmed', flights, alternatives: [],
    // Never publish raw warning prose; unresolved risks remain visible with localized instructions.
    risks: [...new Set([...issues.map(issue => issue.label), ...routeRisks])],
    sources: sourceUrls.map((url, index) => ({ url, label: tt('trip.source', { n: index + 1 }), status: 'unverified' })),
    ...(budget ? { budget: { ...budget, label: tt(`trip.budget.${budget.scope}`) } } : {}) }
}
