import { z } from 'zod'
import { locationRefSchema, verificationRecordSchema } from '../aviation/types.js'
import { temporalEvidenceSchema } from './temporal-evidence.js'

export const RESEARCH_TYPE_DESCRIPTION = 'activity: a place to visit, meal or experience; practical: factual logistics such as transport, booking or visitor passes; event: a dated exhibition or festival; seasonal: a seasonal condition; stopover: an airport layover experience. Classify by the evidence, not by which category is easiest to fill.'
export const researchTypeSchema = z.enum(['event', 'seasonal', 'activity', 'stopover', 'practical']).describe(RESEARCH_TYPE_DESCRIPTION)

export const researchBriefSchema = z.object({
  destinations: z.array(locationRefSchema).min(1).max(12),
  travelWindow: z.object({ from: z.iso.date().optional(), to: z.iso.date().optional() }).strict().optional(),
  interests: z.array(z.string().trim().min(1).max(80)).max(32),
  questions: z.array(z.string().trim().min(1).max(500)).min(1).max(24),
  researchTypes: z.array(researchTypeSchema).min(1).max(5),
  maxResults: z.number().int().min(1).max(50).optional()
}).strict()

export type ResearchBrief = z.infer<typeof researchBriefSchema>

export const legacyResearchArtifactSchema = z.object({
  id: z.string().min(1),
  type: z.literal('research'),
  schemaVersion: z.literal(1),
  brief: researchBriefSchema,
  findings: z.array(z.object({
    title: z.string().min(1),
    summary: z.string().min(1),
    sourceUrls: z.array(z.url()).max(20),
    verifiedAt: z.iso.datetime(),
    confidence: z.enum(['confirmed', 'partial', 'unconfirmed'])
  }).strict()).max(50),
  createdAt: z.iso.datetime()
}).strict()

export type LegacyResearchArtifact = z.infer<typeof legacyResearchArtifactSchema>

export const researchSourceAuthoritySchema = z.enum([
  'official_event',
  'official_organizer',
  'government_tourism',
  'official_venue',
  'reliable_media',
  'travel_site',
  'unknown'
])

export const researchSourceSchema = z.object({
  title: z.string().min(1).max(240),
  url: z.url().max(500),
  domain: z.string().min(1).max(253),
  snippet: z.string().min(1).max(800),
  authority: researchSourceAuthoritySchema,
  publishedAt: z.iso.datetime().optional()
}).strict()

export const researchFindingSchema = z.object({
  id: z.string().min(1).max(160),
  category: researchTypeSchema,
  destinations: z.array(locationRefSchema).min(1).max(12),
  title: z.string().min(1).max(240),
  summary: z.string().min(1).max(1_500),
  temporalEvidence: temporalEvidenceSchema.optional(),
  sources: z.array(researchSourceSchema).min(1).max(20),
  verification: verificationRecordSchema,
  warnings: z.array(z.string().min(1).max(240)).max(20)
}).strict()

export const researchArtifactSchema = z.object({
  id: z.string().min(1).max(160),
  type: z.literal('research'),
  schemaVersion: z.literal(2),
  brief: researchBriefSchema,
  findings: z.array(researchFindingSchema).max(50),
  queryCount: z.number().int().nonnegative().max(24),
  /** Optional v2 additions: absent fields preserve artifacts written before native research. */
  disposition: z.enum(['recommend', 'partial', 'clarify']).optional(),
  uncertainties: z.array(z.string().trim().min(1).max(240)).max(24).optional(),
  /** Opaque server-side generation audit reference; raw provider data stays out of the Artifact. */
  generationAuditId: z.string().uuid().optional(),
  warnings: z.array(z.string().min(1).max(240)).max(40),
  createdAt: z.iso.datetime()
}).strict()

export type ResearchArtifact = z.infer<typeof researchArtifactSchema>

export const readableResearchArtifactSchema = z.union([
  researchArtifactSchema,
  legacyResearchArtifactSchema
])

export type ReadableResearchArtifact = z.infer<typeof readableResearchArtifactSchema>

export interface ResearchExecutionContext {
  requestId: string
  signal?: AbortSignal
  preferenceSummary?: readonly string[]
  /** Trusted workspace facts for audit attribution only; never model context. */
  ownerId?: string
  tripId?: string
  conversationId?: string
  goalId?: string
  runId?: string
  tripContextVersion?: number
}

export interface ResearchAgent {
  research(brief: ResearchBrief, context: ResearchExecutionContext): Promise<ResearchArtifact>
}
