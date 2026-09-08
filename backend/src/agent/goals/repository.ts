import { createHash } from 'node:crypto'
import { v7 as uuidv7 } from 'uuid'
import { z } from 'zod'
import { AppError } from '../../lib/errors.js'
import {
  createGoalInputSchema,
  createGoalRunInputSchema,
  goalRecordSchema,
  goalRunRecordSchema,
  goalRunStatusUpdateSchema,
  goalRunStatusSchema,
  goalStatusUpdateSchema,
  type CreateGoalInput,
  type CreateGoalRunInput,
  type GoalRecord,
  type GoalRunRecord,
  type GoalRunStatus,
  type GoalRunStatusUpdate,
  type GoalStatusUpdate
} from './types.js'

export class GoalRevisionConflict extends AppError {
  constructor(readonly expectedRevision: number, readonly actualRevision: number) {
    super('GOAL_REVISION_CONFLICT', 'Goal revision conflict', 409, { expectedRevision, actualRevision })
    this.name = 'GoalRevisionConflict'
  }
}

export class GoalRunRevisionConflict extends AppError {
  constructor(readonly expectedRevision: number, readonly actualRevision: number) {
    super('GOAL_RUN_REVISION_CONFLICT', 'Goal run revision conflict', 409, { expectedRevision, actualRevision })
    this.name = 'GoalRunRevisionConflict'
  }
}

export class GoalIdempotencyConflict extends AppError {
  constructor() {
    super('GOAL_IDEMPOTENCY_CONFLICT', 'Goal idempotency key is already bound to different input', 409)
    this.name = 'GoalIdempotencyConflict'
  }
}

export class GoalRunIdempotencyConflict extends AppError {
  constructor() {
    super('GOAL_RUN_IDEMPOTENCY_CONFLICT', 'Goal run idempotency key is already bound to different input', 409)
    this.name = 'GoalRunIdempotencyConflict'
  }
}

export class GoalStatusConflict extends AppError {
  constructor(status: string, nextStatus: string) {
    super('GOAL_STATUS_CONFLICT', `Goal cannot transition from ${status} to ${nextStatus}`, 409)
    this.name = 'GoalStatusConflict'
  }
}

export class GoalRunStatusConflict extends AppError {
  constructor(status: string, nextStatus: string) {
    super('GOAL_RUN_STATUS_CONFLICT', `Goal run cannot transition from ${status} to ${nextStatus}`, 409)
    this.name = 'GoalRunStatusConflict'
  }
}

export interface GoalRepository {
  create(input: CreateGoalInput): Promise<{ goal: GoalRecord; created: boolean }>
  get(goalId: string): Promise<GoalRecord | undefined>
  listForTrip(tripId: string): Promise<GoalRecord[]>
  update(goalId: string, expectedRevision: number, patch: GoalStatusUpdate): Promise<GoalRecord>
}

export interface GoalRunCompatibilityQuery {
  goalId: string
  tripId: string
  contextVersion: number
  statuses?: readonly GoalRunStatus[]
}

export interface GoalRunRepository {
  create(input: CreateGoalRunInput): Promise<{ run: GoalRunRecord; created: boolean }>
  get(runId: string): Promise<GoalRunRecord | undefined>
  listForGoal(goalId: string): Promise<GoalRunRecord[]>
  latestCompatible(query: GoalRunCompatibilityQuery): Promise<GoalRunRecord | undefined>
  update(runId: string, expectedRevision: number, patch: GoalRunStatusUpdate): Promise<GoalRunRecord>
  commitCompletion(input: GoalCompletionInput): Promise<GoalCompletionResult>
}

export const goalCompletionInputSchema = z.object({
  goalId: z.string().uuid(),
  runId: z.string().uuid(),
  expectedGoalRevision: z.number().int().nonnegative(),
  expectedRunRevision: z.number().int().nonnegative(),
  goalStatus: z.enum(['satisfied', 'partial', 'failed', 'cancelled']),
  runStatus: goalRunStatusSchema,
  currentTripVersion: z.number().int().nonnegative().optional()
}).strict()
export type GoalCompletionInput = z.infer<typeof goalCompletionInputSchema>
export interface GoalCompletionResult { goal: GoalRecord; run: GoalRunRecord }

/** Validate both aggregates before either repository changes state. */
export function planGoalCompletion(
  goal: GoalRecord,
  run: GoalRunRecord,
  input: GoalCompletionInput,
  now: string,
  actualTripVersion?: number
): GoalCompletionResult {
  if (goal.id !== input.goalId || run.id !== input.runId || run.goalId !== goal.id
    || run.ownerId !== goal.ownerId || run.tripId !== goal.tripId) throw new AppError('RESOURCE_NOT_FOUND', 'Goal run was not found', 404)
  if (input.goalStatus === 'satisfied' && input.currentTripVersion === undefined) {
    throw new AppError('TRIP_CONTEXT_VERSION_REQUIRED', 'Successful completion requires the verified Trip version', 409)
  }
  if (input.currentTripVersion !== undefined && actualTripVersion !== undefined && input.currentTripVersion !== actualTripVersion) {
    throw new AppError('TRIP_CONTEXT_VERSION_CONFLICT', 'Trip changed before Goal completion', 409,
      { expectedVersion: input.currentTripVersion, actualVersion: actualTripVersion })
  }
  if (input.goalStatus === 'satisfied' && goal.kind !== 'trip_context_update'
    && input.currentTripVersion !== undefined && run.contextVersion !== input.currentTripVersion) {
    throw new AppError('TRIP_CONTEXT_VERSION_CONFLICT', 'Goal run no longer matches the accepted Trip', 409)
  }
  const keepsRunning = input.goalStatus === 'partial' && input.runStatus === 'running'
  const preservesCancelledHistory = input.goalStatus === 'cancelled' && run.status !== 'running' && input.runStatus === run.status
  if (input.goalStatus !== input.runStatus && !keepsRunning && !preservesCancelledHistory) {
    throw new AppError('GOAL_COMPLETION_STATUS_MISMATCH', 'Goal and run completion statuses are inconsistent', 409)
  }
  // A transport retry after the transaction committed is a read, not another revision.
  if (goal.status === input.goalStatus && run.status === input.runStatus
    && goal.revision >= input.expectedGoalRevision && run.revision >= input.expectedRunRevision) return { goal, run }
  if (goal.revision !== input.expectedGoalRevision) throw new GoalRevisionConflict(input.expectedGoalRevision, goal.revision)
  if (run.revision !== input.expectedRunRevision) throw new GoalRunRevisionConflict(input.expectedRunRevision, run.revision)
  if (!canGoalTransition(goal.status, input.goalStatus)) throw new GoalStatusConflict(goal.status, input.goalStatus)
  if (!canRunTransition(run.status, input.runStatus)) throw new GoalRunStatusConflict(run.status, input.runStatus)
  return {
    goal: goalRecordSchema.parse({ ...goal, status: input.goalStatus, revision: goal.revision + Number(goal.status !== input.goalStatus),
      updatedAt: goal.status === input.goalStatus ? goal.updatedAt : now }),
    run: goalRunRecordSchema.parse({ ...run, status: input.runStatus, revision: run.revision + Number(run.status !== input.runStatus),
      updatedAt: run.status === input.runStatus ? run.updatedAt : now })
  }
}

export function selectLatestCompatibleRun(
  runs: readonly GoalRunRecord[],
  query: GoalRunCompatibilityQuery
): GoalRunRecord | undefined {
  const statuses = new Set(query.statuses ?? ['running', 'satisfied', 'partial'])
  return [...runs]
    .filter(run => run.goalId === query.goalId && run.tripId === query.tripId
      && run.contextVersion === query.contextVersion && statuses.has(run.status))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id))[0]
}

interface StoredGoal extends GoalRecord {
  idempotencyKey: string
  requestFingerprint: string
}

interface StoredGoalRun extends GoalRunRecord {
  idempotencyKey: string
  requestFingerprint: string
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonicalize(item)]))
  }
  return value
}

export function canonicalFingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex')
}

function goalFingerprint(input: CreateGoalInput): string {
  return canonicalFingerprint({
    tripId: input.tripId,
    conversationId: input.conversationId,
    kind: input.kind,
    parameters: input.parameters,
    // grantedAt is server-observed metadata and changes on a transport retry.
    // The authorization source is the idempotent request fact.
    authorizationSource: input.authorization?.source
  })
}

function runFingerprint(input: CreateGoalRunInput): string {
  return canonicalFingerprint({
    goalId: input.goalId,
    tripId: input.tripId,
    contextVersion: input.contextVersion,
    contextSnapshot: input.contextSnapshot
  })
}

export function canGoalTransition(status: GoalRecord['status'], nextStatus: GoalRecord['status']): boolean {
  if (status === nextStatus) return true
  if (status === 'satisfied' || status === 'cancelled') return false
  if (status === 'pending') return true
  if (status === 'failed') return nextStatus === 'satisfied' || nextStatus === 'partial' || nextStatus === 'cancelled'
  return nextStatus === 'satisfied' || nextStatus === 'failed' || nextStatus === 'cancelled'
}

export function canRunTransition(status: GoalRunStatus, nextStatus: GoalRunStatus): boolean {
  if (status === nextStatus) return true
  return status === 'running'
}

function cloneGoal(goal: StoredGoal): GoalRecord {
  return structuredClone(goalRecordSchema.parse(publicGoalFields(goal)))
}

function cloneRun(run: StoredGoalRun): GoalRunRecord {
  return structuredClone(goalRunRecordSchema.parse(publicRunFields(run)))
}

function publicGoalFields(goal: StoredGoal): GoalRecord {
  const { idempotencyKey: _idempotencyKey, requestFingerprint: _requestFingerprint, ...publicGoal } = goal
  return publicGoal
}

function publicRunFields(run: StoredGoalRun): GoalRunRecord {
  const { idempotencyKey: _idempotencyKey, requestFingerprint: _requestFingerprint, ...publicRun } = run
  return publicRun
}

export class InMemoryGoalRepository implements GoalRepository {
  private readonly goals: Map<string, StoredGoal>

  constructor(
    private readonly ownerId: string,
    sharedGoals: Map<string, StoredGoal> = new Map()
  ) {
    this.goals = sharedGoals
  }

  async create(rawInput: CreateGoalInput): Promise<{ goal: GoalRecord; created: boolean }> {
    const input = createGoalInputSchema.parse(rawInput)
    const requestFingerprint = goalFingerprint(input)
    const existing = [...this.goals.values()].find(goal => goal.ownerId === this.ownerId && goal.tripId === input.tripId && goal.idempotencyKey === input.idempotencyKey)
    if (existing) {
      if (existing.requestFingerprint !== requestFingerprint) throw new GoalIdempotencyConflict()
      return { goal: cloneGoal(existing), created: false }
    }
    const now = new Date().toISOString()
    const goal = goalRecordSchema.parse({
      id: input.id ?? uuidv7(), ownerId: this.ownerId, tripId: input.tripId,
      ...(input.conversationId ? { conversationId: input.conversationId } : {}),
      kind: input.kind, status: 'pending', parameters: input.parameters,
      createdContextVersion: input.createdContextVersion,
      ...(input.authorization ? { authorization: input.authorization } : {}),
      revision: 0, createdAt: now, updatedAt: now
    })
    const stored: StoredGoal = { ...goal, idempotencyKey: input.idempotencyKey, requestFingerprint }
    this.goals.set(goal.id, stored)
    return { goal: cloneGoal(stored), created: true }
  }

  async get(goalId: string): Promise<GoalRecord | undefined> {
    const goal = this.goals.get(goalId)
    return goal?.ownerId === this.ownerId ? cloneGoal(goal) : undefined
  }

  async listForTrip(tripId: string): Promise<GoalRecord[]> {
    return [...this.goals.values()]
      .filter(goal => goal.ownerId === this.ownerId && goal.tripId === tripId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id))
      .map(cloneGoal)
  }

  async update(goalId: string, expectedRevision: number, rawPatch: GoalStatusUpdate): Promise<GoalRecord> {
    const patch = goalStatusUpdateSchema.parse(rawPatch)
    const goal = this.goals.get(goalId)
    if (!goal || goal.ownerId !== this.ownerId) throw new AppError('RESOURCE_NOT_FOUND', 'Goal was not found', 404)
    if (goal.revision !== expectedRevision) throw new GoalRevisionConflict(expectedRevision, goal.revision)
    if (!canGoalTransition(goal.status, patch.status)) throw new GoalStatusConflict(goal.status, patch.status)
    const next = goalRecordSchema.parse({
      ...publicGoalFields(goal),
      status: patch.status,
      revision: goal.revision + 1,
      updatedAt: new Date().toISOString()
    })
    const stored: StoredGoal = { ...next, idempotencyKey: goal.idempotencyKey, requestFingerprint: goal.requestFingerprint }
    this.goals.set(goal.id, stored)
    return cloneGoal(stored)
  }

  /** Synchronous, completion-specific coordinator; the callback only commits the prepared in-memory run. */
  commitRunCompletion(input: GoalCompletionInput, run: StoredGoalRun, writeRun: (run: StoredGoalRun) => void, actualTripVersion?: number): GoalCompletionResult {
    const goal = this.goals.get(input.goalId)
    if (!goal || goal.ownerId !== this.ownerId) throw new AppError('RESOURCE_NOT_FOUND', 'Goal was not found', 404)
    const result = planGoalCompletion(cloneGoal(goal), cloneRun(run), input, new Date().toISOString(), actualTripVersion)
    const nextGoal = { ...goal, ...result.goal }
    const nextRun = { ...run, ...result.run }
    // All validation/cloning occurs before this uninterrupted pair of Map writes.
    const output = structuredClone(result)
    writeRun(nextRun)
    this.goals.set(goal.id, nextGoal)
    return output
  }
}

export class InMemoryGoalRunRepository implements GoalRunRepository {
  private readonly runs: Map<string, StoredGoalRun>

  constructor(
    private readonly ownerId: string,
    private readonly goals: GoalRepository,
    sharedRuns: Map<string, StoredGoalRun> = new Map(),
    private readonly currentTripVersion?: (tripId: string) => number | undefined
  ) {
    this.runs = sharedRuns
  }

  async create(rawInput: CreateGoalRunInput): Promise<{ run: GoalRunRecord; created: boolean }> {
    const input = createGoalRunInputSchema.parse(rawInput)
    const requestFingerprint = runFingerprint(input)
    const existing = [...this.runs.values()].find(run => run.ownerId === this.ownerId && run.goalId === input.goalId && run.idempotencyKey === input.idempotencyKey)
    if (existing) {
      if (existing.requestFingerprint !== requestFingerprint) throw new GoalRunIdempotencyConflict()
      return { run: cloneRun(existing), created: false }
    }
    const goal = await this.goals.get(input.goalId)
    if (!goal || goal.ownerId !== this.ownerId || goal.tripId !== input.tripId) throw new AppError('RESOURCE_NOT_FOUND', 'Goal was not found', 404)
    if (goal.status === 'cancelled' || goal.status === 'satisfied') throw new AppError('GOAL_NOT_RUNNABLE', 'Goal is not runnable', 409)
    if ([...this.runs.values()].some(run => run.ownerId === this.ownerId && run.goalId === input.goalId && run.status === 'running')) {
      throw new AppError('GOAL_RUN_ALREADY_RUNNING', 'Goal already has a running execution', 409)
    }
    const now = new Date().toISOString()
    const run = goalRunRecordSchema.parse({
      id: input.id ?? uuidv7(), ownerId: this.ownerId, goalId: input.goalId,
      tripId: input.tripId, generationId: input.generationId,
      contextVersion: input.contextVersion, contextSnapshot: input.contextSnapshot,
      status: 'running', workingSet: { artifactRefs: [], locationHandles: [] },
      revision: 0, createdAt: now, updatedAt: now
    })
    const stored: StoredGoalRun = { ...run, idempotencyKey: input.idempotencyKey, requestFingerprint }
    this.runs.set(run.id, stored)
    return { run: cloneRun(stored), created: true }
  }

  async get(runId: string): Promise<GoalRunRecord | undefined> {
    const run = this.runs.get(runId)
    return run?.ownerId === this.ownerId ? cloneRun(run) : undefined
  }

  async listForGoal(goalId: string): Promise<GoalRunRecord[]> {
    return [...this.runs.values()]
      .filter(run => run.ownerId === this.ownerId && run.goalId === goalId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id))
      .map(cloneRun)
  }

  async latestCompatible(query: GoalRunCompatibilityQuery): Promise<GoalRunRecord | undefined> {
    const runs = await this.listForGoal(query.goalId)
    return selectLatestCompatibleRun(runs, query)
  }

  async update(runId: string, expectedRevision: number, rawPatch: GoalRunStatusUpdate): Promise<GoalRunRecord> {
    const patch = goalRunStatusUpdateSchema.parse(rawPatch)
    const run = this.runs.get(runId)
    if (!run || run.ownerId !== this.ownerId) throw new AppError('RESOURCE_NOT_FOUND', 'Goal run was not found', 404)
    if (run.revision !== expectedRevision) throw new GoalRunRevisionConflict(expectedRevision, run.revision)
    if (!canRunTransition(run.status, patch.status)) throw new GoalRunStatusConflict(run.status, patch.status)
    if (run.status !== 'running' && patch.workingSet !== undefined) throw new GoalRunStatusConflict(run.status, patch.status)
    const next = goalRunRecordSchema.parse({
      ...publicRunFields(run),
      status: patch.status,
      ...(patch.workingSet ? { workingSet: patch.workingSet } : {}),
      revision: run.revision + 1,
      updatedAt: new Date().toISOString()
    })
    const stored: StoredGoalRun = { ...next, idempotencyKey: run.idempotencyKey, requestFingerprint: run.requestFingerprint }
    this.runs.set(run.id, stored)
    return cloneRun(stored)
  }

  async commitCompletion(rawInput: GoalCompletionInput): Promise<GoalCompletionResult> {
    const input = goalCompletionInputSchema.parse(rawInput)
    const run = this.runs.get(input.runId)
    if (!run || run.ownerId !== this.ownerId) throw new AppError('RESOURCE_NOT_FOUND', 'Goal run was not found', 404)
    if (!(this.goals instanceof InMemoryGoalRepository)) {
      throw new AppError('GOAL_COMPLETION_UNAVAILABLE', 'In-memory completion requires its matching Goal repository', 503)
    }
    const currentVersion = this.currentTripVersion?.(run.tripId)
    if (this.currentTripVersion && currentVersion === undefined) throw new AppError('RESOURCE_NOT_FOUND', 'Trip was not found', 404)
    return this.goals.commitRunCompletion(input, run, next => this.runs.set(next.id, next), currentVersion)
  }
}
