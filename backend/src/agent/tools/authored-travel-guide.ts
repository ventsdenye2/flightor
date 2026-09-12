import { z } from 'zod'
import { authoredGuideInputSchema, saveAuthoredTravelGuide, type AuthoredGuideInput } from '../../travel-guides/authored.js'
import { travelGuideArtifactPayloadSchema } from '../../travel-guides/artifact.js'
import type { TravelGuideConstraints } from '../../travel-guides/validation.js'
import { travelGuideGoalParametersSchema } from '../goals/types.js'
import type { AgentTool } from '../runtime/registry.js'
import { workspaceScope } from './workspace-scope.js'

const outputSchema = z.object({
  status: z.enum(['saved', 'needs_revision']),
  issues: z.array(z.string().max(500)).max(400),
  requirements: travelGuideGoalParametersSchema.pick({ maxCities: true, maxResults: true, researchTypes: true, allowPartial: true, allowRestDays: true }).optional(),
  revisionGuidance: z.string().max(500).optional(),
  details: z.array(z.object({ code: z.string().max(160), day: z.number().int().min(1).max(60), sourceFindingId: z.string().max(160) }).strict()).max(400).optional(),
  artifact: z.object({ id: z.string().uuid(), type: z.literal('travel_guide'), schemaVersion: z.literal(1) }).strict().optional(),
  summary: z.object({ dayCount: z.number().int(), itemCount: z.number().int(), verificationStatus: z.string() }).strict().optional(),
  days: travelGuideArtifactPayloadSchema.shape.days.optional(),
  warnings: z.array(z.string().max(240)).max(40)
}).strict()

export const saveTravelGuideTool: AgentTool<AuthoredGuideInput, z.infer<typeof outputSchema>> = {
  name: 'save_travel_guide',
  description: 'Save YOUR day-by-day itinerary directly from compatible research findings. No destination-set or outline artifact is required. Choose cityId, days, activity order, suggested timeOfDay, daily theme and personal planningNote. researchIndex is the zero-based index in researchArtifactIds; findingId comes from research output. The server restores source facts and checks dates, cities, evidence and the accepted Goal limits before saving. Planning notes express recommendations, not new opening hours, fares or verified transit times. A rest/travel day needs notes and a Goal permitting rest days. needs_revision returns unmet requirements without saving an invalid guide. Saved days are authoritative persisted output for your reply.',
  inputSchema: authoredGuideInputSchema, outputSchema,
  costClass: 'cheap', costUnits: 1, sideEffect: 'state', parallelSafe: false,
  timeoutMs: 15_000, provider: 'travel_guide',
  async execute(input, context, signal) {
    let constraints: TravelGuideConstraints = { maxCities: 12, maxResults: 20, researchTypes: ['activity'], allowPartial: true }
    if (context.goalRepository) {
      if (!context.activeGoalId || !context.activeGoalRunId) return {
        status: 'needs_revision', issues: ['active_travel_guide_goal_required'], warnings: [],
        revisionGuidance: 'Use resume_goal for the matching unfinished travel_guide Goal, or declare_goal for a new objective, before saving. Reading get_active_goal does not activate its run.'
      }
      const goal = await context.goalRepository.get(context.activeGoalId)
      if (!goal || goal.kind !== 'travel_guide') return { status: 'needs_revision', issues: ['active_travel_guide_goal_required'], warnings: [] }
      constraints = travelGuideGoalParametersSchema.parse(goal.parameters)
    }
    const { maxCities, maxResults, researchTypes, allowPartial, allowRestDays } = constraints
    const requirements = { maxCities, maxResults, researchTypes, allowPartial, ...(allowRestDays === undefined ? {} : { allowRestDays }) }
    const result = await saveAuthoredTravelGuide(input, constraints, await workspaceScope(context, signal), [...context.resolvedLocations?.values() ?? []])
    if (result.status === 'needs_revision') return {
      ...result, requirements, warnings: [],
      revisionGuidance: 'Keep the accepted Goal. Correct the selected days/findings or research the missing evidence indicated by issues, then resubmit. Cancelling or redeclaring does not repair an unmet requirement.'
    }
    return {
      status: 'saved', issues: [], requirements, artifact: { id: result.record.id, type: 'travel_guide', schemaVersion: 1 },
      summary: { dayCount: result.payload.days.length, itemCount: result.payload.days.reduce((sum, day) => sum + day.items.length, 0), verificationStatus: result.payload.verification.status },
      days: result.payload.days, warnings: result.payload.warnings
    }
  }
}
