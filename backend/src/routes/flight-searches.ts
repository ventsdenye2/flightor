import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { AppContext } from '../app/context.js'
import { AppError } from '../lib/errors.js'
import {
  buildFlightSearchResponse,
  flightSearchCacheKey,
  itinerariesFromSerpResponse,
  returnDateFor,
  sampleDates,
  type FlightOption,
  type FlightSearchInput
} from '../search/serpapi.js'

const iata = z.string().trim().length(3).transform(value => value.toUpperCase())
const searchSchema = z.object({
  origin: iata,
  destination: iata,
  origin_candidates: z.array(iata).min(1).max(3).optional(),
  destination_candidates: z.array(iata).min(1).max(3).optional(),
  depart_date: z.iso.date(),
  depart_date_end: z.iso.date().optional(),
  stay_range: z.tuple([z.number().int().min(1).max(90), z.number().int().min(1).max(90)]).optional(),
  currency: z.enum(['CNY', 'USD']).default('CNY')
}).superRefine((input, ctx) => {
  if (input.origin === input.destination) {
    ctx.addIssue({ code: 'custom', message: 'Origin and destination must be different', path: ['destination'] })
  }
  if (input.depart_date_end) {
    const days = (Date.parse(`${input.depart_date_end}T00:00:00Z`) - Date.parse(`${input.depart_date}T00:00:00Z`)) / 86_400_000
    if (days < 0 || days > 30) {
      ctx.addIssue({ code: 'custom', message: 'Departure window must be between 1 and 31 days', path: ['depart_date_end'] })
    }
  }
  if (input.stay_range && input.stay_range[1] < input.stay_range[0]) {
    ctx.addIssue({ code: 'custom', message: 'Stay range maximum must not be below minimum', path: ['stay_range'] })
  }
})

export async function registerFlightSearchRoutes(app: FastifyInstance, context: AppContext): Promise<void> {
  app.post('/v1/flight-searches', async request => {
    const body = searchSchema.parse(request.body)
    const input: FlightSearchInput = {
      origin: body.origin,
      destination: body.destination,
      originCandidates: [...new Set(body.origin_candidates ?? [body.origin])],
      destinationCandidates: [...new Set(body.destination_candidates ?? [body.destination])],
      departDate: body.depart_date,
      departDateEnd: body.depart_date_end,
      stayRange: body.stay_range,
      currency: body.currency
    }
    const cacheKey = flightSearchCacheKey(input)
    try {
      const cached = await context.redis.get(cacheKey)
      if (cached) return JSON.parse(cached) as unknown
    } catch (error) {
      request.log.warn({ err: error }, 'Flight search cache read failed')
    }

    const dates = sampleDates(input.departDate, input.departDateEnd)
    const results = await Promise.allSettled(dates.map(async date => {
      const returnDate = returnDateFor(date, input.stayRange)
      const response = await context.providers.serpapi.searchFlights({
        origin: input.originCandidates.join(','),
        destination: input.destinationCandidates.join(','),
        departDate: date,
        ...(returnDate ? { returnDate } : {}),
        currency: input.currency
      })
      return itinerariesFromSerpResponse(response, input, date)
    }))
    const options: FlightOption[] = []
    const failedDates: string[] = []
    let firstError: unknown
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') options.push(...result.value)
      else {
        firstError ??= result.reason
        failedDates.push(dates[index]!)
      }
    })
    if (options.length === 0 && firstError) throw firstError
    if (options.length === 0) throw new AppError('NO_FLIGHT_OFFERS', 'No flight offers were returned', 404)

    const response = buildFlightSearchResponse(options, {
      dates,
      fetched: dates.length - failedDates.length,
      failedDates,
      cacheHit: false
    })
    try {
      await context.redis.set(cacheKey, JSON.stringify(response), 'EX', 600)
    } catch (error) {
      request.log.warn({ err: error }, 'Flight search cache write failed')
    }
    return response
  })
}
