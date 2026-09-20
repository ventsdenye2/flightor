import { AppError } from '../lib/errors.js'
import { TripContextVersionConflict, type TripContextRepository } from '../trips/repository.js'
import type { TripContext } from '../trips/types.js'
import { assertArtifactContextVersion, assertArtifactSourceContext, type ArtifactRecord, type ArtifactRepository, type ArtifactType, type CreateArtifactInput } from './repository.js'
import { isCompatibleSelectedFlightSource, type SelectedFlightContext } from '../workspaces/flight-selection.js'

/** Authenticated scope shared by artifact-producing domain services. */
export interface ArtifactWorkspace {
  artifacts: ArtifactRepository
  /** Authenticated owner, carried only to domain-owned infrastructure such as research audit linking. */
  ownerId?: string
  trips: Pick<TripContextRepository, 'get'>
  tripId: string
  conversationId?: string
  goalId?: string
  runId?: string
  readonly tripContextVersion: number
  readonly tripContext: TripContext
  signal?: AbortSignal
  isCurrent?: () => boolean
  /** Optional durable-operation cancellation check; Trip version checks remain shared here. */
  assertActive?: () => Promise<void>
  selectedFlight?: SelectedFlightContext
  assertFlightSelectionCurrent?: () => Promise<void>
  /** Best-effort transport notification, only after repository commit and a fresh checkpoint. */
  onArtifactCommitted?: (record: ArtifactRecord) => void
}

/** Freeze the version used to derive this operation's inputs, including work without a Goal. */
export async function createArtifactWorkspace(
  input: Omit<ArtifactWorkspace, 'tripContextVersion' | 'tripContext'> & { tripContextVersion?: number },
  snapshot?: TripContext
): Promise<ArtifactWorkspace> {
  const trip = snapshot ?? await input.trips.get(input.tripId)
  if (!trip || trip.id !== input.tripId) throw new AppError('RESOURCE_NOT_FOUND', 'Trip was not found', 404)
  const scope: ArtifactWorkspace = { ...input, tripContextVersion: input.tripContextVersion ?? trip.version, tripContext: trip }
  if (trip.version !== scope.tripContextVersion) throw new TripContextVersionConflict(scope.tripContextVersion, trip.version)
  await checkpoint(scope)
  return scope
}

export function workspaceLineage(
  scope: ArtifactWorkspace,
  sourceArtifactIds: readonly string[] = []
): Pick<CreateArtifactInput, 'goalId' | 'runId' | 'tripContextVersion' | 'sourceArtifactIds'> {
  return {
    ...(scope.goalId ? { goalId: scope.goalId } : {}),
    ...(scope.runId ? { runId: scope.runId } : {}),
    tripContextVersion: scope.tripContextVersion,
    sourceArtifactIds
  }
}

export async function checkpoint(scope: ArtifactWorkspace): Promise<void> {
  scope.signal?.throwIfAborted()
  if (scope.isCurrent?.() === false) throw new AppError('WORKFLOW_CANCELLED', 'The active operation changed; workflow was cancelled', 409)
  await scope.assertActive?.()
  await scope.assertFlightSelectionCurrent?.()
  const current = await scope.trips.get(scope.tripId)
  if (!current) throw new AppError('RESOURCE_NOT_FOUND', 'Trip was not found', 404)
  if (current.version !== scope.tripContextVersion) throw new TripContextVersionConflict(scope.tripContextVersion, current.version)
  scope.signal?.throwIfAborted()
  if (scope.isCurrent?.() === false) throw new AppError('WORKFLOW_CANCELLED', 'The active operation changed; workflow was cancelled', 409)
}

/** Same-version evidence may be reused across runs; legacy or other-version evidence needs re-planning. */
export function assertWorkspaceArtifactVersion(scope: ArtifactWorkspace, record: ArtifactRecord): void {
  assertArtifactSourceContext(record, scope.tripContextVersion, source => Boolean(scope.selectedFlight
    && isCompatibleSelectedFlightSource(source, scope.selectedFlight, scope.tripContext)))
}

export async function loadWorkspaceArtifact(scope: ArtifactWorkspace, id: string, type: ArtifactType, versions: readonly number[]) {
  await checkpoint(scope)
  const record = await scope.artifacts.get(id)
  if (!record || record.tripId !== scope.tripId) throw new AppError('RESOURCE_NOT_FOUND', 'Artifact was not found', 404)
  if (record.type !== type || !versions.includes(record.schemaVersion)) throw new AppError('ARTIFACT_TYPE_MISMATCH', 'Artifact has an unsupported type or version', 422)
  assertWorkspaceArtifactVersion(scope, record)
  return record
}

/** A single write boundary for domain-produced Artifacts; callers cannot override scope or lineage. */
export async function saveWorkspaceArtifact(
  scope: ArtifactWorkspace,
  input: Pick<CreateArtifactInput, 'id' | 'type' | 'schemaVersion' | 'payload' | 'verification' | 'sourceArtifactIds'>,
  options?: { researchAuditId?: string }
): Promise<ArtifactRecord> {
  assertArtifactContextVersion({ tripContextVersion: scope.tripContextVersion, payload: input.payload }, scope.tripContextVersion)
  for (const id of new Set(input.sourceArtifactIds)) {
    const source = await scope.artifacts.getForScope(id, { tripId: scope.tripId })
    if (!source) throw new AppError('RESOURCE_NOT_FOUND', 'Source artifact was not found', 404)
    assertWorkspaceArtifactVersion(scope, source)
  }
  await checkpoint(scope)
  const create = {
    ...input,
    tripId: scope.tripId,
    ...(scope.conversationId ? { conversationId: scope.conversationId } : {}),
    ...workspaceLineage(scope, input.sourceArtifactIds),
    ...(scope.selectedFlight ? {
      isSourceContextCompatible: (source: ArtifactRecord) => isCompatibleSelectedFlightSource(source, scope.selectedFlight!, scope.tripContext)
    } : {})
  }
  let record: ArtifactRecord
  if (options?.researchAuditId) {
    if (!scope.artifacts.createWithResearchAudit) throw new AppError('RESEARCH_AUDIT_LINK_UNAVAILABLE', 'Research audit cannot be linked to the workspace artifact', 503)
    record = await scope.artifacts.createWithResearchAudit(create, options.researchAuditId)
  } else {
    record = await scope.artifacts.create(create)
  }
  if (record.type === 'flight_search') recordMilestone('firstFlightSavedMs')
  if (record.type === 'travel_guide') recordMilestone('firstGuideSavedMs')
  if (scope.onArtifactCommitted) {
    try {
      await checkpoint(scope)
      scope.onArtifactCommitted(record)
    } catch { /* Publication must not undo or misreport a committed Artifact. */ }
  }
  return record
}
import { recordMilestone } from '../lib/planner-observation.js'
