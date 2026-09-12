import type { FastifyInstance } from 'fastify'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { AppContext } from '../app/context.js'
import { PostgresArtifactRepository } from '../artifacts/postgres.js'
import type { ArtifactRepository } from '../artifacts/repository.js'
import { createArtifactWorkspace } from '../artifacts/workspace.js'
import { authenticateRequest } from '../auth/service.js'
import { PostgresConversationRepository } from '../conversations/postgres.js'
import type { ConversationRepository } from '../conversations/repository.js'
import {
  executeFlexibleFlightSearch,
  executeFlightSearch,
  type FlexibleFlightSearchArtifact
} from '../fares/search-service.js'
import type { FareProvider } from '../fares/providers/provider.js'
import type { FlightSearchArtifact } from '../fares/types.js'
import { summarizeFareItineraries } from '../fares/summary.js'
import { InMemoryFlightSearchIdempotencyStore } from '../fares/idempotency.js'
import { AppError } from '../lib/errors.js'
import { PostgresTripRepository } from '../trips/postgres.js'
import type { TripRepository } from '../trips/repository.js'

const iata = z.string().trim().regex(/^[A-Za-z]{3}$/).transform(value => value.toUpperCase())
export const manualFlightSearchSchema = z.object({
  tripId: z.string().uuid(),
  conversationId: z.string().uuid(),
  origin: iata,
  destination: iata,
  departureDate: z.iso.date(),
  departureDateTo: z.iso.date().optional(),
  returnDate: z.iso.date().optional(),
  currency: z.enum(['CNY', 'USD', 'EUR']).default('CNY'),
  travelClass: z.number().int().min(1).max(4).default(1)
}).strict().superRefine((input, context) => {
  if (input.origin === input.destination) {
    context.addIssue({ code: 'custom', message: 'Origin and destination must differ', path: ['destination'] })
  }
  if (input.departureDateTo) {
    const days = (Date.parse(`${input.departureDateTo}T00:00:00Z`) - Date.parse(`${input.departureDate}T00:00:00Z`)) / 86_400_000
    if (days < 0 || days > 30) {
      context.addIssue({ code: 'custom', message: 'Departure window must be between 1 and 31 calendar days', path: ['departureDateTo'] })
    }
  }
  if (input.returnDate && input.returnDate < (input.departureDateTo ?? input.departureDate)) {
    context.addIssue({ code: 'custom', message: 'Return date must not precede departure', path: ['returnDate'] })
  }
})

export interface ManualFlightSearchDependencies {
  trips: TripRepository
  conversations: ConversationRepository
  artifacts: ArtifactRepository
  fares: FareProvider
}

export interface ManualFlightSearchResponse {
  artifactRef: {
    id: string
    type: 'flight_search'
    schemaVersion: number
    presentationHint: 'flight_cards'
  }
  summary: ReturnType<typeof summary>
}

export type ManualFlightSearchIdempotencyStore = InMemoryFlightSearchIdempotencyStore<ManualFlightSearchResponse>

export type ManualFlightSearchDependenciesFactory = (trustedUserId: string) => ManualFlightSearchDependencies

function defaultFactory(context: AppContext): ManualFlightSearchDependenciesFactory {
  return userId => ({
    trips: new PostgresTripRepository(context.db, userId),
    conversations: new PostgresConversationRepository(context.db, userId),
    artifacts: new PostgresArtifactRepository(context.db, userId),
    fares: context.providers.fares
  })
}

function requiredIdempotencyKey(value: string | string[] | undefined): string {
  if (typeof value !== 'string') throw new AppError('IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required', 400)
  const key = value.trim()
  if (key.length === 0 || key.length > 200 || /[\u0000-\u001f\u007f]/u.test(key)) {
    throw new AppError('INVALID_IDEMPOTENCY_KEY', 'Idempotency-Key is malformed', 400)
  }
  return key
}

function requestHash(input: z.infer<typeof manualFlightSearchSchema>): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex')
}

function summary(payload: FlightSearchArtifact | FlexibleFlightSearchArtifact) {
  if ('offers' in payload) {
    const lowest = [...payload.offers].sort((left, right) => left.totalAmount - right.totalAmount)[0]
    return {
      origin: payload.query.origin,
      destination: payload.query.destination,
      departureDateFrom: payload.query.departureDate,
      departureDateTo: payload.query.departureDate,
      offerCount: payload.offers.length,
      itineraries: summarizeFareItineraries(payload.offers),
      ...(lowest ? { lowestFare: { amount: lowest.totalAmount, currency: lowest.currency } } : {}),
      checkedAt: payload.checkedAt,
      provider: payload.provider,
      verificationStatus: payload.verification.status,
      failedDates: [] as string[]
    }
  }
  const offers = payload.results.flatMap(result => result.offers)
  const lowest = [...offers].sort((left, right) => left.totalAmount - right.totalAmount)[0]
  const statuses = payload.results.map(result => result.verification.status)
  return {
    origin: payload.window.origin,
    destination: payload.window.destination,
    departureDateFrom: payload.window.departureDateFrom,
    departureDateTo: payload.window.departureDateTo,
    offerCount: offers.length,
    itineraries: summarizeFareItineraries(offers),
    ...(lowest ? { lowestFare: { amount: lowest.totalAmount, currency: lowest.currency } } : {}),
    checkedAt: payload.results.map(result => result.checkedAt).sort().at(-1) ?? new Date().toISOString(),
    provider: payload.results[0]?.provider ?? 'fare_provider',
    verificationStatus: statuses.includes('unverified')
      ? 'unverified'
      : statuses.includes('stale')
        ? 'stale'
        : payload.failedDates.length > 0 || statuses.some(status => status !== 'verified')
          ? 'partially_verified'
          : 'verified',
    failedDates: payload.failedDates
  }
}

export async function registerFlightSearchRoutes(
  app: FastifyInstance,
  context: AppContext,
  dependenciesForUser: ManualFlightSearchDependenciesFactory = defaultFactory(context),
  idempotency: ManualFlightSearchIdempotencyStore = new InMemoryFlightSearchIdempotencyStore<ManualFlightSearchResponse>()
): Promise<void> {
  app.post('/v1/flight-searches', {
    config: { rateLimit: { max: 12, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    const identity = await authenticateRequest(request, context)
    const input = manualFlightSearchSchema.parse(request.body)
    const idempotencyKey = requiredIdempotencyKey(request.headers['idempotency-key'])
    const dependencies = dependenciesForUser(identity.userId)
    const hash = requestHash(input)
    const result = await idempotency.run(identity.userId, idempotencyKey, hash, async () => {
      const [trip, conversation] = await Promise.all([
        dependencies.trips.getTrip(input.tripId),
        dependencies.conversations.get(input.conversationId)
      ])
      if (!trip || !conversation || conversation.tripId !== trip.id) {
        throw new AppError('RESOURCE_NOT_FOUND', 'Trip or conversation was not found', 404)
      }
      const abortController = new AbortController()
      request.raw.once('aborted', () => abortController.abort(new Error('Client disconnected')))
      const common = {
        fares: dependencies.fares,
        ...await createArtifactWorkspace({
          artifacts: dependencies.artifacts,
          trips: dependencies.trips,
          tripId: trip.id,
          conversationId: conversation.id,
          signal: abortController.signal
        }, trip.context)
      }
      const search = input.departureDateTo && input.departureDateTo !== input.departureDate
        ? await executeFlexibleFlightSearch({
          origin: input.origin,
          destination: input.destination,
          departureDateFrom: input.departureDate,
          departureDateTo: input.departureDateTo,
          ...(input.returnDate ? { returnDate: input.returnDate } : {}),
          currency: input.currency,
          travelClass: input.travelClass
        }, common)
        : await executeFlightSearch({
          origin: input.origin,
          destination: input.destination,
          departureDate: input.departureDate,
          ...(input.returnDate ? { returnDate: input.returnDate } : {}),
          currency: input.currency,
          travelClass: input.travelClass
        }, common)
      return {
        artifactRef: {
          id: search.record.id,
          type: 'flight_search' as const,
          schemaVersion: search.record.schemaVersion,
          presentationHint: 'flight_cards' as const
        },
        summary: summary(search.payload)
      }
    })
    return reply.header('Cache-Control', 'no-store').code(result.replayed ? 200 : 201).send(result.value)
  })
}
