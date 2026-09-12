import { z } from 'zod'
import { locationRefSchema, verificationRecordSchema } from '../aviation/types.js'
import { readableResearchArtifactSchema } from '../research-agent/types.js'
import { tripRoutePlanPayloadSchema } from '../trip-planning/types.js'

export const travelGuideArtifactItemSchema = z.object({
  id: z.string().min(1).max(160),
  title: z.string().min(1).max(240),
  description: z.string().min(1).max(1_500),
  city: locationRefSchema,
  category: z.enum(['event', 'seasonal', 'activity', 'stopover', 'practical']),
  reason: z.enum(['user_requested', 'interest_match', 'event', 'seasonal', 'agent_recommended', 'stopover']),
  sourceArtifactId: z.string().min(1).max(160),
  sourceFindingId: z.string().min(1).max(160),
  verification: verificationRecordSchema,
  timeOfDay: z.enum(['morning', 'afternoon', 'evening', 'flexible']).optional(),
  planningNote: z.string().trim().min(1).max(500).optional()
}).strict()

export const travelGuideArtifactDaySchema = z.object({
  day: z.number().int().min(1).max(60),
  city: locationRefSchema,
  items: z.array(travelGuideArtifactItemSchema).max(6),
  theme: z.string().trim().min(1).max(160).optional(),
  notes: z.string().trim().min(1).max(500).optional(),
  kind: z.enum(['visit', 'rest', 'travel']).optional()
}).strict()

export const travelGuideBuildInputSchema = z.object({
  routeArtifactId: z.string().min(1).max(160),
  route: tripRoutePlanPayloadSchema,
  researchArtifacts: z.array(readableResearchArtifactSchema).max(20)
}).strict()

export type TravelGuideBuildInput = z.infer<typeof travelGuideBuildInputSchema>

export const travelGuideArtifactPayloadSchema = z.object({
  kind: z.literal('trip_travel_guide'),
  schemaVersion: z.literal(1),
  builderVersion: z.string().min(1).max(64),
  composition: z.literal('agent_authored').optional(),
  sourceArtifactIds: z.array(z.string().min(1).max(160)).min(1).max(30),
  routeArtifactId: z.string().min(1).max(160),
  days: z.array(travelGuideArtifactDaySchema).min(1).max(60),
  unassignedActivityRefs: z.array(z.object({
    id: z.string().min(1).max(160),
    title: z.string().min(1).max(240),
    reason: z.literal('user_requested')
  }).strict()).max(32),
  verification: verificationRecordSchema,
  warnings: z.array(z.string().min(1).max(240)).max(40),
  createdAt: z.iso.datetime()
}).strict()

export type TravelGuideArtifactPayload = z.infer<typeof travelGuideArtifactPayloadSchema>

export interface TravelGuideBuilderContext {
  signal?: AbortSignal
}

export interface TravelGuideBuilder {
  build(input: TravelGuideBuildInput, context?: TravelGuideBuilderContext): Promise<TravelGuideArtifactPayload>
}
