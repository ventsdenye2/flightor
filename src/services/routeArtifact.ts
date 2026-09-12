import type { ArtifactEnvelope } from './artifactService'
import { airportTimeDisplay, type AirportTimePresentation } from './airportTime'

export interface RouteLocation {
  id: string; name: string; iata?: string; latitude?: number; longitude?: number
}
export interface RouteLeg {
  id: string; from: RouteLocation; to: RouteLocation
  departureAt?: string; arrivalAt?: string; durationMinutes?: number
  departureDisplay: string; arrivalDisplay: string
  flightNumber?: string; marketingCarrier?: string
  fare?: { amount: number; currency: string }
  fareArtifactId?: string; transferType: 'direct' | 'airline' | 'protected' | 'self'
  airportChange: boolean; warnings: string[]; checkedAt?: string
  layovers: Array<{ afterSegmentIndex: number; durationMinutes?: number; overnight?: boolean }>
  segments: Array<{ from: RouteLocation; to: RouteLocation; departureAt?: string; arrivalAt?: string; departureDisplay: string; arrivalDisplay: string; flightNumber?: string; marketingCarrier?: string }>
}
export interface RouteView {
  id: string; nodes: Array<{ location: RouteLocation; role: string }>; edges: RouteLeg[]
  totalFare?: { amount: number; currency: string }; totalDurationMinutes?: number
  transferCount: number; badges: string[]; warnings: string[]; reasons: string[]; tradeoffs: string[]
}

type Obj = Record<string, unknown>
const obj = (v: unknown): Obj | undefined => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Obj : undefined
const str = (v: unknown, max = 240): string | undefined => typeof v === 'string' && v.length > 0 && v.length <= max ? v : undefined
const num = (v: unknown, max = 500000): number | undefined => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max ? v : undefined
const list = (v: unknown, max: number): unknown[] => Array.isArray(v) && v.length <= max ? v : []
const requiredList = (v: unknown, max: number): unknown[] => {
  if (!Array.isArray(v) || v.length > max) throw new Error('路线数据格式不完整')
  return v
}
const texts = (v: unknown): string[] => list(v, 50).map(x => str(x)).filter((x): x is string => Boolean(x))
const instant = (v: unknown): string | undefined => typeof v === 'string' && v.length <= 64 && Number.isFinite(Date.parse(v)) ? v : undefined

function location(value: unknown): RouteLocation | undefined {
  const v = obj(value)
  if (!v || !str(v.id, 128) || !str(v.name, 160)) return undefined
  const latitude = typeof v.latitude === 'number' && Number.isFinite(v.latitude) && Math.abs(v.latitude) <= 90 ? v.latitude : undefined
  const longitude = typeof v.longitude === 'number' && Number.isFinite(v.longitude) && Math.abs(v.longitude) <= 180 ? v.longitude : undefined
  return { id: String(v.id), name: String(v.name), iata: typeof v.iata === 'string' && /^[A-Z]{3}$/.test(v.iata) ? v.iata : undefined, latitude, longitude }
}
function money(value: unknown): RouteView['totalFare'] {
  const v = obj(value)
  return v && num(v.amount, Number.MAX_SAFE_INTEGER) !== undefined && typeof v.currency === 'string' && /^[A-Z]{3}$/.test(v.currency)
    ? { amount: v.amount as number, currency: v.currency } : undefined
}
function leg(value: unknown, presentation?: AirportTimePresentation, pointer = ''): RouteLeg | undefined {
  const v = obj(value), from = location(v?.from), to = location(v?.to)
  if (!v || !str(v.id, 160) || !from || !to || from.id === to.id || !['direct', 'airline', 'protected', 'self'].includes(String(v.transferType))) return undefined
  const departureAt = instant(v.departureAt), arrivalAt = instant(v.arrivalAt)
  if (departureAt && arrivalAt && Date.parse(arrivalAt) < Date.parse(departureAt)) return undefined
  const segments: RouteLeg['segments'] = []
  if (v.segments !== undefined && (!Array.isArray(v.segments) || !v.segments.length || v.segments.length > 12)) return undefined
  for (const [index, raw] of list(v.segments, 12).entries()) {
    const s = obj(raw), a = location(s?.from), b = location(s?.to)
    if (!s || !a || !b || a.id === b.id) return undefined
    const departure = instant(s.departureAt), arrival = instant(s.arrivalAt)
    if (departure && arrival && Date.parse(arrival) < Date.parse(departure)) return undefined
    if (segments.length && segments[segments.length - 1].to.id !== a.id && v.airportChange !== true) return undefined
    segments.push({ from: a, to: b, departureAt: departure, arrivalAt: arrival,
      departureDisplay: airportTimeDisplay(departure, presentation, `${pointer}/segments/${index}/departureAt`),
      arrivalDisplay: airportTimeDisplay(arrival, presentation, `${pointer}/segments/${index}/arrivalAt`),
      flightNumber: str(s.flightNumber, 32), marketingCarrier: str(s.marketingCarrier, 80) })
  }
  if (segments.length && (segments[0].from.id !== from.id || segments[segments.length - 1].to.id !== to.id)) return undefined
  const layovers: RouteLeg['layovers'] = []
  for (const raw of list(v.layovers, 11)) {
    const item = obj(raw)
    const index = item?.afterSegmentIndex
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= segments.length - 1
      || layovers.some(value => value.afterSegmentIndex === index)) continue
    layovers.push({ afterSegmentIndex: index, durationMinutes: num(item?.durationMinutes),
      ...(typeof item?.overnight === 'boolean' ? { overnight: item.overnight } : {}) })
  }
  return {
    id: String(v.id), from, to, departureAt, arrivalAt, durationMinutes: num(v.durationMinutes),
    departureDisplay: airportTimeDisplay(departureAt, presentation, `${pointer}/departureAt`),
    arrivalDisplay: airportTimeDisplay(arrivalAt, presentation, `${pointer}/arrivalAt`),
    fare: money(v.fare), fareArtifactId: str(v.fareArtifactId, 160),
    transferType: v.transferType as RouteLeg['transferType'], airportChange: v.airportChange === true,
    warnings: texts(v.warnings), checkedAt: instant(obj(v.verification)?.checkedAt), segments, layovers
  }
}
function path(value: unknown, scored?: Obj, presentation?: AirportTimePresentation, pointer = ''): RouteView | undefined {
  const v = obj(value)
  if (!v || !str(v.id, 160) || !Array.isArray(v.nodes) || !Array.isArray(v.edges) || v.nodes.length < 2 || v.nodes.length > 32 || v.edges.length !== v.nodes.length - 1 || num(v.transferCount, 30) === undefined || !Number.isInteger(v.transferCount)) return undefined
  const nodes: RouteView['nodes'] = []
  for (const raw of v.nodes) {
    const node = obj(raw), loc = location(node?.location)
    if (!node || !loc || !['origin', 'destination', 'visit', 'stopover'].includes(String(node.role))) return undefined
    nodes.push({ location: loc, role: String(node.role) })
  }
  const edges: RouteLeg[] = []
  for (let i = 0; i < v.edges.length; i++) {
    const e = leg(v.edges[i], presentation, `${pointer}/edges/${i}`)
    if (!e || e.from.id !== nodes[i].location.id || e.to.id !== nodes[i + 1].location.id) return undefined
    edges.push(e)
  }
  const explanation = obj(scored?.explanation)
  return {
    id: String(v.id), nodes, edges, totalFare: money(v.totalFare), totalDurationMinutes: num(v.totalDurationMinutes),
    transferCount: num(v.transferCount, 30) ?? 0,
    badges: texts(scored?.badges).filter(x => ['cheapest', 'balanced', 'most_fun', 'best_match'].includes(x)),
    warnings: [...new Set([...texts(v.warnings), ...texts(explanation?.warnings), ...edges.flatMap(e => e.warnings)])],
    reasons: list(explanation?.scoreBreakdown, 32).flatMap(raw => {
      const item = obj(raw)
      return item?.direction === 'positive' && typeof item.contribution === 'number' && item.contribution > 0 && str(item.reason) ? [String(item.reason)] : []
    }),
    tradeoffs: texts(explanation?.tradeoffs)
  }
}

/** Reject malformed complete paths as a unit, so the UI cannot draw a false connection. */
export function readRouteArtifact(artifact: Pick<ArtifactEnvelope, 'type' | 'schemaVersion' | 'payload' | 'presentation'>): RouteView[] {
  const v = obj(artifact.payload)
  if (artifact.type !== 'route_set' || artifact.schemaVersion !== 1 || v?.schemaVersion !== 1) throw new Error('暂不支持此路线版本')
  const result: RouteView[] = []
  if (v.kind === 'optimized_routes') {
    for (const [index, raw] of requiredList(v.representatives, 50).entries()) {
      const scored = obj(raw), route = path(scored?.path, scored, artifact.presentation, `/representatives/${index}/path`)
      if (!route) throw new Error('路线数据不完整，请重新生成')
      result.push(route)
    }
  } else if (v.kind === 'flight_paths') {
    for (const [index, raw] of requiredList(v.paths, 200).entries()) {
      const route = path(raw, undefined, artifact.presentation, `/paths/${index}`)
      if (!route) throw new Error('路线数据不完整，请重新生成')
      result.push(route)
    }
  } else if (v.kind === 'connection_edges') {
    for (const [index, raw] of requiredList(v.edges, 500).entries()) {
      const e = leg(raw, artifact.presentation, `/edges/${index}`)
      if (!e) throw new Error('航段数据不完整')
      result.push({ id: e.id, nodes: [{ location: e.from, role: 'origin' }, { location: e.to, role: 'destination' }], edges: [e], totalFare: e.fare, totalDurationMinutes: e.durationMinutes, transferCount: Math.max(0, e.segments.length - 1), badges: [], warnings: e.warnings, reasons: [], tradeoffs: [] })
    }
  } else throw new Error('暂不支持此路线类型')
  if (new Set(result.map(r => r.id)).size !== result.length) throw new Error('路线标识重复')
  return result
}

export function routeLabel(route: RouteView): string { return route.nodes.map(n => n.location.iata ?? n.location.name).join(' → ') }
export function fareLabel(fare: RouteView['totalFare']): string { return fare ? `${fare.currency} ${fare.amount.toLocaleString()}` : '价格待确认' }
export function durationLabel(minutes?: number): string { return minutes === undefined ? '时长未提供' : `${Math.floor(minutes / 60)}小时${minutes % 60 ? ` ${minutes % 60}分` : ''}` }
export const badgeLabels: Record<string, string> = { cheapest: '价格最低', balanced: '综合均衡', most_fun: '体验优先', best_match: '偏好匹配' }
