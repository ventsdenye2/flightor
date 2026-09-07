import { AppError } from '../lib/errors.js'
import type { ArtifactRepository, ArtifactType } from './repository.js'

/** Authenticated scope shared by artifact-producing domain services. */
export interface ArtifactWorkspace {
  artifacts: ArtifactRepository
  tripId: string
  conversationId?: string
  signal?: AbortSignal
  isCurrent?: () => boolean
  /** Workflows use this to check their frozen Trip version before each write. */
  checkpoint?: () => Promise<void>
}

export async function checkpoint(scope: ArtifactWorkspace): Promise<void> {
  scope.signal?.throwIfAborted()
  if (scope.isCurrent?.() === false) throw new AppError('WORKFLOW_CANCELLED', 'The active operation changed; workflow was cancelled', 409)
  await scope.checkpoint?.()
  scope.signal?.throwIfAborted()
}

export async function loadWorkspaceArtifact(scope: ArtifactWorkspace, id: string, type: ArtifactType, versions: readonly number[]) {
  await checkpoint(scope)
  const record = await scope.artifacts.get(id)
  if (!record || record.tripId !== scope.tripId) throw new AppError('RESOURCE_NOT_FOUND', 'Artifact was not found', 404)
  if (record.type !== type || !versions.includes(record.schemaVersion)) throw new AppError('ARTIFACT_TYPE_MISMATCH', 'Artifact has an unsupported type or version', 422)
  return record
}
