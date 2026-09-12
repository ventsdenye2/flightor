import { z } from 'zod'
import { researchBriefSchema, researchTypeSchema, type ResearchBrief } from '../../research-agent/types.js'
import { locationSelectorSchema } from '../../locations/selector.js'
import { researchTripDestinations, researchStatusCounts, researchTravelWindow } from '../../research-agent/workspace.js'
import type { AgentTool, ToolExecutionContext } from '../runtime/registry.js'
import { canonicalResolvedLocation } from './resolved-locations.js'
import { workspaceScope } from './workspace-scope.js'
import type { TripContext } from '../../trips/types.js'

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
  findings: z.array(z.object({
    id: z.string().min(1).max(160),
    title: z.string().max(240),
    summary: z.string().max(1500),
    category: researchTypeSchema,
    destinations: z.array(z.object({ id: z.string().max(160), name: z.string().max(240) }).strict()).max(12),
    verificationStatus: z.enum(['verified', 'partially_verified', 'stale', 'unverified'])
  }).strict()).max(50),
  warnings: z.array(z.string().min(1).max(240)).max(40)
}).strict()

export const researchDestinationInputSchema = z.object({
  destination: locationSelectorSchema,
  questions: z.array(z.string().trim().min(1).max(500)).min(1).max(8),
  researchTypes: z.array(researchTypeSchema).min(1).max(5),
  maxResults: z.number().int().min(1).max(20).default(10)
}).strict()

export async function executeResearchBrief(
  input: ResearchBrief,
  context: ToolExecutionContext,
  signal: AbortSignal,
  snapshot?: TripContext
): Promise<z.infer<typeof researchToolOutputSchema>> {
  const brief = researchBriefSchema.parse(input)
  const trip = snapshot ?? await context.trips.get(context.tripId)
  if (!trip) throw new Error('Trip context was not found')
  const scope = await workspaceScope(context, signal, trip)
  brief.destinations = brief.destinations.map(destination => canonicalResolvedLocation(context, destination))
  // Both research tools inherit only omitted dates, from the snapshot accepted by this workspace.
  // Explicit windows remain research intent; completion separately checks their coverage.
  if (brief.travelWindow === undefined) {
    const travelWindow = researchTravelWindow(trip)
    if (travelWindow) brief.travelWindow = travelWindow
  }
  const { record: stored, payload: artifact } = await researchTripDestinations(brief, context.research, scope)
  return {
    artifact: { id: stored.id, type: 'research', schemaVersion: 2 },
    summary: {
      findingCount: artifact.findings.length,
      statusCounts: researchStatusCounts(artifact),
      createdAt: artifact.createdAt
    },
    findings: artifact.findings.map(finding => ({
      id: finding.id, title: finding.title, summary: finding.summary, category: finding.category,
      destinations: finding.destinations.map(destination => ({ id: destination.id, name: destination.name })),
      verificationStatus: finding.verification.expiresAt && Date.parse(finding.verification.expiresAt) <= Date.now() ? 'stale' : finding.verification.status
    })),
    warnings: artifact.warnings
  }
}

export const webResearchTool: AgentTool<ResearchBrief, z.infer<typeof researchToolOutputSchema>> = {
  name: 'web_research',
  description: 'Compatibility research tool for a complete minimal ResearchBrief. An omitted travelWindow inherits the accepted Trip snapshot window; an explicit window keeps its requested scope. Produces a bounded Research Artifact and never changes Trip or Memory.',
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
  description: 'Research sourced activities for one trusted destination and return the findings directly for itinerary planning. Write concise, focused search questions; request a useful set for the whole visit rather than searching each day. Choose queries freely based on missing evidence. Pass destination as a trusted resolved id STRING; the active Trip supplies dates and interests. Preserve partial/unverified labels; use eligible finding ids in save_travel_guide.',
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
    const brief = researchBriefSchema.parse({
      destinations: [canonicalResolvedLocation(context, input.destination)],
      interests: trip.interests,
      questions: input.questions,
      researchTypes: input.researchTypes,
      maxResults: input.maxResults
    })
    return executeResearchBrief(brief, context, signal, trip)
  }
}
