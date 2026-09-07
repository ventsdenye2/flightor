import type { Kysely, Selectable } from 'kysely'
import type { Database, JsonValue, TripsTable } from '../db/types.js'
import { AppError } from '../lib/errors.js'
import { ARTIFACT_TYPES, type ArtifactType } from '../artifacts/repository.js'
import { PostgresConversationRepository } from '../conversations/postgres.js'
import { tripContextSchema } from '../trips/types.js'
import { routeSetPayloadSchema } from '../flight-routing/types.js'
import { presentationHint, summarizeTrip } from '../routes/agent-cloud.js'
import { PostgresRouteGenerationRunRepository } from '../route-generation/repository.js'
import { toRouteGenerationRunView } from '../route-generation/contracts.js'
import { savedRouteSchema, type WorkspacePatch, type WorkspaceRepository, type WorkspaceTrip, type TripWorkspace, type WorkspaceMessage } from './types.js'

const notFound = () => new AppError('RESOURCE_NOT_FOUND', 'Trip or resource was not found', 404)
const iso = (v: Date | string) => new Date(v).toISOString()
const json = (v: JsonValue | string) => typeof v === 'string' ? JSON.parse(v) : v
function tripView(row: Selectable<TripsTable>): WorkspaceTrip {
  return { id: row.public_id, title: row.title, status: row.status, version: row.workspace_version, contextVersion: row.current_context_version, savedRoute: row.saved_route_json === null ? null : savedRouteSchema.parse(json(row.saved_route_json)), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) }
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

  async get(tripId: string, conversationId?: string): Promise<TripWorkspace> {
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
      for (const m of rows) {
        if (m.role !== 'user' && m.role !== 'assistant') continue
        const ids = Array.isArray(m.metadata.artifact_refs) ? m.metadata.artifact_refs : []
        messages.push({ id: m.id, role: m.role, content: m.content, createdAt: m.createdAt, artifactRefs: ids.flatMap(id => typeof id === 'string' && refsById.has(id) ? [refsById.get(id)!] : []) })
      }
    }
    const latest = await this.db.selectFrom('route_generation_runs').select('public_id').where('trip_id', '=', trip.id).where('user_id', '=', this.userId).orderBy('public_id', 'desc').limit(1).executeTakeFirst()
    const run = latest ? await new PostgresRouteGenerationRunRepository(this.db, this.userId).get(latest.public_id) : undefined
    return { trip: tripView(trip), tripContextSummary: summarizeTrip(tripContextSchema.parse(json(contextRow.context_json))), conversations, conversationId: selected?.id ?? null, messages, artifactRefs, ...(run ? { routeGeneration: toRouteGenerationRunView(run, { stale: run.contextVersion !== trip.current_context_version }) } : {}) }
  }

  async update(tripId: string, input: WorkspacePatch): Promise<WorkspaceTrip> {
    return this.db.transaction().execute(async trx => {
      const trip = await trx.selectFrom('trips').selectAll().where('public_id', '=', tripId).where('user_id', '=', this.userId).forUpdate().executeTakeFirst()
      if (!trip) throw notFound()
      if (trip.workspace_version !== input.expectedVersion) throw new AppError('WORKSPACE_VERSION_CONFLICT', 'Trip changed on another device; reload before saving', 409)
      let savedRoute = trip.saved_route_json, status = input.status ?? trip.status
      if (input.savedRoute) {
        const artifact = await trx.selectFrom('artifacts').selectAll().where('public_id', '=', input.savedRoute.artifactId).where('trip_id', '=', trip.id).where('user_id', '=', this.userId).executeTakeFirst()
        if (!artifact || artifact.type !== 'route_set' || artifact.schema_version !== 1) throw notFound()
        const parsed = routeSetPayloadSchema.safeParse(json(artifact.payload_json))
        if (!parsed.success || parsed.data.kind !== 'optimized_routes' || !parsed.data.representatives.some(r => r.path.id === input.savedRoute!.routeId)) throw new AppError('INVALID_ROUTE_SELECTION', 'Choose a generated route from this trip', 400)
        const run = await trx.selectFrom('route_generation_runs').select('context_version').where('result_artifact_id', '=', artifact.id).where('trip_id', '=', trip.id).where('user_id', '=', this.userId).where('status', '=', 'succeeded').executeTakeFirst()
        if (!run || run.context_version !== trip.current_context_version) throw new AppError('STALE_ROUTE_SELECTION', 'Trip constraints changed; generate a new route before saving', 409)
        savedRoute = { ...input.savedRoute, contextVersion: run.context_version }
        status = input.status === 'archived' ? 'archived' : 'saved'
      } else if (input.savedRoute === null) {
        savedRoute = null
        if (status === 'saved') status = 'generated'
      }
      const row = await trx.updateTable('trips').set({ title: input.title ?? trip.title, status, saved_route_json: savedRoute, workspace_version: trip.workspace_version + 1, updated_at: new Date() }).where('id', '=', trip.id).returningAll().executeTakeFirstOrThrow()
      return tripView(row)
    })
  }
}
