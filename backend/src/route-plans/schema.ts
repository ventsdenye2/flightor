import { z } from 'zod'

const iataPattern = /^[A-Z]{3}$/
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/

/**
 * Keep this allowlist local to the request boundary.  Importing the planner
 * engine here would make the schema depend on the search implementation and
 * makes it too easy to accidentally widen the accepted IATA surface.
 */
export const ROUTE_PLAN_IATA_ALLOWLIST = [
  'CDG', 'AMS', 'FRA', 'MUC', 'ZRH', 'VIE', 'PRG', 'FCO', 'MXP', 'BCN', 'MAD', 'LIS', 'ATH', 'BUD', 'CPH', 'HEL',
  'BKK', 'KUL', 'SIN', 'HAN', 'SGN', 'DPS', 'BEG', 'IST', 'CJU',
  'NRT', 'HND', 'KIX',
  'SZX', 'CAN', 'PVG', 'PEK', 'CTU', 'HKG'
] as const
const routePlanIataSet = new Set<string>(ROUTE_PLAN_IATA_ALLOWLIST)

export const iataSchema = z.string()
  .regex(iataPattern, 'IATA must be three uppercase letters')
  .refine(value => routePlanIataSet.has(value), 'IATA is not supported by route planner')
export const isoDateSchema = z.iso.date()
export const hhmmSchema = z.string().regex(timePattern, 'Time must use HH:mm')

export const routePlanRequestSchema = z.object({
  text: z.string().trim().min(1).max(1_000),
  today: isoDateSchema.optional()
}).strict()

export const routeLegSchema = z.object({
  from: iataSchema,
  to: iataSchema,
  date: isoDateSchema,
  departTime: hhmmSchema,
  arriveTime: hhmmSchema,
  crossDay: z.boolean(),
  duration: z.number().int().min(1).max(3_000),
  price: z.number().int().min(1).max(1_000_000),
  airline: z.string().trim().min(1).max(120),
  flightNo: z.string().trim().min(1).max(120).optional(),
  stops: z.number().int().min(0).max(20).optional(),
  real: z.boolean().optional()
}).strict().superRefine((leg, ctx) => {
  if (leg.from === leg.to) {
    ctx.addIssue({ code: 'custom', message: 'A route leg must have different endpoints', path: ['to'] })
  }
})

export const routeResultSchema = z.object({
  cities: z.array(iataSchema).min(1).max(7),
  citySeq: z.array(iataSchema).min(2).max(9),
  legs: z.array(routeLegSchema).min(1).max(8),
  totalPrice: z.number().int().min(1).max(8_000_000),
  effCost: z.number().int().min(0).max(8_000_000),
  nightsSaved: z.number().int().min(0).max(8),
  hasReal: z.boolean().optional()
}).strict().superRefine((route, ctx) => {
  if (route.citySeq.length !== route.cities.length + 2) {
    ctx.addIssue({ code: 'custom', message: 'citySeq must contain origin, each city, and origin', path: ['citySeq'] })
  }
  if (route.legs.length !== route.citySeq.length - 1) {
    ctx.addIssue({ code: 'custom', message: 'legs must connect every citySeq pair', path: ['legs'] })
  }
  const first = route.citySeq[0]
  const last = route.citySeq[route.citySeq.length - 1]
  if (first !== undefined && first !== last) {
    ctx.addIssue({ code: 'custom', message: 'citySeq must start and end at the same origin', path: ['citySeq'] })
  }
  if (new Set(route.cities).size !== route.cities.length) {
    ctx.addIssue({ code: 'custom', message: 'cities must not contain duplicates', path: ['cities'] })
  }
  for (let index = 0; index < route.cities.length; index += 1) {
    if (route.citySeq[index + 1] !== route.cities[index]) {
      ctx.addIssue({ code: 'custom', message: 'citySeq interior must match cities', path: ['citySeq', index + 1] })
    }
  }
  for (let index = 0; index < route.legs.length; index += 1) {
    const leg = route.legs[index]
    if (!leg) continue
    if (leg.from !== route.citySeq[index] || leg.to !== route.citySeq[index + 1]) {
      ctx.addIssue({ code: 'custom', message: 'Leg endpoints must follow citySeq', path: ['legs', index] })
    }
  }
  if (route.nightsSaved > route.legs.length) {
    ctx.addIssue({ code: 'custom', message: 'nightsSaved cannot exceed the number of legs', path: ['nightsSaved'] })
  }
})

export const routePickSchema = z.object({
  kind: z.enum(['cheapest', 'mostCities', 'mostNights']),
  route: routeResultSchema
}).strict()

export const routePlanConfirmRequestSchema = z.object({
  picks: z.array(routePickSchema).min(1).max(3)
}).strict().superRefine((request, ctx) => {
  const totalLegs = request.picks.reduce((sum, pick) => sum + pick.route.legs.length, 0)
  if (totalLegs > 8) {
    ctx.addIssue({
      code: 'custom',
      message: 'A confirmation request may contain at most 8 legs in total',
      path: ['picks']
    })
  }
})

export type RoutePlanRequest = z.infer<typeof routePlanRequestSchema>
export type RoutePlanConfirmRequest = z.infer<typeof routePlanConfirmRequestSchema>
