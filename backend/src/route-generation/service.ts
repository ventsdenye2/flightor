import { z } from 'zod'
import { v7 as uuidv7 } from 'uuid'
import { createHash } from 'node:crypto'
import type { ArtifactRecord, ArtifactRepository } from '../artifacts/repository.js'
import type { GoalRepository, GoalRunRepository } from '../agent/goals/repository.js'
import type { GoalAuthorizationSource, GoalRunRecord, GoalStatus, GoalWorkingSet } from '../agent/goals/types.js'
import type { GoalVerifierRegistry } from '../agent/goals/verifier.js'
import { locationRefsOverlap, type LocationRef, type VerificationRecord } from '../aviation/types.js'
import type { ConnectionSearchService, FlightRoutePlanner, RouteOptimizer } from '../flight-routing/types.js'
import { routeSetPayloadSchema, type CompleteFlightPath, type ConnectionSearchResult, type FlightRoutePlanResult, type RouteOptimizationResult } from '../flight-routing/types.js'
import { AppError, isAppError } from '../lib/errors.js'
import type { ConversationRepository } from '../conversations/repository.js'
import type { TripRepository } from '../trips/repository.js'
import { tripContextSchema, type TripContext } from '../trips/types.js'
import {
  routeGenerationProgressStageSchema,
  routeGenerationIdempotencyKeySchema,
  type CreateRouteGenerationRunInput,
  type RouteGenerationRequest,
  type RouteGenerationRunRecord,
  type RouteGenerationRunRepository
} from './contracts.js'

const routeErrorCodeSchema = z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/)

export interface RouteGenerationDependencies {
  runs: RouteGenerationRunRepository
  goals: GoalRepository
  goalRuns: GoalRunRepository
  goalVerifiers: GoalVerifierRegistry
  trips: TripRepository
  artifacts: ArtifactRepository
  conversations?: ConversationRepository
  connectionSearch: ConnectionSearchService
  flightRoutePlanner: FlightRoutePlanner
  routeOptimizer: RouteOptimizer
  onFailure?: (error: unknown, runId: string) => void
}

export interface StartRouteGenerationInput extends RouteGenerationRequest {
  ownerId: string
  tripId: string
  idempotencyKey: string
  authorizationSource: GoalAuthorizationSource
}

export interface RouteGenerationPipelineResult {
  run: RouteGenerationRunRecord
  created: boolean
}

const failureMessages: Record<string, string> = {
  ROUTE_ORIGIN_REQUIRED: 'A canonical origin airport is required before route generation.',
  DEPARTURE_WINDOW_REQUIRED: 'An approximate departure window is required before route generation.',
  DESTINATION_AIRPORT_REQUIRED: 'At least one canonical visit airport is required before route generation.',
  MULTI_CITY_UNSUPPORTED: 'This route engine currently supports exactly one visit destination per run.',
  ROUND_TRIP_UNSUPPORTED: 'Return routing is not supported by this run; request outbound routing only.',
  GROUND_LEGS_UNSUPPORTED: 'Required rail, bus, ferry, or other ground legs are not supported by this route run.',
  DESTINATION_EXCLUDED: 'The selected destination is excluded by the trip constraints.',
  ORIGIN_DESTINATION_SAME: 'Origin and destination airports must be different.',
  NO_ROUTE_PATHS: 'No route path satisfied the current trip constraints.',
  ROUTE_GENERATION_CANCELLED: 'Route generation was cancelled.',
  TRIP_NOT_FOUND: 'The trip was not found.',
  ROUTE_GENERATION_FAILED: 'Route generation failed.'
}

function failureMessage(code: string): string {
  return failureMessages[code] ?? 'Route generation failed.'
}

function resourceNotFound(message: string): AppError {
  return new AppError('RESOURCE_NOT_FOUND', message, 404)
}

function conflict(message: string, details?: unknown): AppError {
  return new AppError('TRIP_CONTEXT_VERSION_CONFLICT', message, 409, details)
}

function canonicalAirport(value: LocationRef | undefined): value is LocationRef & { type: 'airport'; iata: string } {
  return value?.type === 'airport' && value.iata !== undefined
}

function sameLocation(left: LocationRef, right: LocationRef): boolean {
  return locationRefsOverlap(left, right)
}

function uniqueLocations(values: readonly LocationRef[]): LocationRef[] {
  const output: LocationRef[] = []
  for (const value of values) if (!output.some(existing => sameLocation(existing, value))) output.push(value)
  return output
}

function requestedDestinations(context: TripContext): LocationRef[] {
  const explicitVisits = uniqueLocations(context.locationRoleOverrides.filter(item => item.role === 'visit').map(item => item.location))
  const required = uniqueLocations(context.destinationIntent.required)
  return explicitVisits.length > 0
    ? uniqueLocations([...explicitVisits, ...required])
    : required
}

export type RouteGenerationEligibility =
  | { eligible: true }
  | { eligible: false; code: 'ROUTE_ORIGIN_REQUIRED' | 'DEPARTURE_WINDOW_REQUIRED' | 'DESTINATION_AIRPORT_REQUIRED' | 'MULTI_CITY_UNSUPPORTED' | 'ROUND_TRIP_UNSUPPORTED' | 'GROUND_LEGS_UNSUPPORTED' | 'DESTINATION_EXCLUDED' | 'ORIGIN_DESTINATION_SAME' }

/** Pure supported-scope check shared by action UI hints and the worker. */
export function evaluateRouteGenerationEligibility(context: TripContext): RouteGenerationEligibility {
  if (!canonicalAirport(context.origin)) return { eligible: false, code: 'ROUTE_ORIGIN_REQUIRED' }
  if (!context.departureWindow || (context.departureWindow.from === undefined && context.departureWindow.to === undefined)) {
    return { eligible: false, code: 'DEPARTURE_WINDOW_REQUIRED' }
  }
  if (context.returnWindow !== undefined) return { eligible: false, code: 'ROUND_TRIP_UNSUPPORTED' }
  if (context.requiredGroundLegs.length > 0) return { eligible: false, code: 'GROUND_LEGS_UNSUPPORTED' }
  const requested = requestedDestinations(context)
  if (requested.length === 0 || requested.some(location => !canonicalAirport(location))) {
    return { eligible: false, code: 'DESTINATION_AIRPORT_REQUIRED' }
  }
  if (uniqueLocations(requested).length !== 1) return { eligible: false, code: 'MULTI_CITY_UNSUPPORTED' }
  const destination = requested[0]!
  const excluded = [...context.destinationIntent.excluded, ...context.locationRoleOverrides.filter(item => item.role === 'avoid').map(item => item.location)]
  if (excluded.some(location => sameLocation(location, destination))) return { eligible: false, code: 'DESTINATION_EXCLUDED' }
  if (sameLocation(context.origin, destination)) return { eligible: false, code: 'ORIGIN_DESTINATION_SAME' }
  return { eligible: true }
}

function normalizeWindow(context: TripContext): { from: string; to: string } {
  const window = context.departureWindow
  if (!window || (window.from === undefined && window.to === undefined)) throw new AppError('DEPARTURE_WINDOW_REQUIRED', failureMessage('DEPARTURE_WINDOW_REQUIRED'), 422)
  const from = window.from ?? window.to!
  const to = window.to ?? window.from!
  return { from, to }
}

function routeSelection(context: TripContext): {
  origin: LocationRef & { type: 'airport'; iata: string }
  destination: LocationRef & { type: 'airport'; iata: string }
  requiredLocations: LocationRef[]
  preferredLocations: LocationRef[]
  excludedLocations: LocationRef[]
  window: { from: string; to: string }
  acceptsSelfTransfer: boolean
  acceptsLongStopover: boolean
  acceptsAirportChange: boolean
  warnings: string[]
} {
  const eligibility = evaluateRouteGenerationEligibility(context)
  if (!eligibility.eligible) throw new AppError(eligibility.code, failureMessage(eligibility.code), 422)
  if (!canonicalAirport(context.origin)) throw new AppError('ROUTE_ORIGIN_REQUIRED', failureMessage('ROUTE_ORIGIN_REQUIRED'), 422)
  const origin = context.origin
  const window = normalizeWindow(context)
  const requested = requestedDestinations(context)
  const destinationCandidate = requested[0]
  if (!canonicalAirport(destinationCandidate)) throw new AppError('DESTINATION_AIRPORT_REQUIRED', failureMessage('DESTINATION_AIRPORT_REQUIRED'), 422)
  const destination = destinationCandidate
  const excluded = uniqueLocations([
    ...context.destinationIntent.excluded,
    ...context.locationRoleOverrides.filter(item => item.role === 'avoid').map(item => item.location)
  ])
  if (excluded.some(location => sameLocation(location, destination))) throw new AppError('DESTINATION_EXCLUDED', failureMessage('DESTINATION_EXCLUDED'), 422)
  const preferredLocations = uniqueLocations([
    ...context.destinationIntent.preferred,
    ...context.locationRoleOverrides.filter(item => item.role === 'stopover_only').map(item => item.location)
  ])
  return {
    origin,
    destination,
    requiredLocations: [],
    preferredLocations,
    excludedLocations: excluded,
    window,
    acceptsSelfTransfer: context.transferPreferences.acceptsSelfTransfer ?? false,
    acceptsLongStopover: context.transferPreferences.acceptsLongStopover ?? false,
    acceptsAirportChange: context.transferPreferences.acceptsAirportChange ?? false,
    warnings: []
  }
}

function dedupeWarnings(values: readonly string[]): string[] {
  return [...new Set(values.filter(value => value.trim().length > 0))].slice(0, 40)
}

function ensureRunId(runId: string): string {
  return z.string().uuid().parse(runId)
}

function requestHash(context: TripContext, conversationId: string | undefined, contextVersion: number): string {
  return createHash('sha256').update(JSON.stringify({
    contextVersion,
    conversationId: conversationId ?? null,
    context
  })).digest('hex')
}

function scopedIdempotencyKey(prefix: string, value: string): string {
  return `${prefix}:${createHash('sha256').update(value).digest('hex')}`
}

export async function startRouteGenerationRun(
  dependencies: RouteGenerationDependencies,
  input: StartRouteGenerationInput
): Promise<RouteGenerationPipelineResult> {
  ensureRunId(input.tripId)
  const idempotencyKey = routeGenerationIdempotencyKeySchema.parse(input.idempotencyKey)
  const trip = await dependencies.trips.getTrip(input.tripId)
  if (!trip) throw resourceNotFound('Trip was not found')
  if (input.expectedTripVersion !== undefined && input.expectedTripVersion !== trip.currentContextVersion) {
    throw conflict('Trip context version conflict', { expectedVersion: input.expectedTripVersion, actualVersion: trip.currentContextVersion })
  }
  const eligibility = evaluateRouteGenerationEligibility(trip.context)
  if (!eligibility.eligible) throw new AppError(eligibility.code, failureMessage(eligibility.code), 422)
  if (input.conversationId !== undefined && dependencies.conversations !== undefined) {
    const conversation = await dependencies.conversations.get(input.conversationId)
    if (!conversation || conversation.tripId !== input.tripId) throw resourceNotFound('Conversation was not found')
  }
  let goal: Awaited<ReturnType<GoalRepository['create']>>
  let goalRun: Awaited<ReturnType<GoalRunRepository['create']>>
  try {
    goal = await dependencies.goals.create({
      tripId: input.tripId,
      ...(input.conversationId === undefined ? {} : { conversationId: input.conversationId }),
      kind: 'route_generation',
      parameters: { requestKey: idempotencyKey },
      createdContextVersion: trip.currentContextVersion,
      authorization: { source: input.authorizationSource, grantedAt: new Date().toISOString() },
      idempotencyKey: scopedIdempotencyKey('route-goal', idempotencyKey)
    })
    goalRun = await dependencies.goalRuns.create({
      goalId: goal.goal.id,
      tripId: input.tripId,
      generationId: scopedIdempotencyKey('route-generation', idempotencyKey),
      contextVersion: trip.currentContextVersion,
      contextSnapshot: tripContextSchema.parse(structuredClone(trip.context)),
      idempotencyKey: scopedIdempotencyKey('route-run', idempotencyKey)
    })
  } catch (error) {
    if (isAppError(error) && (error.code === 'GOAL_IDEMPOTENCY_CONFLICT' || error.code === 'GOAL_RUN_IDEMPOTENCY_CONFLICT')) {
      throw new AppError('IDEMPOTENCY_KEY_REUSE', 'Idempotency-Key was already used for a different request', 409)
    }
    throw error
  }
  const createInput: CreateRouteGenerationRunInput = {
    ownerId: input.ownerId, tripId: input.tripId,
    ...(input.conversationId === undefined ? {} : { conversationId: input.conversationId }),
    goalId: goal.goal.id,
    goalRunId: goalRun.run.id,
    idempotencyKey,
    requestHash: requestHash(trip.context, input.conversationId, input.expectedTripVersion ?? trip.currentContextVersion),
    contextVersion: input.expectedTripVersion ?? trip.currentContextVersion,
    contextSnapshot: tripContextSchema.parse(structuredClone(trip.context))
  }
  try {
    return await dependencies.runs.createOrGet(createInput)
  } catch (error) {
    // A deterministic acceptance failure must not leave an orphaned running
    // Goal attempt. Unknown infrastructure failures keep it resumable so an
    // idempotent retry can finish creating the route run.
    if (isAppError(error) && [
      'TRIP_CONTEXT_VERSION_CONFLICT',
      'IDEMPOTENCY_KEY_REUSE',
      'RESOURCE_NOT_FOUND',
      'INVALID_ROUTE_GENERATION_LINEAGE'
    ].includes(error.code)) {
      let currentRun = await dependencies.goalRuns.get(goalRun.run.id)
      if (currentRun?.status === 'running') {
        currentRun = await dependencies.goalRuns.update(currentRun.id, currentRun.revision, { status: 'failed' })
      }
      const currentGoal = await dependencies.goals.get(goal.goal.id)
      if (currentGoal && currentGoal.status !== 'satisfied' && currentGoal.status !== 'cancelled' && currentGoal.status !== 'failed') {
        await dependencies.goals.update(currentGoal.id, currentGoal.revision, { status: 'failed' })
      }
    }
    throw error
  }
}

function verificationOf(value: { verification: VerificationRecord }): VerificationRecord {
  return value.verification
}

function connectionArtifactPayload(result: ConnectionSearchResult, selection: ReturnType<typeof routeSelection>) {
  return routeSetPayloadSchema.parse({
    schemaVersion: 1, kind: 'connection_edges',
    serviceVersion: result.serviceVersion, algorithmVersion: result.serviceVersion, sourceArtifactIds: [...new Set(result.edges.flatMap(edge => edge.fareArtifactId ? [edge.fareArtifactId] : []))].slice(0, 50), verification: verificationOf(result),
    warnings: dedupeWarnings([...selection.warnings, ...result.warnings]),
    truncated: result.truncated, exhausted: result.exhausted,
    query: { origin: selection.origin, destination: selection.destination, window: selection.window },
    edges: result.edges
  })
}

function pathArtifactPayload(result: FlightRoutePlanResult, sourceArtifactId: string) {
  return routeSetPayloadSchema.parse({
    schemaVersion: 1, kind: 'flight_paths',
    serviceVersion: result.serviceVersion, algorithmVersion: result.serviceVersion, sourceArtifactIds: [sourceArtifactId], verification: result.verification,
    warnings: result.warnings, truncated: result.truncated, exhausted: result.exhausted, paths: result.paths
  })
}

function optimizedArtifactPayload(result: RouteOptimizationResult, sourceArtifactId: string) {
  return routeSetPayloadSchema.parse({
    schemaVersion: 1, kind: 'optimized_routes',
    serviceVersion: result.serviceVersion, algorithmVersion: result.algorithmVersion,
    sourceArtifactIds: [sourceArtifactId], verification: result.verification,
    warnings: result.warnings, truncated: result.truncated, exhausted: result.exhausted,
    representatives: result.representatives,
    paretoFrontierCount: result.paretoFrontierCount,
    rejectedCandidateCount: result.rejectedCandidateCount
  })
}

function hasMissingFare(paths: readonly CompleteFlightPath[]): boolean {
  return paths.some(path => path.totalFare === undefined || path.edges.some(edge => edge.fare === undefined || edge.fareArtifactId === undefined))
}

function isCancelled(run: RouteGenerationRunRecord | undefined): run is RouteGenerationRunRecord & { status: 'cancelled' } {
  return run?.status === 'cancelled'
}

function safeFailure(error: unknown): { code: string; message: string } {
  if (isAppError(error) && routeErrorCodeSchema.safeParse(error.code).success && failureMessages[error.code] !== undefined) {
    return { code: error.code, message: failureMessage(error.code) }
  }
  if (error instanceof Error && error.message === 'ROUTE_GENERATION_CANCELLED') return { code: 'ROUTE_GENERATION_CANCELLED', message: failureMessage('ROUTE_GENERATION_CANCELLED') }
  return { code: 'ROUTE_GENERATION_FAILED', message: failureMessage('ROUTE_GENERATION_FAILED') }
}

function artifactWorkingSet(run: GoalRunRecord, records: readonly ArtifactRecord[]): GoalWorkingSet {
  const refs = records.map(record => ({
    id: record.id,
    type: record.type,
    schemaVersion: record.schemaVersion,
    observedAt: record.updatedAt
  }))
  return {
    artifactRefs: [...new Map([...run.workingSet.artifactRefs, ...refs].map(ref => [ref.id, ref])).values()].slice(0, 100),
    locationHandles: run.workingSet.locationHandles
  }
}

async function planningRecords(
  dependencies: RouteGenerationDependencies,
  routeRun: RouteGenerationRunRecord
) {
  if (!routeRun.goalId || !routeRun.goalRunId) return undefined
  const [goal, run] = await Promise.all([
    dependencies.goals.get(routeRun.goalId),
    dependencies.goalRuns.get(routeRun.goalRunId)
  ])
  if (!goal || !run || goal.ownerId !== routeRun.ownerId || run.ownerId !== routeRun.ownerId
    || goal.tripId !== routeRun.tripId || run.tripId !== routeRun.tripId || run.goalId !== goal.id
    || run.contextVersion !== routeRun.contextVersion) {
    throw new AppError('INVALID_ROUTE_GENERATION_LINEAGE', 'Route generation Goal lineage is invalid', 500)
  }
  return { goal, run }
}

async function finishPlanningTerminal(
  dependencies: RouteGenerationDependencies,
  routeRun: RouteGenerationRunRecord,
  status: Extract<GoalStatus, 'failed' | 'cancelled'>
): Promise<void> {
  const lineage = await planningRecords(dependencies, routeRun)
  if (!lineage) return
  let { goal, run } = lineage
  if (run.status === 'running') run = await dependencies.goalRuns.update(run.id, run.revision, { status })
  if (goal.status !== status && goal.status !== 'satisfied' && goal.status !== 'cancelled') {
    goal = await dependencies.goals.update(goal.id, goal.revision, { status })
  }
}

async function finishPlanningWithArtifacts(
  dependencies: RouteGenerationDependencies,
  routeRun: RouteGenerationRunRecord,
  records: readonly ArtifactRecord[]
): Promise<void> {
  const lineage = await planningRecords(dependencies, routeRun)
  if (!lineage) return
  const currentTrip = await dependencies.trips.getTrip(routeRun.tripId)
  const workingSet = artifactWorkingSet(lineage.run, records)
  const runForVerification: GoalRunRecord = { ...lineage.run, workingSet }
  const verification = await dependencies.goalVerifiers.verify(lineage.goal, {
    ownerId: routeRun.ownerId,
    tripId: routeRun.tripId,
    run: runForVerification,
    artifacts: dependencies.artifacts,
    ...(currentTrip ? { currentTrip: currentTrip.context } : {})
  })
  // The route job is terminal. If its frozen context became stale while it ran,
  // preserve the produced evidence but leave the durable Goal explicitly partial.
  const goalStatus: GoalStatus = verification.status === 'pending' ? 'partial' : verification.status
  const runStatus = goalStatus === 'satisfied' ? 'satisfied' : goalStatus === 'partial' ? 'partial' : 'failed'
  if (lineage.run.status === 'running') {
    await dependencies.goalRuns.update(lineage.run.id, lineage.run.revision, { status: runStatus, workingSet })
  }
  if (lineage.goal.status !== goalStatus && lineage.goal.status !== 'satisfied' && lineage.goal.status !== 'cancelled') {
    await dependencies.goals.update(lineage.goal.id, lineage.goal.revision, { status: goalStatus })
  }
}

async function markFailure(dependencies: RouteGenerationDependencies, runId: string, error: unknown, extraWarnings: readonly string[] = []): Promise<RouteGenerationRunRecord | undefined> {
  const current = await dependencies.runs.get(runId)
  if (isCancelled(current)) {
    await finishPlanningTerminal(dependencies, current, 'cancelled')
    return current
  }
  const failure = safeFailure(error)
  const failed = await dependencies.runs.update(runId, {
    status: 'failed', progressStage: 'failed', progressPercent: 100,
    errorCode: failure.code, errorMessage: failure.message,
    warnings: dedupeWarnings([...(current?.warnings ?? []), ...extraWarnings]), finishedAt: new Date().toISOString()
  })
  if (failed?.status === 'cancelled') await finishPlanningTerminal(dependencies, failed, 'cancelled')
  else if (failed?.status === 'failed') await finishPlanningTerminal(dependencies, failed, 'failed')
  return failed
}

export async function cancelRouteGenerationRun(
  dependencies: RouteGenerationDependencies,
  runId: string
): Promise<RouteGenerationRunRecord | undefined> {
  ensureRunId(runId)
  const cancelled = await dependencies.runs.cancel(runId)
  if (cancelled?.status === 'cancelled') await finishPlanningTerminal(dependencies, cancelled, 'cancelled')
  return cancelled
}

async function cancelledBetweenStages(dependencies: RouteGenerationDependencies, runId: string): Promise<boolean> {
  const current = await dependencies.runs.get(runId)
  if (!isCancelled(current)) return false
  await finishPlanningTerminal(dependencies, current, 'cancelled')
  return true
}

async function assertRunActive(dependencies: RouteGenerationDependencies, runId: string): Promise<void> {
  if (await cancelledBetweenStages(dependencies, runId)) throw new Error('ROUTE_GENERATION_CANCELLED')
}

/** Worker-callable pipeline. Job payloads should contain only this public run id. */
export async function executeRouteGenerationRun(
  dependencies: RouteGenerationDependencies,
  runId: string
): Promise<RouteGenerationRunRecord | undefined> {
  ensureRunId(runId)
  const claimed = await dependencies.runs.claim(runId)
  if (claimed === undefined) {
    const current = await dependencies.runs.get(runId)
    if (current?.status === 'cancelled') await finishPlanningTerminal(dependencies, current, 'cancelled')
    if (!current || current.status === 'succeeded' || current.status === 'failed' || current.status === 'cancelled') return current
    if (current.status === 'running') throw new AppError('ROUTE_GENERATION_STUCK', 'Route generation run is already being processed', 409)
    return current
  }
  try {
    const context = tripContextSchema.parse(structuredClone(claimed.contextSnapshot))
    const selection = routeSelection(context)
    if (await cancelledBetweenStages(dependencies, runId)) return dependencies.runs.get(runId)

    const connectionResult = await dependencies.connectionSearch.search({
      origin: selection.origin, destination: selection.destination,
      window: selection.window, preferredLocations: selection.preferredLocations,
      excludedLocations: selection.excludedLocations,
      acceptsSelfTransfer: selection.acceptsSelfTransfer,
      acceptsLongStopover: selection.acceptsLongStopover,
      maxCandidates: 100
    }, { tripId: claimed.tripId, ...(claimed.conversationId ? { conversationId: claimed.conversationId } : {}), checkpoint: () => assertRunActive(dependencies, runId) })
    if (await cancelledBetweenStages(dependencies, runId)) return dependencies.runs.get(runId)
    if (connectionResult.edges.length === 0) {
      return await markFailure(dependencies, runId, new AppError('NO_ROUTE_PATHS', failureMessage('NO_ROUTE_PATHS'), 422), [
        ...selection.warnings, ...connectionResult.warnings
      ])
    }
    await dependencies.runs.update(runId, { progressStage: 'planning_paths', progressPercent: 35 })
    const pathPlan = await dependencies.flightRoutePlanner.plan({
      nodes: [{ location: selection.origin, role: 'origin' }, { location: selection.destination, role: 'destination' }],
      edges: connectionResult.edges, window: selection.window,
      constraints: {
        requiredLocations: selection.requiredLocations,
        excludedLocations: selection.excludedLocations,
        maxTransfers: 4,
        allowSelfTransfer: selection.acceptsSelfTransfer,
        allowAirportChange: selection.acceptsAirportChange,
        allowLongStopover: selection.acceptsLongStopover,
        minTransferMinutes: 45,
        ...(context.travelDays === undefined ? {} : { maxTravelDays: context.travelDays })
      }, maxPaths: 50
    })
    if (await cancelledBetweenStages(dependencies, runId)) return dependencies.runs.get(runId)
    if (pathPlan.paths.length === 0) {
      return await markFailure(dependencies, runId, new AppError('NO_ROUTE_PATHS', failureMessage('NO_ROUTE_PATHS'), 422), [
        ...selection.warnings, ...connectionResult.warnings, ...pathPlan.warnings
      ])
    }
    await dependencies.runs.update(runId, { progressStage: 'optimizing_routes', progressPercent: 60 })
    const optimization = await dependencies.routeOptimizer.optimize({
      paths: pathPlan.paths, weights: {}, preferredLocations: selection.preferredLocations,
      interestLocations: [], maxRepresentatives: 10
    })
    if (await cancelledBetweenStages(dependencies, runId)) return dependencies.runs.get(runId)
    if (optimization.representatives.length === 0) {
      return await markFailure(dependencies, runId, new AppError('NO_ROUTE_PATHS', failureMessage('NO_ROUTE_PATHS'), 422), [
        ...selection.warnings, ...connectionResult.warnings, ...pathPlan.warnings, ...optimization.warnings
      ])
    }

    await dependencies.runs.update(runId, {
      progressStage: routeGenerationProgressStageSchema.parse('persisting_artifacts'), progressPercent: 80,
      warnings: dedupeWarnings([
        ...selection.warnings, ...connectionResult.warnings, ...pathPlan.warnings, ...optimization.warnings,
        ...(hasMissingFare(pathPlan.paths) ? ['Fare evidence is unavailable for one or more route legs; no price is fabricated.'] : [])
      ])
    })
    if (await cancelledBetweenStages(dependencies, runId)) return dependencies.runs.get(runId)

    const connectionPayload = connectionArtifactPayload(connectionResult, selection)
    const connectionArtifact = await dependencies.artifacts.create({
      id: uuidv7(), tripId: claimed.tripId, ...(claimed.conversationId === undefined ? {} : { conversationId: claimed.conversationId }),
      ...(claimed.goalId === undefined ? {} : { goalId: claimed.goalId }),
      ...(claimed.goalRunId === undefined ? {} : { runId: claimed.goalRunId }),
      tripContextVersion: claimed.contextVersion,
      sourceArtifactIds: connectionPayload.sourceArtifactIds,
      type: 'route_set', schemaVersion: 1, payload: connectionPayload, verification: connectionResult.verification
    })
    if (await cancelledBetweenStages(dependencies, runId)) return dependencies.runs.get(runId)
    const pathPayload = pathArtifactPayload(pathPlan, connectionArtifact.id)
    const pathArtifact = await dependencies.artifacts.create({
      id: uuidv7(), tripId: claimed.tripId, ...(claimed.conversationId === undefined ? {} : { conversationId: claimed.conversationId }),
      ...(claimed.goalId === undefined ? {} : { goalId: claimed.goalId }),
      ...(claimed.goalRunId === undefined ? {} : { runId: claimed.goalRunId }),
      tripContextVersion: claimed.contextVersion,
      sourceArtifactIds: pathPayload.sourceArtifactIds,
      type: 'route_set', schemaVersion: 1, payload: pathPayload, verification: pathPlan.verification
    })
    if (await cancelledBetweenStages(dependencies, runId)) return dependencies.runs.get(runId)
    const optimizedPayload = optimizedArtifactPayload(optimization, pathArtifact.id)
    const optimizedArtifact = await dependencies.artifacts.create({
      id: uuidv7(), tripId: claimed.tripId, ...(claimed.conversationId === undefined ? {} : { conversationId: claimed.conversationId }),
      ...(claimed.goalId === undefined ? {} : { goalId: claimed.goalId }),
      ...(claimed.goalRunId === undefined ? {} : { runId: claimed.goalRunId }),
      tripContextVersion: claimed.contextVersion,
      sourceArtifactIds: optimizedPayload.sourceArtifactIds,
      type: 'route_set', schemaVersion: 1, payload: optimizedPayload, verification: optimization.verification
    })
    const current = await dependencies.runs.get(runId)
    if (isCancelled(current)) return current
    const completed = await dependencies.runs.update(runId, {
      status: 'succeeded', progressStage: 'completed', progressPercent: 100,
      resultArtifactId: optimizedArtifact.id,
      warnings: dedupeWarnings([
        ...selection.warnings, ...connectionResult.warnings, ...pathPlan.warnings, ...optimization.warnings,
        ...(hasMissingFare(pathPlan.paths) ? ['Fare evidence is unavailable for one or more route legs; no price is fabricated.'] : [])
      ]), errorCode: null, errorMessage: null, finishedAt: new Date().toISOString()
    })
    if (completed?.status === 'succeeded') {
      await finishPlanningWithArtifacts(dependencies, completed, [connectionArtifact, pathArtifact, optimizedArtifact])
    } else if (completed?.status === 'cancelled') {
      await finishPlanningTerminal(dependencies, completed, 'cancelled')
    }
    return completed
  } catch (error) {
    if (error instanceof Error && error.message === 'ROUTE_GENERATION_CANCELLED') return dependencies.runs.get(runId)
    dependencies.onFailure?.(error, runId)
    return markFailure(dependencies, runId, error)
  }
}
