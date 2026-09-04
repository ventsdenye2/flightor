import { z } from 'zod'
import type { DestinationInterest, DestinationRegion } from '../destinations/catalog.js'

/**
 * The conversation protocol is deliberately independent from the older
 * `/v1/agent/chat` slot shape.  State is sent back by the client on every
 * request, so these schemas are also the boundary that prevents unknown
 * fields from becoming an accidental hidden state channel.
 */

const iataSchema = z.string()
  .trim()
  .regex(/^[A-Z]{3}$/, 'IATA must be three uppercase letters')

const originSchema = z.string().trim().min(1).max(64)

const destinationInterestSchema = z.enum(['culture', 'food', 'nature', 'shopping', 'nightlife']) as z.ZodType<DestinationInterest>

const destinationRegionSchema = z.enum(['japan', 'schengen', 'visa_free']) as z.ZodType<DestinationRegion>

export const tripStateSchema = z.object({
  origin: originSchema.nullable(),
  window_from: z.iso.date().nullable(),
  window_to: z.iso.date().nullable(),
  travel_days: z.number().int().min(1).max(60).nullable(),
  budget_max: z.number().finite().min(0).max(100_000_000).nullable(),
  interests: z.array(destinationInterestSchema).max(12),
  regions: z.array(destinationRegionSchema).max(12),
  required_iatas: z.array(iataSchema).max(12),
  excluded_iatas: z.array(iataSchema).max(12),
  destination_mode: z.enum(['explicit', 'recommend']),
  pace: z.enum(['relaxed', 'balanced', 'many_cities']),
  priorities: z.array(z.enum(['budget', 'comfort', 'few_transfers', 'culture'])).max(4)
}).strict()

export const conversationMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().trim().min(1).max(1_000)
}).strict()

export const converseRequestSchema = z.object({
  messages: z.array(conversationMessageSchema).min(1).max(24),
  state: tripStateSchema.optional(),
  today: z.iso.date().optional(),
  newTrip: z.boolean().optional()
}).strict().refine(
  value => value.messages.some(message => message.role === 'user'),
  { message: 'At least one user message is required', path: ['messages'] }
)

export const conversationRequestSchema = converseRequestSchema

export type TripState = z.infer<typeof tripStateSchema>
export type ConversationMessage = z.infer<typeof conversationMessageSchema>
export type ConverseRequest = z.infer<typeof converseRequestSchema>

export const emptyTripState = (): TripState => ({
  origin: null,
  window_from: null,
  window_to: null,
  travel_days: null,
  budget_max: null,
  interests: [],
  regions: [],
  required_iatas: [],
  excluded_iatas: [],
  destination_mode: 'explicit',
  pace: 'balanced',
  priorities: []
})
