import type { Kysely, Selectable } from 'kysely'
import type { Database, JsonValue, TripsTable } from '../db/types.js'
import { AppError } from '../lib/errors.js'
import { ARTIFACT_TYPES, type ArtifactType } from '../artifacts/repository.js'
import { PostgresConversationRepository } from '../conversations/postgres.js'
import { tripContextSchema } from '../trips/types.js'
import { presentationHint, summarizeTrip } from '../routes/agent-cloud.js'
import { PostgresRouteGenerationRunRepository } from '../route-generation/repository.js'
import { toRouteGenerationRunView } from '../route-generation/contracts.js'
import { goalDeliverySchema, refreshGoalDelivery } from '../agent/goals/completion.js'
import { PostgresGoalRepository, PostgresGoalRunRepository } from '../agent/goals/postgres.js'
import { createDefaultGoalVerifierRegistry } from '../agent/goals/default-verifiers.js'
import { PostgresTripRepository } from '../trips/postgres.js'
import { PostgresArtifactRepository } from '../artifacts/postgres.js'
import { projectHistoricalGuideMessages } from '../travel-guides/publication-history.js'
import { type WorkspacePatch, type WorkspaceRepository, type WorkspaceTrip, type TripWorkspace, type WorkspaceMessage } from './types.js'
import {
  assertFlightChoice, legacySavedRoute, readSavedFlightSelection, sameFlightChoice,
  selectedFlightContext, type FlightSelectionChoice, type SelectedFlightContext
} from './flight-selection.js'

const notFound = () => new AppError('RESOURCE_NOT_FOUND', 'Trip or resource was not found', 404)
const iso = (v: Date | string) => new Date(v).toISOString()
const json = (v: JsonValue | string) => typeof v === 'string' ? JSON.parse(v) : v
function tripView(row: Selectable<TripsTable>): WorkspaceTrip {
  const selectedFlight = row.saved_route_json === null ? null : readSavedFlightSelection(json(row.saved_route_json))
  return { id: row.public_id, title: row.title, status: row.status, version: row.workspace_version, contextVersion: row.current_context_version,
    savedRoute: legacySavedRoute(selectedFlight), selectedFlight, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) }
}

export class PostgresWorkspaceRepository implements WorkspaceRepository {
  constructor(private readonly db: Kysely<Database>, private readonly userId: string) {}

  async list(input: Parameters<WorkspaceRepository['list']>[0]) {
    let query = this.db.selectFrom('trips').selectAll().where('user_id', '=', this.userId)
    if (input.before) query = query.where('public_id', '<', input.before)
    if (input.status) query = query.where('status', '=', input.status)
    const rows = await query.orderBy('public_id', 'desc').limit(input.limit + 1).execute()
    const hasMore = rows.length > input.limit
    return { trips: rows.slice(0, input.limit).map(tripView), nextCursor: hasMore ? rows[input.limit - 1]!.public_id : null }
  }

  async get(tripId: string, conversationId?: string, locale: 'zh' | 'en' = 'zh'): Promise<TripWorkspace> {
    const trip = await this.db.selectFrom('trips').selectAll().where('public_id', '=', tripId).where('user_id', '=', this.userId).executeTakeFirst()
    if (!trip) throw notFound()
    const [contextRow, conversationRows, artifacts] = await Promise.all([
      this.db.selectFrom('trip_context_versions').select('context_json').where('trip_id', '=', trip.id).where('version', '=', trip.current_context_version).executeTakeFirstOrThrow(),
      this.db.selectFrom('conversations').selectAll().where('trip_id', '=', trip.id).where('user_id', '=', this.userId).orderBy('updated_at', 'desc').orderBy('id', 'desc').limit(50).execute(),
      this.db.selectFrom('artifacts').select(['public_id', 'type', 'schema_version']).where('trip_id', '=', trip.id).where('user_id', '=', this.userId).orderBy('id', 'desc').limit(100).execute()
    ])
    const conversations = conversationRows.map(row => ({ id: row.public_id, tripId, title: row.title, status: row.status, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) }))
    const selected = conversationId ? conversations.find(c => c.id === conversationId) : conversations[0]
    if (conversationId && !selected) throw notFound()
    const artifactRefs = artifacts.filter(a => ARTIFACT_TYPES.includes(a.type as ArtifactType)).map(a => ({ id: a.public_id, type: a.type as ArtifactType, schemaVersion: a.schema_version, presentationHint: presentationHint(a.type as ArtifactType) }))
    const refsById = new Map(artifactRefs.map(a => [a.id, a]))
    const messages: WorkspaceMessage[] = []
    if (selected) {
      const rows = await new PostgresConversationRepository(this.db, this.userId).listMessages(selected.id, 100)
      const publicRows = rows.filter(m => m.role === 'user' || m.role === 'assistant')
      const projectedRows = await projectHistoricalGuideMessages(publicRows, {
        tripId, conversationId: selected.id, locale, tripContextVersion: trip.current_context_version,
        checkFlightSelection: true, flightSelectionRevision: readSavedFlightSelection(json(trip.saved_route_json))?.revision,
        artifacts: new PostgresArtifactRepository(this.db, this.userId)
      })
      for (const m of projectedRows) {
        const ids = Array.isArray(m.metadata.artifact_refs) ? m.metadata.artifact_refs : []
        const delivery = goalDeliverySchema.safeParse(m.metadata.delivery)
        const stopReason = typeof m.metadata.stop_reason === 'string' && /^[a-z][a-z_]{0,79}$/.test(m.metadata.stop_reason) ? m.metadata.stop_reason : undefined
        const warnings = Array.isArray(m.metadata.warnings)
          ? m.metadata.warnings.filter((value): value is string => typeof value === 'string' && /^[a-z][a-z0-9_]{0,239}$/.test(value)).slice(0, 40) : undefined
        messages.push({ id: m.id, role: m.role as 'user' | 'assistant', content: m.content, createdAt: m.createdAt, artifactRefs: ids.flatMap(id => typeof id === 'string' && refsById.has(id) ? [refsById.get(id)!] : []), ...(delivery.success ? { delivery: delivery.data } : {}),
          ...(m.role === 'assistant' && stopReason ? { stopReason } : {}), ...(m.role === 'assistant' && warnings ? { warnings } : {}) })
      }
    }
    const selectedFlight = await this.getSelectedFlight(tripId)
    const completionScope = {
      ownerId: this.userId, tripId,
      trips: new PostgresTripRepository(this.db, this.userId),
      artifacts: new PostgresArtifactRepository(this.db, this.userId),
      goals: new PostgresGoalRepository(this.db, this.userId),
      runs: new PostgresGoalRunRepository(this.db, this.userId),
      verifiers: createDefaultGoalVerifierRegistry(), signal: AbortSignal.timeout(3_000),
      ...(selectedFlight ? {
        selectedFlight,
        assertFlightSelectionCurrent: async () => {
          const current = await this.getSelectedFlight(tripId)
          if (!current || current.selection.revision !== selectedFlight.selection.revision
            || current.selection.artifactId !== selectedFlight.selection.artifactId) {
            throw new AppError('FLIGHT_SELECTION_CHANGED', 'The confirmed flight changed; refresh this result', 409)
          }
        }
      } : {})
    }
    // Status comes from the server verifier, never from a job's succeeded flag.
    // Bound refresh latency; historical snapshots remain honest if storage is unavailable.
    for (const message of [...messages].reverse()) {
      if (completionScope.signal.aborted) break
      if (!message.delivery || ['not_requested', 'satisfied', 'cancelled'].includes(message.delivery.status)) continue
      const snapshot = message.delivery
      let timer: ReturnType<typeof setTimeout> | undefined
      const deadline = new Promise<typeof snapshot>(resolve => { timer = setTimeout(() => resolve(snapshot), 3_000) })
      try { message.delivery = await Promise.race([refreshGoalDelivery(completionScope, snapshot), deadline]) }
      finally { clearTimeout(timer) }
    }
    const latest = await this.db.selectFrom('route_generation_runs').select('public_id').where('trip_id', '=', trip.id).where('user_id', '=', this.userId).orderBy('public_id', 'desc').limit(1).executeTakeFirst()
    const run = latest ? await new PostgresRouteGenerationRunRepository(this.db, this.userId).get(latest.public_id) : undefined
    return { trip: tripView(trip), tripContextSummary: summarizeTrip(tripContextSchema.parse(json(contextRow.context_json))), conversations, conversationId: selected?.id ?? null, messages, artifactRefs, ...(run ? { routeGeneration: toRouteGenerationRunView(run, { stale: run.contextVersion !== trip.current_context_version }) } : {}) }
  }

  async getSelectedFlight(tripId: string): Promise<SelectedFlightContext | null> {
    const trip = await this.db.selectFrom('trips').selectAll().where('public_id', '=', tripId).where('user_id', '=', this.userId).executeTakeFirst()
    if (!trip) throw notFound()
    const selection = trip.saved_route_json === null ? null : readSavedFlightSelection(json(trip.saved_route_json))
    if (!selection) return null
    const artifact = await new PostgresArtifactRepository(this.db, this.userId).get(selection.artifactId)
    if (!artifact || artifact.tripId !== tripId) throw notFound()
    return selectedFlightContext(selection, artifact)
  }

  async update(tripId: string, input: WorkspacePatch): Promise<WorkspaceTrip> {
    return this.db.transaction().execute(async trx => {
      const trip = await trx.selectFrom('trips').selectAll().where('public_id', '=', tripId).where('user_id', '=', this.userId).forUpdate().executeTakeFirst()
      if (!trip) throw notFound()
      const currentSelection = trip.saved_route_json === null ? null : readSavedFlightSelection(json(trip.saved_route_json))
      const requestedChoice: FlightSelectionChoice | null | undefined = input.selectedFlight !== undefined
        ? input.selectedFlight
        : input.savedRoute !== undefined
          ? input.savedRoute === null ? null : { kind: 'route', ...input.savedRoute, layoverPreference: 'airport_only' }
          : undefined
      const sameRequestedChoice = requestedChoice !== undefined && sameFlightChoice(currentSelection, requestedChoice)
      const onlySelectionMutation = input.title === undefined && input.status === undefined
        && ((input.selectedFlight !== undefined && input.savedRoute === undefined)
          || (input.savedRoute !== undefined && input.selectedFlight === undefined))
      if (trip.workspace_version !== input.expectedVersion) {
        const adoptionRetry = sameRequestedChoice && onlySelectionMutation
        if (!adoptionRetry) {
          throw new AppError('WORKSPACE_VERSION_CONFLICT', 'Trip changed on another device; reload before saving', 409)
        }
        return tripView(trip)
      }
      if (sameRequestedChoice && onlySelectionMutation) return tripView(trip)
      let savedRoute = trip.saved_route_json, status = input.status ?? trip.status
      if (requestedChoice && !sameRequestedChoice) {
        const artifact = await trx.selectFrom('artifacts').selectAll().where('public_id', '=', requestedChoice.artifactId).where('trip_id', '=', trip.id).where('user_id', '=', this.userId).executeTakeFirst()
        if (!artifact) throw notFound()
        const artifactRecord = {
          id: artifact.public_id, tripId, type: artifact.type as ArtifactType, schemaVersion: artifact.schema_version,
          payload: json(artifact.payload_json),
          ...(artifact.trip_context_version === null ? {} : { tripContextVersion: artifact.trip_context_version }),
          sourceArtifactIds: Array.isArray(json(artifact.source_artifact_ids_json)) ? json(artifact.source_artifact_ids_json) as string[] : [],
          createdAt: iso(artifact.created_at), updatedAt: iso(artifact.updated_at)
        }
        assertFlightChoice(artifactRecord, requestedChoice, trip.current_context_version)
        if (requestedChoice.kind === 'route') {
          const run = await trx.selectFrom('route_generation_runs').select('context_version').where('result_artifact_id', '=', artifact.id).where('trip_id', '=', trip.id).where('user_id', '=', this.userId).where('status', '=', 'succeeded').executeTakeFirst()
          if (!run || run.context_version !== trip.current_context_version) throw new AppError('STALE_ROUTE_SELECTION', 'Trip constraints changed; generate a new route before saving', 409)
        }
        savedRoute = {
          ...requestedChoice, contextVersion: trip.current_context_version,
          revision: (currentSelection?.revision ?? 0) + 1, selectedAt: new Date().toISOString()
        }
        status = input.status === 'archived' ? 'archived' : 'saved'
      } else if (requestedChoice === null && !sameRequestedChoice) {
        savedRoute = null
        if (status === 'saved') status = 'generated'
      }
      const row = await trx.updateTable('trips').set({ title: input.title ?? trip.title, status, saved_route_json: savedRoute, workspace_version: trip.workspace_version + 1, updated_at: new Date() }).where('id', '=', trip.id).returningAll().executeTakeFirstOrThrow()
      return tripView(row)
    })
  }
}
