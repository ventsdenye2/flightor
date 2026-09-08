import { z } from 'zod'
import { composeTravelGuide } from '../../travel-guides/workspace.js'
import type { AgentTool } from '../runtime/registry.js'
import { workspaceScope } from './workspace-scope.js'

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
    if (!context.travelGuideBuilder) throw new Error('Travel guide builder is unavailable')
    const { record: stored, payload } = await composeTravelGuide(input, context.travelGuideBuilder, await workspaceScope(context, signal))
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
