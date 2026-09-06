import type { TripContext, TripContextPatch } from './types.js'
import { emptyTripContext, tripContextSchema } from './types.js'
import { v7 as uuidv7 } from 'uuid'
import { AppError } from '../lib/errors.js'

export class TripContextVersionConflict extends AppError {
  constructor(readonly expectedVersion: number, readonly actualVersion: number) {
    super('TRIP_CONTEXT_VERSION_CONFLICT', `Trip context version conflict: expected ${expectedVersion}, got ${actualVersion}`, 409, {
      expectedVersion, actualVersion
    })
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

export function applyTripContextPatch(current: TripContext, patch: TripContextPatch): TripContext {
  const next = structuredClone(current)
  for (const [key, value] of Object.entries(patch) as Array<[keyof TripContextPatch, TripContextPatch[keyof TripContextPatch]]>) {
    if (value === undefined) continue
    if (value === null) delete (next as Record<string, unknown>)[key]
    else (next as Record<string, unknown>)[key] = structuredClone(value)
  }
  next.version = current.version + 1
  return next
}

export type TripStatus = 'planning' | 'generated' | 'archived'

export interface Trip {
  id: string
  title: string
  status: TripStatus
  currentContextVersion: number
  context: TripContext
  createdAt: string
  updatedAt: string
}

export interface CreateTripInput {
  title?: string
  initialContext?: TripContextPatch
}

export interface TripRepository extends TripContextRepository {
  create(input?: CreateTripInput): Promise<Trip>
  getTrip(tripId: string): Promise<Trip | undefined>
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
    const next = applyTripContextPatch(current, patch)
    if (guard?.signal?.aborted || guard?.isCurrent?.() === false) throw new Error('TRIP_CONTEXT_UPDATE_CANCELLED')
    this.trips.set(tripId, next)
    return structuredClone(next)
  }
}

export class InMemoryTripRepository implements TripRepository {
  private readonly trips = new Map<string, Trip>()

  constructor(initial: readonly Trip[] = []) {
    for (const trip of initial) this.trips.set(trip.id, structuredClone(trip))
  }

  async create(input: CreateTripInput = {}): Promise<Trip> {
    const id = uuidv7()
    const now = new Date().toISOString()
    const base = emptyTripContext(id)
    const context = input.initialContext && Object.keys(input.initialContext).length > 0
      ? applyTripContextPatch({ ...base, version: -1 }, input.initialContext)
      : base
    const trip: Trip = {
      id,
      title: input.title ?? '',
      status: 'planning',
      currentContextVersion: context.version,
      context: tripContextSchema.parse(context),
      createdAt: now,
      updatedAt: now
    }
    this.trips.set(id, trip)
    return structuredClone(trip)
  }

  async getTrip(tripId: string): Promise<Trip | undefined> {
    const trip = this.trips.get(tripId)
    return trip ? structuredClone(trip) : undefined
  }

  async get(tripId: string): Promise<TripContext | undefined> {
    return (await this.getTrip(tripId))?.context
  }

  async update(
    tripId: string,
    patch: TripContextPatch,
    expectedVersion?: number,
    guard?: { signal?: AbortSignal; isCurrent?: () => boolean }
  ): Promise<TripContext> {
    if (guard?.signal?.aborted || guard?.isCurrent?.() === false) throw new Error('TRIP_CONTEXT_UPDATE_CANCELLED')
    const trip = this.trips.get(tripId)
    if (!trip) throw new Error('TRIP_CONTEXT_NOT_FOUND')
    if (expectedVersion !== undefined && expectedVersion !== trip.context.version) {
      throw new TripContextVersionConflict(expectedVersion, trip.context.version)
    }
    const context = tripContextSchema.parse(applyTripContextPatch(trip.context, patch))
    if (guard?.signal?.aborted || guard?.isCurrent?.() === false) throw new Error('TRIP_CONTEXT_UPDATE_CANCELLED')
    trip.context = context
    trip.currentContextVersion = context.version
    trip.updatedAt = new Date().toISOString()
    return structuredClone(context)
  }
}
