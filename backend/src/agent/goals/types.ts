import { z } from 'zod'
import { ARTIFACT_TYPES } from '../../artifacts/repository.js'
import { tripContextSchema, type TripContext } from '../../trips/types.js'

export const goalKindSchema = z.enum([
  'travel_guide',
  'flight_search',
  'trip_context_update',
  'route_generation'
])
export type GoalKind = z.infer<typeof goalKindSchema>

export const goalStatusSchema = z.enum(['pending', 'satisfied', 'partial', 'failed', 'cancelled'])
export type GoalStatus = z.infer<typeof goalStatusSchema>

export const goalRunStatusSchema = z.enum(['running', 'satisfied', 'partial', 'failed', 'cancelled'])
export type GoalRunStatus = z.infer<typeof goalRunStatusSchema>

export const goalAuthorizationSourceSchema = z.enum(['button', 'explicit_user_message'])
export type GoalAuthorizationSource = z.infer<typeof goalAuthorizationSourceSchema>

export const goalAuthorizationSchema = z.object({
  source: goalAuthorizationSourceSchema,
  grantedAt: z.iso.datetime()
}).strict()

const travelGuideParametersSchema = z.object({
  questions: z.array(z.string().trim().min(1).max(500)).min(1).max(8),
  researchTypes: z.array(z.enum(['event', 'seasonal', 'activity', 'stopover', 'practical'])).min(1).max(5),
  maxResults: z.number().int().min(1).max(20),
  maxCities: z.number().int().min(1).max(12),
  allowPartial: z.boolean()
}).strict()

const flightSearchParametersSchema = z.object({
  requestKey: z.string().trim().min(1).max(200),
  departureDate: z.iso.date().optional(),
  returnDate: z.iso.date().optional()
}).strict()

const tripContextUpdateParametersSchema = z.object({
  fields: z.array(z.enum([
    'origin', 'departureWindow', 'returnWindow', 'travelDays', 'budget',
    'destinationIntent', 'interests', 'pace', 'priorities',
    'transferPreferences', 'locationRoleOverrides', 'mustIncludeEvents',
    'requiredGroundLegs', 'notes'
  ])).min(1).max(14)
}).strict()

const routeGenerationParametersSchema = z.object({
  requestKey: z.string().trim().min(1).max(200)
}).strict()

/** Goal parameters are bounded intent constraints, never provider facts. */
export const goalIntentSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('travel_guide'), parameters: travelGuideParametersSchema }).strict(),
  z.object({ kind: z.literal('flight_search'), parameters: flightSearchParametersSchema }).strict(),
  z.object({ kind: z.literal('trip_context_update'), parameters: tripContextUpdateParametersSchema }).strict(),
  z.object({ kind: z.literal('route_generation'), parameters: routeGenerationParametersSchema }).strict()
])
export type GoalIntent = z.infer<typeof goalIntentSchema>

export const goalArtifactRefSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(ARTIFACT_TYPES),
  schemaVersion: z.number().int().positive(),
  observedAt: z.iso.datetime()
}).strict()
export type GoalArtifactRef = z.infer<typeof goalArtifactRefSchema>

export const goalLocationHandleSchema = z.object({
  id: z.string().min(1).max(160),
  kind: z.enum(['airport', 'city', 'location']),
  observedAt: z.iso.datetime()
}).strict()
export type GoalLocationHandle = z.infer<typeof goalLocationHandleSchema>

export const goalWorkingSetSchema = z.object({
  artifactRefs: z.array(goalArtifactRefSchema).max(100),
  locationHandles: z.array(goalLocationHandleSchema).max(100)
}).strict().superRefine((value, context) => {
  const artifactIds = new Set<string>()
  value.artifactRefs.forEach((ref, index) => {
    if (artifactIds.has(ref.id)) context.addIssue({ code: 'custom', path: ['artifactRefs', index, 'id'], message: 'Artifact references must be unique' })
    artifactIds.add(ref.id)
  })
  const locationIds = new Set<string>()
  value.locationHandles.forEach((handle, index) => {
    if (locationIds.has(handle.id)) context.addIssue({ code: 'custom', path: ['locationHandles', index, 'id'], message: 'Location handles must be unique' })
    locationIds.add(handle.id)
  })
})
export type GoalWorkingSet = z.infer<typeof goalWorkingSetSchema>

export const goalRecordSchema = z.object({
  id: z.string().uuid(),
  ownerId: z.string().min(1).max(160),
  tripId: z.string().min(1).max(160),
  conversationId: z.string().uuid().optional(),
  kind: goalKindSchema,
  status: goalStatusSchema,
  parameters: z.unknown(),
  createdContextVersion: z.number().int().nonnegative(),
  authorization: goalAuthorizationSchema.optional(),
  revision: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
}).strict().superRefine((value, context) => {
  if (!goalIntentSchema.safeParse({ kind: value.kind, parameters: value.parameters }).success) {
    context.addIssue({ code: 'custom', path: ['parameters'], message: 'Goal parameters do not match goal kind' })
  }
  if (value.kind === 'route_generation' && value.authorization === undefined) {
    context.addIssue({ code: 'custom', path: ['authorization'], message: 'Route generation requires explicit authorization' })
  }
})
export type GoalRecord = z.infer<typeof goalRecordSchema>

export const createGoalInputSchema = z.object({
  id: z.string().uuid().optional(),
  tripId: z.string().min(1).max(160),
  conversationId: z.string().uuid().optional(),
  kind: goalKindSchema,
  parameters: z.unknown(),
  createdContextVersion: z.number().int().nonnegative(),
  authorization: goalAuthorizationSchema.optional(),
  idempotencyKey: z.string().min(1).max(200)
}).strict().superRefine((value, context) => {
  if (!goalIntentSchema.safeParse({ kind: value.kind, parameters: value.parameters }).success) {
    context.addIssue({ code: 'custom', path: ['parameters'], message: 'Goal parameters do not match goal kind' })
  }
  if (value.kind === 'route_generation' && value.authorization === undefined) {
    context.addIssue({ code: 'custom', path: ['authorization'], message: 'Route generation requires explicit authorization' })
  }
})
export type CreateGoalInput = z.infer<typeof createGoalInputSchema>

export const goalStatusUpdateSchema = z.object({ status: goalStatusSchema }).strict()
export type GoalStatusUpdate = z.infer<typeof goalStatusUpdateSchema>

export const goalRunRecordSchema = z.object({
  id: z.string().uuid(),
  ownerId: z.string().min(1).max(160),
  goalId: z.string().uuid(),
  tripId: z.string().min(1).max(160),
  generationId: z.string().min(1).max(160),
  contextVersion: z.number().int().nonnegative(),
  contextSnapshot: tripContextSchema,
  status: goalRunStatusSchema,
  workingSet: goalWorkingSetSchema,
  revision: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
}).strict().superRefine((value, context) => {
  if (value.contextSnapshot.version !== value.contextVersion) {
    context.addIssue({ code: 'custom', path: ['contextVersion'], message: 'Run context version must match its snapshot' })
  }
})
export type GoalRunRecord = z.infer<typeof goalRunRecordSchema>

export const createGoalRunInputSchema = z.object({
  id: z.string().uuid().optional(),
  goalId: z.string().uuid(),
  tripId: z.string().min(1).max(160),
  generationId: z.string().min(1).max(160),
  contextVersion: z.number().int().nonnegative(),
  contextSnapshot: tripContextSchema,
  idempotencyKey: z.string().min(1).max(200)
}).strict().superRefine((value, context) => {
  if (value.contextSnapshot.version !== value.contextVersion) {
    context.addIssue({ code: 'custom', path: ['contextVersion'], message: 'Run context version must match its snapshot' })
  }
})
export type CreateGoalRunInput = z.infer<typeof createGoalRunInputSchema>

export const goalRunStatusUpdateSchema = z.object({
  status: goalRunStatusSchema,
  workingSet: goalWorkingSetSchema.optional()
}).strict()
export type GoalRunStatusUpdate = z.infer<typeof goalRunStatusUpdateSchema>

export interface GoalContextSnapshot extends TripContext {}

export function emptyGoalWorkingSet(): GoalWorkingSet {
  return { artifactRefs: [], locationHandles: [] }
}
