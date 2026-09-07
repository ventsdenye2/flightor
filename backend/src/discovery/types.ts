import { z } from 'zod'
import { locationRefSchema, verificationRecordSchema } from '../aviation/types.js'

export const contentTypeSchema = z.enum(['event', 'seasonal', 'theme', 'stopover', 'deal'])
export const candidateStatusSchema = z.enum(['candidate', 'draft', 'review', 'published', 'stale', 'expired', 'archived'])
const safeUrl = z.url().max(500).refine(value => {
  const url = new URL(value)
  return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
}, 'Source URLs must use HTTP(S) without embedded credentials')
export const templateFactSchema = z.object({
  id: z.string().min(1).max(160), statement: z.string().trim().min(1).max(1500),
  sourceUrls: z.array(safeUrl).min(1).max(20), verification: verificationRecordSchema
}).strict()
export const tripTemplateSchema = z.object({
  title: z.string().trim().min(1).max(200), summary: z.string().trim().min(1).max(1500),
  category: contentTypeSchema, routeConcept: z.string().trim().min(1).max(1500),
  anchorDestinations: z.array(locationRefSchema).min(1).max(12),
  optionalDestinations: z.array(locationRefSchema).max(12),
  recommendedStopovers: z.array(locationRefSchema).max(12),
  suggestedDays: z.number().int().min(1).max(60),
  interests: z.array(z.string().trim().min(1).max(80)).max(20),
  experienceGoals: z.array(z.string().trim().min(1).max(240)).max(12),
  validFrom: z.iso.date(), validTo: z.iso.date(),
  sourceFacts: z.array(templateFactSchema).min(1).max(20),
  verification: verificationRecordSchema
}).strict().refine(v => v.validTo >= v.validFrom, 'Validity end must not precede start')
export type TripTemplate = z.infer<typeof tripTemplateSchema>
export type CandidateStatus = z.infer<typeof candidateStatusSchema>
export interface DiscoveryCandidate {
  id: string; status: CandidateStatus; version: number; publishedVersion: number | null
  template: TripTemplate; createdAt: string; updatedAt: string
}
export const discoveryInputSchema = z.object({
  destinationCodes: z.array(z.string().regex(/^[A-Z]{3}$/)).min(1).max(6),
  interests: z.array(z.string().trim().min(1).max(80)).max(12).default([]),
  questions: z.array(z.string().trim().min(1).max(500)).min(1).max(6),
  researchTypes: z.array(z.enum(['event', 'seasonal', 'activity', 'stopover', 'practical'])).min(1).max(5),
  validFrom: z.iso.date(), validTo: z.iso.date(),
  suggestedDays: z.number().int().min(1).max(60).default(5),
  maxResults: z.number().int().min(1).max(10).default(5),
  candidateId: z.string().uuid().optional(), expectedVersion: z.number().int().nonnegative().optional(),
  instruction: z.string().trim().max(1000).optional()
}).strict().superRefine((v, c) => {
  const days = (Date.parse(v.validTo) - Date.parse(v.validFrom)) / 86400000
  if (days < 0 || days > 366) c.addIssue({ code: 'custom', message: 'Discovery validity must be within one year' })
  if (Boolean(v.candidateId) !== (v.expectedVersion !== undefined)) c.addIssue({ code: 'custom', message: 'Regeneration requires a candidate and expected version' })
})
export type DiscoveryInput = z.infer<typeof discoveryInputSchema>
export interface DiscoveryRun {
  id: string; status: 'queued' | 'running' | 'succeeded' | 'failed'; input: DiscoveryInput
  candidateCount: number; errorCode: string | null; attempt: number; createdAt: string; updatedAt: string
}
export interface TemplateVersion { version: number; action: string; actorId: string | null; template: TripTemplate; createdAt: string }
export const publicationSchema = z.object({ expectedVersion: z.number().int().positive(), acknowledgeFacts: z.literal(true), verifiedUntil: z.iso.datetime() }).strict()
export type PublicationInput = z.infer<typeof publicationSchema>

export function publicationProblem(template: TripTemplate, verifiedUntil: string, now = new Date()): string | undefined {
  const today = now.toISOString().slice(0, 10), expiry = Date.parse(verifiedUntil)
  if (template.validTo < today) return 'The template validity window has expired'
  if (!Number.isFinite(expiry) || expiry <= now.getTime() || expiry > now.getTime() + 30 * 86400000) return 'Human verification must expire within the next 30 days'
  if (template.sourceFacts.some(f => f.sourceUrls.length === 0)) return 'Each factual claim requires a source'
  return undefined
}
export function effectiveCandidateStatus(candidate: DiscoveryCandidate, now = new Date()): CandidateStatus {
  if (candidate.status === 'archived') return 'archived'
  if (candidate.template.validTo < now.toISOString().slice(0, 10)) return 'expired'
  if (candidate.status === 'published' && (!candidate.template.verification.expiresAt || Date.parse(candidate.template.verification.expiresAt) <= now.getTime())) return 'stale'
  return candidate.status
}
