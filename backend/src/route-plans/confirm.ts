import {
  itinerariesFromSerpResponse,
  type FlightOption,
  type FlightSearchInput
} from '../search/serpapi.js'
import {
  LODGING_CNY,
  type RouteLeg,
  type RoutePick,
  type ConfirmedPick,
  isNightLeg
} from './engine.js'

export interface RoutePlanFlightClient {
  searchFlights(input: {
    origin: string
    destination: string
    departDate: string
    currency?: string
  }): Promise<Record<string, unknown>>
}

export interface ConfirmRouteOptions {
  /** No key means a deliberate estimate-only response; no provider calls are made. */
  hasKey?: boolean
  /** Maximum number of concurrent SerpApi requests across all picks. */
  concurrency?: number
}

export const GLOBAL_PROVIDER_CONCURRENCY = 2

type Release = () => void
type Waiter = (release: Release) => void

/**
 * A process-wide limiter for confirmation probes.  The route handler can be
 * invoked concurrently by Fastify, so a per-request worker count is not
 * enough to protect the provider quota.  Queued waiters receive the released
 * slot directly, keeping the active count stable while handing it off.
 */
class ProviderSemaphore {
  private active = 0
  private readonly waiters: Waiter[] = []

  acquire(): Promise<Release> {
    if (this.active < GLOBAL_PROVIDER_CONCURRENCY) {
      this.active += 1
      return Promise.resolve(this.createRelease())
    }
    return new Promise(resolve => {
      this.waiters.push(resolve)
    })
  }

  private createRelease(): Release {
    let released = false
    return () => {
      if (released) return
      released = true
      const next = this.waiters.shift()
      if (next) {
        next(this.createRelease())
        return
      }
      this.active -= 1
    }
  }
}

const providerSemaphore = new ProviderSemaphore()

function timeParts(value: string): { date: string; time: string } | null {
  const match = value.match(/(\d{4}-\d{2}-\d{2})[ T](\d{1,2}:[0-5]\d)/)
  if (!match) return null
  const [hour, minute] = match[2]!.split(':').map(Number)
  if (hour === undefined || minute === undefined || hour > 23) return null
  return {
    date: match[1]!,
    time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
  }
}

function mapOptionToRouteLeg(option: FlightOption, requested: RouteLeg): RouteLeg | null {
  const first = option.segments[0]
  const last = option.segments[option.segments.length - 1]
  if (!first || !last) return null
  if (first.origin !== requested.from || last.destination !== requested.to) return null
  const departure = timeParts(first.departTime)
  const arrival = timeParts(last.arriveTime)
  if (!departure || !arrival) return null
  if (departure.date !== requested.date) return null
  const flightNo = option.segments.map(segment => segment.flightNo).filter(Boolean).join(' + ')
  const airline = option.airline.trim() || option.segments.map(segment => segment.airline).filter(Boolean).join(' + ')
  const leg: RouteLeg = {
    from: requested.from,
    to: requested.to,
    date: requested.date,
    departTime: departure.time,
    arriveTime: arrival.time,
    crossDay: arrival.date > departure.date,
    duration: Math.max(1, Math.round(option.totalDuration)),
    price: Math.round(option.totalPrice),
    airline: airline || '航空公司待确认',
    stops: Math.max(0, option.segments.length - 1),
    real: true
  }
  if (flightNo) leg.flightNo = flightNo
  return leg
}

function searchInputFor(leg: RouteLeg): FlightSearchInput {
  return {
    origin: leg.from,
    destination: leg.to,
    originCandidates: [leg.from],
    destinationCandidates: [leg.to],
    departDate: leg.date,
    currency: 'CNY'
  }
}

async function probeLeg(client: RoutePlanFlightClient, leg: RouteLeg): Promise<RouteLeg | null> {
  const input = searchInputFor(leg)
  const release = await providerSemaphore.acquire()
  try {
    const response = await client.searchFlights({
      origin: input.origin,
      destination: input.destination,
      departDate: input.departDate,
      currency: input.currency
    })
    const options = itinerariesFromSerpResponse(response, input, leg.date)
      .filter(option => option.segments[0]?.origin === leg.from
        && option.segments[option.segments.length - 1]?.destination === leg.to
        && timeParts(option.segments[0]?.departTime ?? '')?.date === leg.date)
      .sort((left, right) => left.totalPrice - right.totalPrice)
    const cheapest = options[0]
    return cheapest ? mapOptionToRouteLeg(cheapest, leg) : null
  } finally {
    release()
  }
}

function lodgingFor(route: RoutePick['route']): number {
  if (route.nightsSaved <= 0) return 0
  const deduction = route.totalPrice - route.effCost
  if (deduction <= 0) return 0
  return deduction / route.nightsSaved
}

function confirmedPick(
  pick: RoutePick,
  probedLegs: Array<RouteLeg | null>,
  noteOverride?: string
): ConfirmedPick {
  const legs = pick.route.legs.map((leg, index) => {
    const probed = probedLegs[index]
    return probed ?? { ...leg, real: false }
  })
  const probed = legs.filter(leg => leg.real === true).length
  const failed = legs.length - probed
  const totalPrice = legs.reduce((sum, leg) => sum + leg.price, 0)
  const nightsSaved = legs.filter(isNightLeg).length
  const lodging = lodgingFor(pick.route)
  const effCost = Math.max(0, Math.round(totalPrice - nightsSaved * lodging))
  const route = {
    ...pick.route,
    legs,
    totalPrice,
    effCost,
    nightsSaved,
    hasReal: probed > 0
  }
  return {
    ...pick,
    route,
    probed,
    failed,
    note: noteOverride ?? (failed > 0
      ? `其中 ${failed} 段为估算价（探测失败）`
      : '全部航段为实时报价')
  }
}

/** Confirm all selected routes with a global two-request concurrency limit. */
export async function confirmRoutePicks(
  picks: RoutePick[],
  client: RoutePlanFlightClient,
  options: ConfirmRouteOptions = {}
): Promise<ConfirmedPick[]> {
  const hasKey = options.hasKey ?? true
  if (!hasKey) {
    return picks.map(pick => confirmedPick(pick, [], '当前为估算价（未配置 SerpApi）'))
  }

  const probed: Array<Array<RouteLeg | null>> = picks.map(pick => pick.route.legs.map(() => null))
  const tasks: Array<{ pickIndex: number; legIndex: number; leg: RouteLeg }> = []
  picks.forEach((pick, pickIndex) => {
    // The request schema caps this at eight.  Keep the guard here as this
    // function is also useful in isolated tests and internal callers.
    pick.route.legs.slice(0, 8).forEach((leg, legIndex) => tasks.push({ pickIndex, legIndex, leg }))
  })
  let cursor = 0
  const requestedConcurrency = options.concurrency ?? GLOBAL_PROVIDER_CONCURRENCY
  const boundedConcurrency = Number.isFinite(requestedConcurrency)
    ? Math.floor(requestedConcurrency)
    : GLOBAL_PROVIDER_CONCURRENCY
  const concurrency = Math.max(1, Math.min(GLOBAL_PROVIDER_CONCURRENCY, boundedConcurrency, tasks.length || 1))
  const worker = async () => {
    while (cursor < tasks.length) {
      const index = cursor
      cursor += 1
      const task = tasks[index]
      if (!task) continue
      try {
        probed[task.pickIndex]![task.legIndex] = await probeLeg(client, task.leg)
      } catch {
        // A single provider failure is intentionally represented by null; the
        // estimate remains in the route and the response reports failed count.
        probed[task.pickIndex]![task.legIndex] = null
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()))
  return picks.map((pick, index) => confirmedPick(pick, probed[index] ?? []))
}

/** Confirm one pick; kept as a small compatibility helper for unit tests. */
export async function confirmPickRoute(
  pick: RoutePick,
  client: RoutePlanFlightClient,
  options: ConfirmRouteOptions = {}
): Promise<ConfirmedPick> {
  const [confirmed] = await confirmRoutePicks([pick], client, options)
  return confirmed ?? confirmedPick(pick, [])
}
