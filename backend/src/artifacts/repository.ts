import { v7 as uuidv7 } from 'uuid'
import { AppError } from '../lib/errors.js'
import { mergeFinalVariant } from '../travel-guides/finalization-storage.js'
import type { FinalVariant, PublicationLocale } from '../travel-guides/finalization-schema.js'

export const ARTIFACT_TYPES = [
  'flight_search',
  'research',
  'activity',
  'destination_set',
  'route_set',
  'route',
  'travel_guide'
] as const

export type ArtifactType = typeof ARTIFACT_TYPES[number]

export interface ArtifactRecord {
  id: string
  tripId: string
  conversationId?: string
  goalId?: string
  runId?: string
  tripContextVersion?: number
  sourceArtifactIds?: string[]
  type: ArtifactType
  schemaVersion: number
  payload: unknown
  verification?: unknown
  createdAt: string
  updatedAt: string
}

export interface CreateArtifactInput {
  id?: string
  tripId: string
  conversationId?: string
  goalId?: string
  runId?: string
  tripContextVersion?: number
  sourceArtifactIds?: readonly string[]
  type: ArtifactType
  schemaVersion: number
  payload: unknown
  verification?: unknown
  /** Server-owned policy for a narrowly validated cross-version source. */
  isSourceContextCompatible?: (record: ArtifactRecord) => boolean
}

export interface ArtifactScope {
  tripId?: string
  goalId?: string
  runId?: string
  tripContextVersion?: number
}

export interface ArtifactRelationship {
  ownerId: string
  tripId: string
  goalId?: string
  tripContextVersion?: number
  status?: string
}

/** Shared source-envelope policy for both domain composition and atomic repository writes. */
export function assertArtifactContextVersion(record: { tripContextVersion?: number; payload?: unknown }, expectedVersion: number): void {
  if (record.tripContextVersion === undefined) {
    throw new AppError('ARTIFACT_CONTEXT_VERSION_MISSING', 'Source artifact has no Trip Context version; regenerate it before using it as current evidence', 409)
  }
  const payloadVersion = record.payload !== null && typeof record.payload === 'object' && 'tripContextVersion' in record.payload
    ? record.payload.tripContextVersion : undefined
  if (record.tripContextVersion !== expectedVersion
    || (payloadVersion !== undefined && payloadVersion !== record.tripContextVersion)) {
    throw new AppError('ARTIFACT_CONTEXT_VERSION_MISMATCH', 'Source artifact does not match the accepted Trip Context version; re-plan from current inputs', 409)
  }
}

export function assertArtifactSourceContext(
  record: ArtifactRecord,
  expectedVersion: number,
  isCompatible?: (record: ArtifactRecord) => boolean
): void {
  try {
    assertArtifactContextVersion(record, expectedVersion)
  } catch (error) {
    if (!isCompatible?.(record)) throw error
  }
}

export function assertArtifactGoalWritable(status: string): void {
  if (status === 'cancelled' || status === 'satisfied') throw new AppError('GOAL_NOT_RUNNABLE', 'Goal no longer accepts artifact writes', 409)
}

export function assertArtifactRunWritable(status: string): void {
  if (status !== 'running') throw new AppError('GOAL_RUN_NOT_ACTIVE', 'Goal run no longer accepts artifact writes', 409)
}

/** Optional domain lookups for the deterministic in-memory implementation. */
export interface ArtifactRelationshipResolver {
  goal?: (goalId: string) => ArtifactRelationship | Promise<ArtifactRelationship | undefined> | undefined
  run?: (runId: string) => ArtifactRelationship | Promise<ArtifactRelationship | undefined> | undefined
}

export interface ArtifactRepository {
  saveFinalVariant?(id: string, contentHash: string, locale: PublicationLocale, variant: FinalVariant, signal?: AbortSignal): Promise<ArtifactRecord>
  create(input: CreateArtifactInput): Promise<ArtifactRecord>
  /** Atomically records the final artifact on a pre-existing native research audit. */
  createWithResearchAudit?(input: CreateArtifactInput, auditId: string): Promise<ArtifactRecord>
  get(artifactId: string): Promise<ArtifactRecord | undefined>
  listForTrip?(tripId: string, limit?: number): Promise<ArtifactRecord[]>
  listForGoal(goalId: string, limit?: number): Promise<ArtifactRecord[]>
  listForRun(runId: string, limit?: number): Promise<ArtifactRecord[]>
  getForScope(artifactId: string, scope: ArtifactScope): Promise<ArtifactRecord | undefined>
}

interface OwnedArtifact extends ArtifactRecord { ownerId: string }

export class InMemoryArtifactRepository implements ArtifactRepository {
  async saveFinalVariant(id: string, hash: string, locale: PublicationLocale, variant: FinalVariant, signal?: AbortSignal): Promise<ArtifactRecord> {
    const record = await this.get(id)
    if (!record) throw new AppError('RESOURCE_NOT_FOUND', 'Artifact not found', 404)
    const current = this.records.get(id)!
    signal?.throwIfAborted()
    const payload = mergeFinalVariant(current, hash, locale, variant)
    this.records.set(id, { ...current, payload, updatedAt: new Date().toISOString() })
    return (await this.get(id))!
  }
  private readonly records: Map<string, OwnedArtifact>

  constructor(
    private readonly ownerId: string,
    private readonly ownedTripIds: Set<string>,
    sharedRecords: Map<string, OwnedArtifact> = new Map(),
    private readonly relationships: ArtifactRelationshipResolver = {}
  ) {
    this.records = sharedRecords
  }

  async create(input: CreateArtifactInput): Promise<ArtifactRecord> {
    if (!this.ownedTripIds.has(input.tripId)) throw new AppError('RESOURCE_NOT_FOUND', 'Trip was not found', 404)
    if (!Number.isInteger(input.schemaVersion) || input.schemaVersion < 1) {
      throw new AppError('INVALID_ARTIFACT', 'Artifact schema version must be positive')
    }
    if (input.tripContextVersion !== undefined && (!Number.isInteger(input.tripContextVersion) || input.tripContextVersion < 0)) {
      throw new AppError('INVALID_ARTIFACT', 'Artifact Trip Context version must be non-negative')
    }
    if (input.runId !== undefined && input.goalId === undefined) {
      throw new AppError('INVALID_ARTIFACT', 'Artifact goalId is required when runId is provided')
    }
    const sourceArtifactIds = normalizeSourceArtifactIds(input.sourceArtifactIds)
    if (input.id !== undefined && sourceArtifactIds.includes(input.id)) {
      throw new AppError('INVALID_ARTIFACT', 'Artifact cannot reference itself')
    }
    for (const sourceId of sourceArtifactIds) {
      const source = this.records.get(sourceId)
      if (!source || source.ownerId !== this.ownerId || source.tripId !== input.tripId) {
        throw new AppError('RESOURCE_NOT_FOUND', 'Source artifact was not found', 404)
      }
      if (input.tripContextVersion !== undefined) {
        const { ownerId: _ownerId, ...publicSource } = source
        assertArtifactSourceContext(publicSource, input.tripContextVersion, input.isSourceContextCompatible)
      }
    }
    await this.validateRelationships(input)
    const now = new Date().toISOString()
    const record: OwnedArtifact = {
      id: input.id ?? uuidv7(), ownerId: this.ownerId, tripId: input.tripId,
      ...(input.conversationId ? { conversationId: input.conversationId } : {}),
      ...(input.goalId ? { goalId: input.goalId } : {}),
      ...(input.runId ? { runId: input.runId } : {}),
      ...(input.tripContextVersion === undefined ? {} : { tripContextVersion: input.tripContextVersion }),
      sourceArtifactIds,
      type: input.type, schemaVersion: input.schemaVersion,
      payload: structuredClone(input.payload),
      ...(input.verification === undefined ? {} : { verification: structuredClone(input.verification) }),
      createdAt: now, updatedAt: now
    }
    this.records.set(record.id, record)
    const { ownerId: _ownerId, ...publicRecord } = record
    return structuredClone(publicRecord)
  }

  /** Test double: production uses PostgresArtifactRepository's transaction-backed link. */
  async createWithResearchAudit(input: CreateArtifactInput, auditId: string): Promise<ArtifactRecord> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(auditId)) {
      throw new AppError('INVALID_RESEARCH_AUDIT', 'Research audit id is invalid', 400)
    }
    return this.create(input)
  }

  async get(artifactId: string): Promise<ArtifactRecord | undefined> {
    const record = this.records.get(artifactId)
    if (!record || record.ownerId !== this.ownerId) return undefined
    const { ownerId: _ownerId, ...publicRecord } = record
    return structuredClone(publicRecord)
  }

  async getForScope(artifactId: string, scope: ArtifactScope): Promise<ArtifactRecord | undefined> {
    const record = await this.get(artifactId)
    return record && matchesScope(record, scope) ? record : undefined
  }

  async listForTrip(tripId: string, limit = 10): Promise<ArtifactRecord[]> {
    if (!this.ownedTripIds.has(tripId)) return []
    return [...this.records.values()].filter(record => record.ownerId === this.ownerId && record.tripId === tripId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)).slice(0, boundedLimit(limit))
      .map(({ ownerId: _owner, ...record }) => structuredClone(record))
  }

  async listForGoal(goalId: string, limit = 10): Promise<ArtifactRecord[]> {
    return this.listScoped(record => record.goalId === goalId, limit)
  }

  async listForRun(runId: string, limit = 10): Promise<ArtifactRecord[]> {
    return this.listScoped(record => record.runId === runId, limit)
  }

  private async listScoped(predicate: (record: ArtifactRecord) => boolean, limit: number): Promise<ArtifactRecord[]> {
    return [...this.records.values()]
      .filter(record => record.ownerId === this.ownerId && predicate(record))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
      .slice(0, boundedLimit(limit))
      .map(({ ownerId: _owner, ...record }) => structuredClone(record))
  }

  private async validateRelationships(input: CreateArtifactInput): Promise<void> {
    if (input.goalId !== undefined && this.relationships.goal !== undefined) {
      const goal = await this.relationships.goal(input.goalId)
      if (!goal || goal.ownerId !== this.ownerId || goal.tripId !== input.tripId) throw new AppError('RESOURCE_NOT_FOUND', 'Goal was not found', 404)
      if (goal.status !== undefined) assertArtifactGoalWritable(goal.status)
    }
    if (input.runId !== undefined && this.relationships.run !== undefined) {
      const run = await this.relationships.run(input.runId)
      if (!run || run.ownerId !== this.ownerId || run.tripId !== input.tripId || (input.goalId !== undefined && run.goalId !== input.goalId)) {
        throw new AppError('RESOURCE_NOT_FOUND', 'Goal run was not found', 404)
      }
      if (input.tripContextVersion !== undefined && run.tripContextVersion !== undefined && input.tripContextVersion !== run.tripContextVersion) {
        throw new AppError('TRIP_CONTEXT_VERSION_CONFLICT', 'Artifact Trip Context version does not match goal run', 409)
      }
      if (run.status !== undefined) assertArtifactRunWritable(run.status)
    }
  }
}

function boundedLimit(value: number): number {
  return Number.isFinite(value) ? Math.min(100, Math.max(1, Math.floor(value))) : 10
}

export function normalizeSourceArtifactIds(values: readonly string[] | undefined): string[] {
  const result = [...new Set(values ?? [])]
  if (result.some(value => typeof value !== 'string' || value.trim().length === 0 || value.length > 160)) {
    throw new AppError('INVALID_ARTIFACT', 'Source artifact ids must be non-empty and bounded')
  }
  if (result.length > 50) throw new AppError('INVALID_ARTIFACT', 'Too many source artifact ids')
  return result
}

function matchesScope(record: ArtifactRecord, scope: ArtifactScope): boolean {
  return (scope.tripId === undefined || record.tripId === scope.tripId)
    && (scope.goalId === undefined || record.goalId === scope.goalId)
    && (scope.runId === undefined || record.runId === scope.runId)
    && (scope.tripContextVersion === undefined || record.tripContextVersion === scope.tripContextVersion)
}
