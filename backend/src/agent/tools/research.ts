import { z } from 'zod'
import { locationRefSchema } from '../../aviation/types.js'
import { researchBriefSchema, type ResearchBrief } from '../../research-agent/types.js'
import { researchTripDestinations, researchStatusCounts, researchTravelWindow } from '../../research-agent/workspace.js'
import type { AgentTool, ToolExecutionContext } from '../runtime/registry.js'
import { canonicalResolvedLocation } from './resolved-locations.js'
import { workspaceScope } from './workspace-scope.js'

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
  destination: z.union([z.string().min(1).max(128), locationRefSchema]),
  questions: z.array(z.string().trim().min(1).max(500)).min(1).max(8),
  researchTypes: z.array(z.enum(['event', 'seasonal', 'activity', 'stopover', 'practical'])).min(1).max(5),
  maxResults: z.number().int().min(1).max(20).default(10)
}).strict()

export async function executeResearchBrief(
  input: ResearchBrief,
  context: ToolExecutionContext,
  signal: AbortSignal
): Promise<z.infer<typeof researchToolOutputSchema>> {
  const brief = researchBriefSchema.parse(input)
  brief.destinations = brief.destinations.map(destination => canonicalResolvedLocation(context, destination))
  const { record: stored, payload: artifact } = await researchTripDestinations(brief, context.research, workspaceScope(context, signal))
  return {
    artifact: { id: stored.id, type: 'research', schemaVersion: 2 },
    summary: {
      findingCount: artifact.findings.length,
      statusCounts: researchStatusCounts(artifact),
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
  timeoutMs: 95_000,
  provider: 'research_agent',
  execute: executeResearchBrief
}

export const researchDestinationTool: AgentTool<
  z.infer<typeof researchDestinationInputSchema>,
  z.infer<typeof researchToolOutputSchema>
> = {
  name: 'research_destination',
  description: 'Research current activities, events, seasonal or practical questions for one trusted destination. Pass destination as the exact id STRING returned by resolve_location or search_destinations in this turn. The server retrieves all canonical location facts; do not copy or invent coordinates. The active Trip supplies its travel window and interests.',
  inputSchema: researchDestinationInputSchema,
  outputSchema: researchToolOutputSchema,
  costClass: 'paid',
  costUnits: 4,
  sideEffect: 'state',
  parallelSafe: false,
  timeoutMs: 95_000,
  provider: 'research_agent',
  async execute(input, context, signal) {
    const trip = await context.trips.get(context.tripId)
    if (!trip) throw new Error('Trip context was not found')
    const travelWindow = researchTravelWindow(trip)
    const brief = researchBriefSchema.parse({
      destinations: [canonicalResolvedLocation(context, input.destination)],
      ...(travelWindow ? { travelWindow } : {}),
      interests: trip.interests,
      questions: input.questions,
      researchTypes: input.researchTypes,
      maxResults: input.maxResults
    })
    return executeResearchBrief(brief, context, signal)
  }
}
