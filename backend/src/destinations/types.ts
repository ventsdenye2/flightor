import { z } from 'zod'
import { locationRefSchema, verificationRecordSchema } from '../aviation/types.js'

export const destinationRegionSchema = z.enum(['japan', 'schengen', 'visa_free'])
export const destinationInterestSchema = z.enum(['culture', 'food', 'nature', 'shopping', 'nightlife'])

export const destinationDiscoveryInputSchema = z.object({
  regions: z.array(destinationRegionSchema).max(3).default([]),
  interests: z.array(destinationInterestSchema).max(5).default([]),
  requiredIatas: z.array(z.string().regex(/^[A-Z]{3}$/)).max(24).default([]),
  preferredIatas: z.array(z.string().regex(/^[A-Z]{3}$/)).max(24).default([]),
  excludedIatas: z.array(z.string().regex(/^[A-Z]{3}$/)).max(24).default([]),
  origin: locationRefSchema.optional(),
  limit: z.number().int().min(1).max(50).default(8)
}).strict()

export type DestinationDiscoveryInput = z.infer<typeof destinationDiscoveryInputSchema>

export const destinationCandidateSchema = z.object({
  location: locationRefSchema,
  cityZh: z.string().min(1).max(160),
  cityEn: z.string().min(1).max(160),
  region: destinationRegionSchema,
  interests: z.array(destinationInterestSchema).max(5),
  minStayDays: z.number().int().min(1).max(60),
  costTier: z.number().int().min(1).max(4),
  score: z.number().finite().min(0).max(1),
  reasons: z.array(z.string().min(1).max(240)).max(12),
  accessibility: z.enum(['direct', 'unknown']),
  verification: verificationRecordSchema
}).strict()

export type DestinationCandidate = z.infer<typeof destinationCandidateSchema>

export const destinationDiscoveryResultSchema = z.object({
  candidates: z.array(destinationCandidateSchema).max(50),
  serviceVersion: z.string().min(1).max(64),
  verification: verificationRecordSchema,
  warnings: z.array(z.string().min(1).max(240)).max(30)
}).strict()

export type DestinationDiscoveryResult = z.infer<typeof destinationDiscoveryResultSchema>

export const destinationSetPayloadSchema = z.object({
  kind: z.enum(['destination_candidates', 'destination_recommendations']),
  schemaVersion: z.literal(1),
  serviceVersion: z.string().min(1).max(64),
  query: destinationDiscoveryInputSchema,
  candidates: z.array(destinationCandidateSchema).max(50),
  verification: verificationRecordSchema,
  warnings: z.array(z.string().min(1).max(240)).max(30)
}).strict()

export type DestinationSetPayload = z.infer<typeof destinationSetPayloadSchema>

export interface DestinationDiscoveryContext {
  signal?: AbortSignal
}

export interface DestinationDiscoveryService {
  discover(input: DestinationDiscoveryInput, context?: DestinationDiscoveryContext): Promise<DestinationDiscoveryResult>
}
