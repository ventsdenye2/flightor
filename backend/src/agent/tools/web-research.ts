import { z } from 'zod'
import { v7 as uuidv7 } from 'uuid'
import { locationRefKey } from '../../aviation/types.js'
import { researchArtifactSchema, researchBriefSchema } from '../../research-agent/types.js'
import type { AgentTool } from '../runtime/registry.js'

const outputSchema = z.object({
  artifact: z.object({ id: z.string().uuid(), type: z.literal('research'), schemaVersion: z.literal(1) }).strict(),
  summary: z.object({
    findingCount: z.number().int().nonnegative(),
    confidenceCounts: z.object({ confirmed: z.number().int().nonnegative(), partial: z.number().int().nonnegative(), unconfirmed: z.number().int().nonnegative() }).strict(),
    createdAt: z.iso.datetime()
  }).strict(),
  warnings: z.array(z.string().max(240)).max(20)
}).strict()

function sameBrief(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

export const webResearchTool: AgentTool<z.infer<typeof researchBriefSchema>, z.infer<typeof outputSchema>> = {
  name: 'web_research',
  description: 'Research current destination questions using verified web sources. Returns a bounded artifact reference; never changes trip or memory state.',
  inputSchema: researchBriefSchema,
  outputSchema,
  costClass: 'paid',
  costUnits: 4,
  sideEffect: 'state',
  parallelSafe: false,
  timeoutMs: 45_000,
  provider: 'research_agent',
  async execute(input, context, signal) {
    if (signal.aborted || context.isGenerationCurrent?.() === false) throw new Error('Research was cancelled')
    const trustedLocations = context.resolvedLocationKeys ?? new Set<string>()
    for (const destination of input.destinations) {
      if (!trustedLocations.has(locationRefKey(destination))) {
        throw new Error('Research destination was not resolved by an authoritative provider')
      }
    }
    const researchResult = researchArtifactSchema.parse(await context.research.research(input, { requestId: context.requestId, signal }))
    if (!sameBrief(researchResult.brief, input)) throw new Error('Research agent returned a mismatched brief')
    const effectiveMax = input.maxResults ?? 10
    if (researchResult.findings.length > effectiveMax) throw new Error('Research agent returned too many findings')
    if (signal.aborted || context.isGenerationCurrent?.() === false) throw new Error('Research was cancelled')
    const id = uuidv7()
    const artifact = researchArtifactSchema.parse({ ...researchResult, id })
    const stored = await context.artifacts.create({
      id,
      tripId: context.tripId,
      conversationId: context.conversationId,
      type: 'research',
      schemaVersion: 1,
      payload: artifact,
      verification: { findingCount: artifact.findings.length, confidence: artifact.findings.reduce((acc, item) => { acc[item.confidence]++; return acc }, { confirmed: 0, partial: 0, unconfirmed: 0 }) }
    })
    const confidenceCounts = artifact.findings.reduce((acc, item) => { acc[item.confidence]++; return acc }, { confirmed: 0, partial: 0, unconfirmed: 0 })
    return { artifact: { id: stored.id, type: 'research', schemaVersion: 1 }, summary: { findingCount: artifact.findings.length, confidenceCounts, createdAt: artifact.createdAt }, warnings: [] }
  }
}

export { outputSchema as webResearchOutputSchema }
