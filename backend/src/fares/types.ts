import { z } from 'zod'
import { verificationRecordSchema } from '../aviation/types.js'

export const fareSearchInputSchema = z.object({
  origin: z.string().regex(/^[A-Z]{3}$/),
  destination: z.string().regex(/^[A-Z]{3}$/),
  departureDate: z.iso.date(),
  returnDate: z.iso.date().optional(),
  currency: z.enum(['CNY', 'USD', 'EUR']).default('CNY'),
  travelClass: z.number().int().min(1).max(4).default(1)
}).strict().superRefine((input, context) => {
  if (input.origin === input.destination) {
    context.addIssue({ code: 'custom', message: 'Origin and destination must differ', path: ['destination'] })
  }
  if (input.returnDate && input.returnDate < input.departureDate) {
    context.addIssue({ code: 'custom', message: 'Return date must not precede departure', path: ['returnDate'] })
  }
})

export type FareSearchInput = z.infer<typeof fareSearchInputSchema>

export const fareSegmentSchema = z.object({
  flightNumber: z.string().max(32),
  airline: z.string().max(160),
  origin: z.string().regex(/^[A-Z]{3}$/),
  destination: z.string().regex(/^[A-Z]{3}$/),
  departsAt: z.string().min(1).max(64),
  arrivesAt: z.string().min(1).max(64),
  durationMinutes: z.number().int().nonnegative(),
  aircraft: z.string().max(160).optional()
}).strict()

export const fareOfferSchema = z.object({
  id: z.string().min(1).max(240),
  segments: z.array(fareSegmentSchema).min(1).max(12),
  totalAmount: z.number().finite().nonnegative(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  totalDurationMinutes: z.number().int().nonnegative(),
  airlines: z.array(z.string().min(1).max(160)).max(12),
  transferType: z.enum(['direct', 'airline', 'self']),
  protectedConnection: z.boolean().optional(),
  baggageRecheck: z.boolean().optional(),
  bookingUrl: z.string().url().optional()
}).strict()

export type FareOffer = z.infer<typeof fareOfferSchema>

export const fareSearchResultSchema = z.object({
  query: fareSearchInputSchema,
  offers: z.array(fareOfferSchema).max(100),
  provider: z.string().min(1).max(64),
  checkedAt: z.iso.datetime(),
  verification: verificationRecordSchema
}).strict()

export type FareSearchResult = z.infer<typeof fareSearchResultSchema>

export const flightSearchArtifactSchema = fareSearchResultSchema.extend({
  id: z.string().min(1).max(160),
  type: z.literal('flight_search')
}).strict()

export type FlightSearchArtifact = z.infer<typeof flightSearchArtifactSchema>
