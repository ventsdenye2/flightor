import type { TripContext, TripContextPatch } from './types.js'

export class TripContextVersionConflict extends Error {
  readonly code = 'TRIP_CONTEXT_VERSION_CONFLICT'

  constructor(readonly expectedVersion: number, readonly actualVersion: number) {
    super(`Trip context version conflict: expected ${expectedVersion}, got ${actualVersion}`)
    this.name = 'TripContextVersionConflict'
  }
}

export interface TripContextRepository {
  get(tripId: string): Promise<TripContext | undefined>
  update(
    tripId: string,
    patch: TripContextPatch,
    expectedVersion?: number,
    guard?: { signal?: AbortSignal; isCurrent?: () => boolean }
  ): Promise<TripContext>
}

function applyPatch(current: TripContext, patch: TripContextPatch): TripContext {
  const next = structuredClone(current)
  for (const [key, value] of Object.entries(patch) as Array<[keyof TripContextPatch, TripContextPatch[keyof TripContextPatch]]>) {
    if (value === undefined) continue
    if (value === null) delete (next as Record<string, unknown>)[key]
    else (next as Record<string, unknown>)[key] = structuredClone(value)
  }
  next.version = current.version + 1
  return next
}

export class InMemoryTripContextRepository implements TripContextRepository {
  private readonly trips = new Map<string, TripContext>()

  constructor(initial: readonly TripContext[] = []) {
    for (const trip of initial) this.trips.set(trip.id, structuredClone(trip))
  }

  async get(tripId: string): Promise<TripContext | undefined> {
    const value = this.trips.get(tripId)
    return value ? structuredClone(value) : undefined
  }

  async update(
    tripId: string,
    patch: TripContextPatch,
    expectedVersion?: number,
    guard?: { signal?: AbortSignal; isCurrent?: () => boolean }
  ): Promise<TripContext> {
    if (guard?.signal?.aborted || guard?.isCurrent?.() === false) throw new Error('TRIP_CONTEXT_UPDATE_CANCELLED')
    const current = this.trips.get(tripId)
    if (!current) throw new Error('TRIP_CONTEXT_NOT_FOUND')
    if (expectedVersion !== undefined && expectedVersion !== current.version) {
      throw new TripContextVersionConflict(expectedVersion, current.version)
    }
    const next = applyPatch(current, patch)
    if (guard?.signal?.aborted || guard?.isCurrent?.() === false) throw new Error('TRIP_CONTEXT_UPDATE_CANCELLED')
    this.trips.set(tripId, next)
    return structuredClone(next)
  }
}
