import { z } from 'zod'
import { locationRefSchema } from '../aviation/types.js'

export const researchBriefSchema = z.object({
  destinations: z.array(locationRefSchema).min(1).max(12),
  travelWindow: z.object({ from: z.iso.date().optional(), to: z.iso.date().optional() }).strict().optional(),
  interests: z.array(z.string().trim().min(1).max(80)).max(32),
  questions: z.array(z.string().trim().min(1).max(500)).min(1).max(24),
  researchTypes: z.array(z.enum(['event', 'seasonal', 'activity', 'stopover', 'practical'])).min(1).max(5),
  maxResults: z.number().int().min(1).max(50).optional()
}).strict()

export type ResearchBrief = z.infer<typeof researchBriefSchema>

export const researchArtifactSchema = z.object({
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

export type ResearchArtifact = z.infer<typeof researchArtifactSchema>

export interface ResearchExecutionContext {
  requestId: string
  signal?: AbortSignal
}

export interface ResearchAgent {
  research(brief: ResearchBrief, context: ResearchExecutionContext): Promise<ResearchArtifact>
}
