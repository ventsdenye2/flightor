import { v7 as uuidv7 } from 'uuid'
import { AppError } from '../lib/errors.js'

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
  type: ArtifactType
  schemaVersion: number
  payload: unknown
  verification?: unknown
}

export interface ArtifactRepository {
  create(input: CreateArtifactInput): Promise<ArtifactRecord>
  get(artifactId: string): Promise<ArtifactRecord | undefined>
}

interface OwnedArtifact extends ArtifactRecord { ownerId: string }

export class InMemoryArtifactRepository implements ArtifactRepository {
  private readonly records: Map<string, OwnedArtifact>

  constructor(
    private readonly ownerId: string,
    private readonly ownedTripIds: Set<string>,
    sharedRecords: Map<string, OwnedArtifact> = new Map()
  ) {
    this.records = sharedRecords
  }

  async create(input: CreateArtifactInput): Promise<ArtifactRecord> {
    if (!this.ownedTripIds.has(input.tripId)) throw new AppError('RESOURCE_NOT_FOUND', 'Trip was not found', 404)
    if (!Number.isInteger(input.schemaVersion) || input.schemaVersion < 1) {
      throw new AppError('INVALID_ARTIFACT', 'Artifact schema version must be positive')
    }
    const now = new Date().toISOString()
    const record: OwnedArtifact = {
      id: input.id ?? uuidv7(), ownerId: this.ownerId, tripId: input.tripId,
      ...(input.conversationId ? { conversationId: input.conversationId } : {}),
      type: input.type, schemaVersion: input.schemaVersion,
      payload: structuredClone(input.payload),
      ...(input.verification === undefined ? {} : { verification: structuredClone(input.verification) }),
      createdAt: now, updatedAt: now
    }
    this.records.set(record.id, record)
    const { ownerId: _ownerId, ...publicRecord } = record
    return structuredClone(publicRecord)
  }

  async get(artifactId: string): Promise<ArtifactRecord | undefined> {
    const record = this.records.get(artifactId)
    if (!record || record.ownerId !== this.ownerId) return undefined
    const { ownerId: _ownerId, ...publicRecord } = record
    return structuredClone(publicRecord)
  }
}
