import { z } from 'zod'
import { finalizationSchema } from './finalization-schema.js'

const referenceSchema = z.object({
  url: z.url().max(500), title: z.string().min(1).max(240),
  labelQuote: z.string().min(2).max(160).optional(),
  labelBasis: z.enum(['source_title', 'search_excerpt', 'page_excerpt']).optional(),
  excerpts: z.array(z.object({ quote: z.string().max(800), retrievedAt: z.iso.datetime(),
    basis: z.literal('search_excerpt').optional(),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/).optional()
  }).strict()).max(8)
}).strict()
export const guidePublicationSchema = z.object({
  finalization: finalizationSchema.optional(),
  version: z.literal(1), artifactId: z.string().min(1).max(160), tripContextVersion: z.number().int().nonnegative(),
  guideContentHash: z.string().regex(/^[a-f0-9]{64}$/),
  flightSelectionRevision: z.number().int().positive().optional(),
  contentContract: z.literal('limited'), evidenceCoverage: z.enum(['partial', 'unknown']), legacy: z.boolean(),
  references: z.record(z.string(), z.array(referenceSchema).max(20)),
  budgetAssessment: z.object({
    status: z.literal('undetermined'), knownSubtotal: z.null(), scopeCoverage: z.literal('incomplete'), notice: z.string().max(500)
  }).strict(), reply: z.string().max(1500)
}).strict()
export type GuidePublication = z.infer<typeof guidePublicationSchema>
