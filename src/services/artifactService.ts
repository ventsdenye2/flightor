import { request } from '../utils/request'
import type { CloudArtifactRef } from './conversationService'
import { readAirportTimePresentation, type AirportTimePresentation } from './airportTime'

/**
 * The API returns complete artifacts only from the owner-scoped endpoint. The
 * conversation and history stores should keep CloudArtifactRef instead.
 */
export interface ArtifactEnvelope {
  id: string
  tripId: string
  conversationId?: string
  type: string
  schemaVersion: number
  payload: unknown
  presentation?: AirportTimePresentation
  verification?: unknown
  createdAt: string
  updatedAt: string
}

/** Reuse the compact conversation reference; complete payloads stay remote. */
export type ArtifactRefLike = CloudArtifactRef

export interface ArtifactFetchContext {
  /** Stable authenticated owner identifier used to invalidate local cache. */
  ownerId?: string
  /** Stable local auth/session identifier used to ignore late responses. */
  sessionId?: string
  force?: boolean
}

export class ArtifactValidationError extends Error {
  readonly code = 'INVALID_ARTIFACT_ENVELOPE'

  constructor(message: string) {
    super(message)
    this.name = 'ArtifactValidationError'
  }
}

export class ArtifactSessionChangedError extends Error {
  readonly code = 'ARTIFACT_SESSION_CHANGED'

  constructor() {
    super('Artifact response belongs to a previous owner or session')
    this.name = 'ArtifactSessionChangedError'
  }
}

const MAX_ARTIFACT_CACHE_ENTRIES = 24
const MAX_ID_LENGTH = 160
const MAX_TYPE_LENGTH = 64
const MAX_TIMESTAMP_LENGTH = 64

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function boundedString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max
}

function validTimestamp(value: unknown): value is string {
  return boundedString(value, MAX_TIMESTAMP_LENGTH) && Number.isFinite(Date.parse(value))
}

function validOptionalId(value: unknown): value is string | undefined {
  return value === undefined || boundedString(value, MAX_ID_LENGTH)
}

/** Validate only the common server envelope; payload-specific checks belong to the registry. */
export function validateArtifactEnvelope(value: unknown): ArtifactEnvelope {
  if (!isRecord(value)) throw new ArtifactValidationError('Artifact response is not an object')
  if (!boundedString(value.id, MAX_ID_LENGTH)) throw new ArtifactValidationError('Artifact id is missing or too long')
  if (!boundedString(value.tripId, MAX_ID_LENGTH)) throw new ArtifactValidationError('Artifact tripId is missing or too long')
  if (!boundedString(value.type, MAX_TYPE_LENGTH)) throw new ArtifactValidationError('Artifact type is missing or too long')
  if (!Number.isInteger(value.schemaVersion) || Number(value.schemaVersion) < 1 || Number(value.schemaVersion) > 1000) {
    throw new ArtifactValidationError('Artifact schemaVersion is outside the supported bounds')
  }
  const schemaVersion = Number(value.schemaVersion)
  const presentation = readAirportTimePresentation(value.presentation)
  if (!isRecord(value.payload)) throw new ArtifactValidationError('Artifact payload must be an object')
  if (!validOptionalId(value.conversationId)) throw new ArtifactValidationError('Artifact conversationId is invalid')
  if (!validTimestamp(value.createdAt) || !validTimestamp(value.updatedAt)) {
    throw new ArtifactValidationError('Artifact timestamps are invalid')
  }

  return {
    id: value.id,
    tripId: value.tripId,
    ...(value.conversationId === undefined ? {} : { conversationId: value.conversationId }),
    type: value.type,
    schemaVersion,
    payload: value.payload,
    ...(presentation ? { presentation } : {}),
    ...(value.verification === undefined ? {} : { verification: value.verification }),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt
  }
}

export class BoundedArtifactCache {
  private readonly values = new Map<string, ArtifactEnvelope>()
  private identity = ''

  get sessionIdentity(): string { return this.identity }
  get size(): number { return this.values.size }

  setSession(ownerId?: string, sessionId?: string): void {
    const next = `${ownerId ?? ''}\u0000${sessionId ?? ''}`
    if (next !== this.identity) {
      this.identity = next
      this.values.clear()
    }
  }

  get(id: string): ArtifactEnvelope | undefined {
    const value = this.values.get(id)
    if (value !== undefined) {
      // Refresh insertion order for a small LRU-like bound.
      this.values.delete(id)
      this.values.set(id, value)
    }
    return value
  }

  set(id: string, value: ArtifactEnvelope): void {
    this.values.delete(id)
    this.values.set(id, value)
    while (this.values.size > MAX_ARTIFACT_CACHE_ENTRIES) {
      const oldest = this.values.keys().next().value as string | undefined
      if (oldest === undefined) break
      this.values.delete(oldest)
    }
  }

  clear(): void { this.values.clear() }
}

export const artifactCache = new BoundedArtifactCache()

export interface ArtifactRequestTransport {
  <T>(options: { url: string; method?: 'GET'; retry?: number; timeout?: number }): Promise<T>
}

export class ArtifactService {
  private readonly cache: BoundedArtifactCache

  constructor(
    private readonly transport: ArtifactRequestTransport = request,
    cache: BoundedArtifactCache = new BoundedArtifactCache()
  ) {
    this.cache = cache
  }

  setSession(ownerId?: string, sessionId?: string): void {
    this.cache.setSession(ownerId, sessionId)
  }

  clearCache(): void { this.cache.clear() }

  async fetchArtifact(id: string, context: ArtifactFetchContext = {}): Promise<ArtifactEnvelope> {
    if (!boundedString(id, MAX_ID_LENGTH)) throw new ArtifactValidationError('Artifact id is missing or too long')
    // Callers may establish identity once with setSession and omit it on each
    // read. An explicit owner/session field is still enough to rotate it.
    if (context.ownerId !== undefined || context.sessionId !== undefined) {
      this.cache.setSession(context.ownerId, context.sessionId)
    }
    const identity = this.cache.sessionIdentity
    if (!context.force) {
      const cached = this.cache.get(id)
      if (cached) return cached
    }

    const response = await this.transport<{ artifact: unknown }>({
      url: `/v1/artifacts/${encodeURIComponent(id)}`,
      method: 'GET',
      retry: 1,
      timeout: 15000
    })
    if (identity !== this.cache.sessionIdentity) throw new ArtifactSessionChangedError()
    if (!isRecord(response) || !('artifact' in response)) throw new ArtifactValidationError('Artifact response envelope is missing')
    const artifact = validateArtifactEnvelope(response.artifact)
    this.cache.set(artifact.id, artifact)
    return artifact
  }
}

export const artifactService = new ArtifactService()
export const fetchArtifact = (id: string, context?: ArtifactFetchContext): Promise<ArtifactEnvelope> => artifactService.fetchArtifact(id, context)

export const ARTIFACT_CACHE_LIMIT = MAX_ARTIFACT_CACHE_ENTRIES
