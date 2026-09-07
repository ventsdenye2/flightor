import { z } from 'zod'
import { locationRefSchema, verificationRecordSchema } from '../aviation/types.js'
import { destinationCandidateSchema } from '../destinations/types.js'
import { tripContextSchema } from '../trips/types.js'

const activityRefSchema = z.object({
  id: z.string().min(1).max(160),
  title: z.string().min(1).max(240),
  reason: z.literal('user_requested')
}).strict()

export const tripRoutePlanInputSchema = z.object({
  candidates: z.array(destinationCandidateSchema).min(1).max(50),
  tripContext: tripContextSchema,
  maxCities: z.number().int().min(1).max(12).default(6)
}).strict()

export type TripRoutePlanInput = z.infer<typeof tripRoutePlanInputSchema>

export const tripRouteCitySchema = z.object({
  location: locationRefSchema,
  stayDays: z.number().int().min(1).max(60),
  role: z.literal('visit'),
  reasons: z.array(z.string().min(1).max(240)).max(12)
}).strict()

export const tripRouteDaySchema = z.object({
  day: z.number().int().min(1).max(60),
  city: locationRefSchema,
  activityRefs: z.array(activityRefSchema).max(32)
}).strict()

export const tripRouteLandTransferSchema = z.object({
  from: locationRefSchema,
  to: locationRefSchema,
  mode: z.enum(['rail', 'road', 'ferry', 'unknown']),
  durationMinutes: z.number().int().positive().max(10_000).optional(),
  verification: verificationRecordSchema
}).strict()

export const tripRoutePlanResultSchema = z.object({
  plannerVersion: z.string().min(1).max(64),
  cities: z.array(tripRouteCitySchema).min(1).max(12),
  days: z.array(tripRouteDaySchema).min(1).max(60),
  stopoverOnly: z.array(locationRefSchema).max(24),
  landTransfers: z.array(tripRouteLandTransferSchema).max(24),
  unassignedActivityRefs: z.array(activityRefSchema).max(32),
  verification: verificationRecordSchema,
  warnings: z.array(z.string().min(1).max(240)).max(30)
}).strict()

export type TripRoutePlanResult = z.infer<typeof tripRoutePlanResultSchema>

export const tripRoutePlanPayloadSchema = tripRoutePlanResultSchema.extend({
  kind: z.literal('trip_route_plan'),
  schemaVersion: z.literal(1),
  sourceArtifactIds: z.array(z.string().min(1).max(160)).min(1).max(20),
  tripContextVersion: z.number().int().nonnegative()
}).strict()

export type TripRoutePlanPayload = z.infer<typeof tripRoutePlanPayloadSchema>

export interface TripRoutePlannerContext {
  signal?: AbortSignal
}

export interface TripRoutePlanner {
  plan(input: TripRoutePlanInput, context?: TripRoutePlannerContext): Promise<TripRoutePlanResult>
}
