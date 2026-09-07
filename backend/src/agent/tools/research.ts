import { z } from 'zod'
import { v7 as uuidv7 } from 'uuid'
import { locationRefKey, locationRefSchema, type VerificationRecord } from '../../aviation/types.js'
import { researchArtifactSchema, researchBriefSchema, type ResearchArtifact, type ResearchBrief } from '../../research-agent/types.js'
import type { AgentTool, ToolExecutionContext } from '../runtime/registry.js'

const artifactReferenceSchema = z.object({
  id: z.string().uuid(),
  type: z.literal('research'),
  schemaVersion: z.literal(2)
}).strict()

const statusCountsSchema = z.object({
  verified: z.number().int().nonnegative(),
  partially_verified: z.number().int().nonnegative(),
  stale: z.number().int().nonnegative(),
  unverified: z.number().int().nonnegative()
}).strict()

export const researchToolOutputSchema = z.object({
  artifact: artifactReferenceSchema,
  summary: z.object({
    findingCount: z.number().int().nonnegative(),
    statusCounts: statusCountsSchema,
    createdAt: z.iso.datetime()
  }).strict(),
  warnings: z.array(z.string().min(1).max(240)).max(40)
}).strict()

export const researchDestinationInputSchema = z.object({
  destination: locationRefSchema,
  questions: z.array(z.string().trim().min(1).max(500)).min(1).max(8),
  researchTypes: z.array(z.enum(['event', 'seasonal', 'activity', 'stopover', 'practical'])).min(1).max(5),
  maxResults: z.number().int().min(1).max(20).default(10)
}).strict()

function assertCurrent(context: ToolExecutionContext, signal: AbortSignal): void {
  if (signal.aborted || context.isGenerationCurrent?.() === false) throw new Error('Research was cancelled')
}

function assertTrustedDestinations(context: ToolExecutionContext, brief: ResearchBrief): void {
  const trustedLocations = context.resolvedLocationKeys ?? new Set<string>()
  for (const destination of brief.destinations) {
    if (!trustedLocations.has(locationRefKey(destination))) {
      throw new Error('Research destination was not resolved by an authoritative provider')
    }
  }
}

function sameBrief(left: ResearchBrief, right: ResearchBrief): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function statusCounts(artifact: ResearchArtifact) {
  return artifact.findings.reduce((counts, finding) => {
    counts[finding.verification.status] += 1
    return counts
  }, { verified: 0, partially_verified: 0, stale: 0, unverified: 0 })
}

function artifactVerification(artifact: ResearchArtifact): VerificationRecord {
  const counts = statusCounts(artifact)
  const status: VerificationRecord['status'] = artifact.findings.length === 0 || counts.unverified === artifact.findings.length
    ? 'unverified'
    : counts.unverified > 0 || counts.stale > 0 || counts.partially_verified > 0
      ? 'partially_verified'
      : 'verified'
  const sources = new Map<string, VerificationRecord['sources'][number]>()
  for (const finding of artifact.findings) {
    for (const source of finding.verification.sources) {
      const key = `${source.provider}:${source.reference ?? ''}`
      if (!sources.has(key)) sources.set(key, source)
    }
  }
  return {
    status,
    checkedAt: artifact.createdAt,
    confidence: artifact.findings.length === 0
      ? 0
      : Math.min(...artifact.findings.map(finding => finding.verification.confidence)),
    sources: [...sources.values()].slice(0, 20)
  }
}

export async function executeResearchBrief(
  input: ResearchBrief,
  context: ToolExecutionContext,
  signal: AbortSignal
): Promise<z.infer<typeof researchToolOutputSchema>> {
  assertCurrent(context, signal)
  const brief = researchBriefSchema.parse(input)
  assertTrustedDestinations(context, brief)
  const researchResult = researchArtifactSchema.parse(await context.research.research(brief, {
    requestId: context.requestId,
    signal
  }))
  if (!sameBrief(researchResult.brief, brief)) throw new Error('Research agent returned a mismatched brief')
  if (researchResult.findings.length > (brief.maxResults ?? 10)) throw new Error('Research agent returned too many findings')
  assertCurrent(context, signal)
  const id = uuidv7()
  const artifact = researchArtifactSchema.parse({ ...researchResult, id })
  const stored = await context.artifacts.create({
    id,
    tripId: context.tripId,
    conversationId: context.conversationId,
    type: 'research',
    schemaVersion: 2,
    payload: artifact,
    verification: artifactVerification(artifact)
  })
  return {
    artifact: { id: stored.id, type: 'research', schemaVersion: 2 },
    summary: {
      findingCount: artifact.findings.length,
      statusCounts: statusCounts(artifact),
      createdAt: artifact.createdAt
    },
    warnings: artifact.warnings
  }
}

export const webResearchTool: AgentTool<ResearchBrief, z.infer<typeof researchToolOutputSchema>> = {
  name: 'web_research',
  description: 'Compatibility research tool for a complete minimal ResearchBrief. Produces a bounded Research Artifact and never changes Trip or Memory.',
  inputSchema: researchBriefSchema,
  outputSchema: researchToolOutputSchema,
  costClass: 'paid',
  costUnits: 4,
  sideEffect: 'state',
  parallelSafe: false,
  timeoutMs: 45_000,
  provider: 'research_agent',
  execute: executeResearchBrief
}

export const researchDestinationTool: AgentTool<
  z.infer<typeof researchDestinationInputSchema>,
  z.infer<typeof researchToolOutputSchema>
> = {
  name: 'research_destination',
  description: 'Research current activities, events, seasonal or practical questions for one trusted destination. The active Trip supplies its travel window and interests.',
  inputSchema: researchDestinationInputSchema,
  outputSchema: researchToolOutputSchema,
  costClass: 'paid',
  costUnits: 4,
  sideEffect: 'state',
  parallelSafe: false,
  timeoutMs: 45_000,
  provider: 'research_agent',
  async execute(input, context, signal) {
    const trip = await context.trips.get(context.tripId)
    if (!trip) throw new Error('Trip context was not found')
    const from = trip.departureWindow?.from
    const to = trip.returnWindow?.to ?? trip.departureWindow?.to
    const brief = researchBriefSchema.parse({
      destinations: [input.destination],
      ...((from || to) ? { travelWindow: { ...(from ? { from } : {}), ...(to ? { to } : {}) } } : {}),
      interests: trip.interests,
      questions: input.questions,
      researchTypes: input.researchTypes,
      maxResults: input.maxResults
    })
    return executeResearchBrief(brief, context, signal)
  }
}
