import { z } from 'zod'
import { locationRefSchema, verificationRecordSchema } from '../aviation/types.js'

const boundedString = (max: number) => z.string().min(1).max(max)
const MAX_WINDOW_DAYS = 366
const dateWindowSchema = z.object({ from: z.iso.date(), to: z.iso.date() }).strict().superRefine((value, context) => {
  const span = (Date.parse(`${value.to}T00:00:00Z`) - Date.parse(`${value.from}T00:00:00Z`)) / 86_400_000
  if (value.to < value.from) context.addIssue({ code: 'custom', message: 'Window end must not precede start', path: ['to'] })
  if (span > MAX_WINDOW_DAYS) context.addIssue({ code: 'custom', message: `Window must not exceed ${MAX_WINDOW_DAYS} days`, path: ['to'] })
})

export const topologySnapshotSchema = z.object({
  id: boundedString(160),
  coverage: z.enum(['complete', 'partial', 'unknown']),
  activatedAt: z.iso.datetime().optional(),
  verification: verificationRecordSchema
}).strict()
export type TopologySnapshot = z.infer<typeof topologySnapshotSchema>

export const topologySegmentSchema = z.object({
  id: boundedString(160), from: locationRefSchema, to: locationRefSchema,
  serviceDate: z.iso.date().optional(),
  departureAt: z.iso.datetime({ offset: true }).optional(),
  arrivalAt: z.iso.datetime({ offset: true }).optional(),
  durationMinutes: z.number().int().nonnegative().max(100000).optional(),
  marketingCarrier: boundedString(80).optional(), operatingCarrier: boundedString(80).optional(),
  flightNumber: boundedString(32).optional(),
  verification: verificationRecordSchema
}).strict()
export type TopologySegment = z.infer<typeof topologySegmentSchema>

export const topologyCandidateSchema = z.object({
  id: boundedString(160), origin: locationRefSchema, destination: locationRefSchema,
  segments: z.array(topologySegmentSchema).min(1).max(3),
  transferMinutes: z.array(z.number().int().nonnegative().max(100000)).max(2),
  transferType: z.enum(['direct', 'protected', 'self']),
  airportChange: z.boolean().optional(),
  totalDurationMinutes: z.number().int().nonnegative().max(500000).optional(),
  verification: verificationRecordSchema,
  warnings: z.array(boundedString(200)).max(50)
}).strict()
export type TopologyCandidate = z.infer<typeof topologyCandidateSchema>

export const topologyQueryInputSchema = z.object({
  origin: locationRefSchema, destination: locationRefSchema,
  window: dateWindowSchema,
  preferredLocations: z.array(locationRefSchema).max(24).default([]),
  excludedLocations: z.array(locationRefSchema).max(24).default([]),
  acceptsSelfTransfer: z.boolean().default(false),
  acceptsLongStopover: z.boolean().default(false),
  maxTransfers: z.number().int().min(0).max(2).default(2),
  limit: z.number().int().min(1).max(500).default(100)
}).strict()
export type TopologyQueryInput = z.infer<typeof topologyQueryInputSchema>

export const topologyQueryResultSchema = z.object({
  snapshot: topologySnapshotSchema.optional(),
  coverageStatus: z.enum(['reachable', 'unreachable', 'unknown']),
  candidates: z.array(topologyCandidateSchema).max(500),
  warnings: z.array(boundedString(200)).max(50),
  truncated: z.boolean(), exhausted: z.boolean()
}).strict()
export type TopologyQueryResult = z.infer<typeof topologyQueryResultSchema>

export interface TopologyRepository {
  findCandidates(input: TopologyQueryInput, options?: { signal?: AbortSignal }): Promise<TopologyQueryResult>
}
