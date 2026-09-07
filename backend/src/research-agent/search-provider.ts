import { z } from 'zod'
import { locationRefSchema } from '../aviation/types.js'
import { researchBriefSchema, researchSourceAuthoritySchema } from './types.js'

export const researchSearchInputSchema = z.object({
  destination: locationRefSchema,
  travelWindow: researchBriefSchema.shape.travelWindow.optional(),
  interests: z.array(z.string().trim().min(1).max(80)).max(32),
  questions: z.array(z.string().trim().min(1).max(500)).min(1).max(8),
  researchTypes: researchBriefSchema.shape.researchTypes,
  maxResults: z.number().int().min(1).max(20)
}).strict()

export type ResearchSearchInput = z.infer<typeof researchSearchInputSchema>

export const researchSourceCandidateSchema = z.object({
  title: z.string().min(1).max(240),
  snippet: z.string().min(1).max(800),
  url: z.url().max(500),
  domain: z.string().min(1).max(253),
  authority: researchSourceAuthoritySchema,
  publishedAt: z.iso.datetime().optional()
}).strict()

export type ResearchSourceCandidate = z.infer<typeof researchSourceCandidateSchema>

export const researchSearchResultSchema = z.object({
  candidates: z.array(researchSourceCandidateSchema).max(20),
  checkedAt: z.iso.datetime(),
  warnings: z.array(z.string().min(1).max(240)).max(20)
}).strict()

export type ResearchSearchResult = z.infer<typeof researchSearchResultSchema>

export interface ResearchSearchProvider {
  readonly name: string
  search(input: ResearchSearchInput, options?: { signal?: AbortSignal }): Promise<ResearchSearchResult>
}

export interface ResearchDraftFinding {
  category: ResearchSearchInput['researchTypes'][number]
  destinationIndex: number
  title: string
  summary: string
  sourceIndexes: number[]
}

export interface ResearchSynthesisInput {
  brief: z.infer<typeof researchBriefSchema>
  sources: ResearchSourceCandidate[]
}

export interface ResearchSynthesisModel {
  synthesize(input: ResearchSynthesisInput, options?: { signal?: AbortSignal }): Promise<ResearchDraftFinding[]>
}
