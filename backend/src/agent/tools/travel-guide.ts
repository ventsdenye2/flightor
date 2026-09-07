import { z } from 'zod'
import { v7 as uuidv7 } from 'uuid'
import { readableResearchArtifactSchema } from '../../research-agent/types.js'
import { tripRoutePlanPayloadSchema } from '../../trip-planning/types.js'
import { travelGuideArtifactPayloadSchema } from '../../travel-guides/artifact.js'
import type { AgentTool, ToolExecutionContext } from '../runtime/registry.js'

export const buildTravelGuideInputSchema = z.object({
  routeArtifactId: z.string().uuid(),
  researchArtifactIds: z.array(z.string().uuid()).max(20).default([])
}).strict()

export const buildTravelGuideOutputSchema = z.object({
  artifact: z.object({
    id: z.string().uuid(),
    type: z.literal('travel_guide'),
    schemaVersion: z.literal(1)
  }).strict(),
  summary: z.object({
    dayCount: z.number().int().nonnegative(),
    itemCount: z.number().int().nonnegative(),
    verificationStatus: z.enum(['verified', 'partially_verified', 'stale', 'unverified']),
    createdAt: z.iso.datetime()
  }).strict(),
  warnings: z.array(z.string().min(1).max(240)).max(40)
}).strict()

async function loadRoute(context: ToolExecutionContext, artifactId: string) {
  const record = await context.artifacts.get(artifactId)
  if (!record || record.tripId !== context.tripId) throw new Error('Trip route artifact was not found')
  if (record.type !== 'route' || record.schemaVersion !== 1) throw new Error('Source artifact is not a supported trip route plan')
  return tripRoutePlanPayloadSchema.parse(record.payload)
}

async function loadResearch(context: ToolExecutionContext, artifactIds: readonly string[]) {
  const unique = [...new Set(artifactIds)]
  const artifacts = []
  for (const artifactId of unique) {
    const record = await context.artifacts.get(artifactId)
    if (!record || record.tripId !== context.tripId) throw new Error('Research artifact was not found')
    if (record.type !== 'research' || (record.schemaVersion !== 1 && record.schemaVersion !== 2)) {
      throw new Error('Source artifact is not supported research')
    }
    const artifact = readableResearchArtifactSchema.parse(record.payload)
    if (artifact.id !== record.id) throw new Error('Research artifact identity does not match its envelope')
    artifacts.push(artifact)
  }
  return artifacts
}

export const buildTravelGuideTool: AgentTool<
  z.infer<typeof buildTravelGuideInputSchema>,
  z.infer<typeof buildTravelGuideOutputSchema>
> = {
  name: 'build_travel_guide',
  description: 'Compose a day-level guide from a trusted trip-route artifact and owner-scoped Research Artifacts. It performs no web search and invents no missing facts.',
  inputSchema: buildTravelGuideInputSchema,
  outputSchema: buildTravelGuideOutputSchema,
  costClass: 'cheap',
  costUnits: 1,
  sideEffect: 'state',
  parallelSafe: false,
  timeoutMs: 10_000,
  provider: 'travel_guide_builder',
  async execute(input, context, signal) {
    if (signal.aborted || context.isGenerationCurrent?.() === false) throw new Error('Travel guide build was cancelled')
    if (!context.travelGuideBuilder) throw new Error('Travel guide builder is unavailable')
    const route = await loadRoute(context, input.routeArtifactId)
    const researchArtifacts = await loadResearch(context, input.researchArtifactIds)
    const payload = travelGuideArtifactPayloadSchema.parse(await context.travelGuideBuilder.build({
      routeArtifactId: input.routeArtifactId,
      route,
      researchArtifacts
    }, { signal }))
    if (payload.routeArtifactId !== input.routeArtifactId) throw new Error('Travel guide builder returned a mismatched route')
    for (const id of input.researchArtifactIds) {
      if (!payload.sourceArtifactIds.includes(id)) throw new Error('Travel guide builder omitted a source artifact')
    }
    if (signal.aborted || context.isGenerationCurrent?.() === false) throw new Error('Travel guide build was cancelled')
    const id = uuidv7()
    const stored = await context.artifacts.create({
      id,
      tripId: context.tripId,
      conversationId: context.conversationId,
      type: 'travel_guide',
      schemaVersion: 1,
      payload,
      verification: payload.verification
    })
    return {
      artifact: { id: stored.id, type: 'travel_guide', schemaVersion: 1 },
      summary: {
        dayCount: payload.days.length,
        itemCount: payload.days.reduce((count, day) => count + day.items.length, 0),
        verificationStatus: payload.verification.status,
        createdAt: payload.createdAt
      },
      warnings: payload.warnings
    }
  }
}
