import { z } from 'zod'
import { tripContextSchema } from '../../trips/types.js'
import { flightSearchGoalParametersSchema, travelGuideGoalParametersSchema, tripContextUpdateGoalParametersSchema } from './types.js'

/** Planner goals never include the separately authorized route-generation workflow. */
export const plannerGoalIntentSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('travel_guide'), parameters: travelGuideGoalParametersSchema }).strict(),
  z.object({ kind: z.literal('flight_search'), parameters: flightSearchGoalParametersSchema }).strict(),
  z.object({ kind: z.literal('trip_context_update'), parameters: tripContextUpdateGoalParametersSchema }).strict()
])
export type PlannerGoalIntent = z.infer<typeof plannerGoalIntentSchema>

export const acceptGoalRunInputSchema = z.object({
  tripId: z.string().min(1).max(160),
  conversationId: z.string().uuid().optional(),
  requestId: z.string().min(1).max(200),
  generationId: z.string().min(1).max(160),
  contextSnapshot: tripContextSchema,
  intent: plannerGoalIntentSchema.optional(),
  goalRef: z.string().uuid().optional()
}).strict().superRefine((input, context) => {
  if ((input.intent === undefined) === (input.goalRef === undefined)) {
    context.addIssue({ code: 'custom', path: ['intent'], message: 'Exactly one of intent or goalRef is required' })
  }
  if (input.contextSnapshot.id !== input.tripId) {
    context.addIssue({ code: 'custom', path: ['contextSnapshot', 'id'], message: 'Context snapshot must belong to the accepted Trip' })
  }
})
export type AcceptGoalRunInput = z.infer<typeof acceptGoalRunInputSchema>
