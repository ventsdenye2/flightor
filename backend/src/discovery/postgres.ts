import { sql, type Kysely, type Transaction } from 'kysely'
import { v7 as uuidv7 } from 'uuid'
import { createHash } from 'node:crypto'
import type { Database, JsonValue } from '../db/types.js'
import { AppError } from '../lib/errors.js'
import { enqueueJob } from '../jobs/repository.js'
import { discoveryInputSchema, effectiveCandidateStatus, publicationProblem, tripTemplateSchema, type CandidateStatus, type DiscoveryCandidate, type DiscoveryInput, type DiscoveryRun, type PublicationInput, type TripTemplate, type TemplateVersion } from './types.js'

type Db = Kysely<Database> | Transaction<Database>
const missing = () => new AppError('RESOURCE_NOT_FOUND', 'Editorial item was not found', 404)
const conflict = () => new AppError('TEMPLATE_VERSION_CONFLICT', 'This template changed; reload and merge your edits', 409)
const iso = (v: Date | string) => new Date(v).toISOString()
const asJson = (v: unknown) => v as JsonValue
const parseJson = (v: JsonValue | string) => typeof v === 'string' ? JSON.parse(v) : v
const endOfDay = (date: string) => new Date(`${date}T23:59:59.999Z`)
const selectCandidate = (db: Db) => db.selectFrom('discovery_candidates as c').innerJoin('trip_template_versions as v', join => join.onRef('v.candidate_id', '=', 'c.public_id').onRef('v.version', '=', 'c.current_version')).select(['c.public_id', 'c.status', 'c.current_version', 'c.published_version', 'c.created_at', 'c.updated_at', 'v.payload_json'])
type CandidateRow = Awaited<ReturnType<ReturnType<typeof selectCandidate>['execute']>>[number]
function candidateView(row: CandidateRow): DiscoveryCandidate {
  const candidate: DiscoveryCandidate = { id: row.public_id, status: row.status, version: row.current_version, publishedVersion: row.published_version, template: tripTemplateSchema.parse(parseJson(row.payload_json)), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) }
  return { ...candidate, status: effectiveCandidateStatus(candidate) }
}

export class PostgresDiscoveryRepository {
  constructor(readonly db: Kysely<Database>) {}

  async list(input: { status?: CandidateStatus | undefined; category?: string | undefined; before?: string | undefined; limit: number }) {
    let query = selectCandidate(this.db)
    if (input.status) query = query.where('c.status', '=', input.status)
    if (input.category) query = query.where('c.category', '=', input.category)
    if (input.before) query = query.where('c.public_id', '<', input.before)
    const rows = await query.orderBy('c.public_id', 'desc').limit(input.limit + 1).execute()
    return { candidates: rows.slice(0, input.limit).map(candidateView), nextCursor: rows.length > input.limit ? rows[input.limit - 1]!.public_id : null }
  }
  async get(id: string, db: Db = this.db): Promise<DiscoveryCandidate> {
    const row = await selectCandidate(db).where('c.public_id', '=', id).executeTakeFirst()
    if (!row) throw missing()
    return candidateView(row)
  }
  async versions(id: string): Promise<TemplateVersion[]> {
    await this.get(id)
    const rows = await this.db.selectFrom('trip_template_versions').selectAll().where('candidate_id', '=', id).orderBy('version', 'desc').limit(100).execute()
    return rows.map(row => ({ version: row.version, action: row.action, actorId: row.actor_id, template: tripTemplateSchema.parse(parseJson(row.payload_json)), createdAt: iso(row.created_at) }))
  }
  private async append(trx: Transaction<Database>, current: DiscoveryCandidate, template: TripTemplate, status: CandidateStatus, action: string, actorId: string | null) {
    const version = current.version + 1
    await trx.insertInto('trip_template_versions').values({ candidate_id: current.id, version, payload_json: asJson(template), action, actor_id: actorId }).execute()
    await trx.updateTable('discovery_candidates').set({ current_version: version, published_version: status === 'published' ? version : null, status, category: template.category, valid_from: new Date(`${template.validFrom}T00:00:00Z`), expires_at: endOfDay(template.validTo), verified_until: template.verification.expiresAt ? new Date(template.verification.expiresAt) : null, updated_at: new Date() }).where('public_id', '=', current.id).execute()
    return this.get(current.id, trx)
  }
  private async locked(trx: Transaction<Database>, id: string, expected: number) {
    const row = await trx.selectFrom('discovery_candidates').select('current_version').where('public_id', '=', id).forUpdate().executeTakeFirst()
    if (!row) throw missing()
    if (row.current_version !== expected) throw conflict()
    return this.get(id, trx)
  }
  async save(id: string, expectedVersion: number, template: TripTemplate, actorId: string) {
    const value = tripTemplateSchema.parse(template)
    // Any content edit invalidates the preceding human approval.
    value.verification = { ...value.verification, status: 'unverified', confidence: 0 }
    delete value.verification.expiresAt
    return this.db.transaction().execute(async trx => this.append(trx, await this.locked(trx, id, expectedVersion), value, 'review', 'human_edit', actorId))
  }
  async publish(id: string, input: PublicationInput, actorId: string) {
    return this.db.transaction().execute(async trx => {
      const current = await this.locked(trx, id, input.expectedVersion)
      if (!['review', 'stale'].includes(current.status)) throw new AppError('INVALID_REVIEW_STATE', 'Submit a current draft for review before publishing', 409)
      const problem = publicationProblem(current.template, input.verifiedUntil)
      if (problem) throw new AppError('PUBLICATION_BLOCKED', problem, 400)
      const now = new Date().toISOString()
      const reviewed = (verification: TripTemplate['verification']) => ({ ...verification, status: 'verified', checkedAt: now, expiresAt: input.verifiedUntil, confidence: 1, sources: [...verification.sources.filter(s => s.provider !== 'human-editorial-review').slice(0, 19), { provider: 'human-editorial-review', reference: actorId }] })
      const template = tripTemplateSchema.parse({ ...current.template, sourceFacts: current.template.sourceFacts.map(fact => ({ ...fact, verification: reviewed(fact.verification) })), verification: reviewed(current.template.verification) })
      // An explicit reviewer attestation is recorded in this immutable version;
      // automated research is never granted this publication authority.
      return this.append(trx, current, template, 'published', 'human_approve_publish', actorId)
    })
  }
  async transition(id: string, expected: number, action: 'unpublish' | 'archive' | 'reject' | 'review', actorId: string) {
    return this.db.transaction().execute(async trx => {
      const current = await this.locked(trx, id, expected)
      return this.append(trx, current, current.template, action === 'archive' || action === 'reject' ? 'archived' : action === 'review' ? 'review' : 'draft', action, actorId)
    })
  }
  async expire(now = new Date()) {
    await this.db.updateTable('discovery_candidates').set({ status: 'expired', updated_at: now }).where('status', 'not in', ['expired', 'archived']).where('expires_at', '<=', now).execute()
    await this.db.updateTable('discovery_candidates').set({ status: 'stale', updated_at: now }).where('status', '=', 'published').where(eb => eb.or([eb('verified_until', 'is', null), eb('verified_until', '<=', now)])).execute()
  }
  async dashboard() {
    const [counts, failures, soon] = await Promise.all([
      this.db.selectFrom('discovery_candidates').select(['status', eb => eb.fn.countAll<string>().as('count')]).groupBy('status').execute(),
      this.db.selectFrom('discovery_runs').select(eb => eb.fn.countAll<string>().as('count')).where('status', '=', 'failed').executeTakeFirstOrThrow(),
      this.db.selectFrom('discovery_candidates').select(eb => eb.fn.countAll<string>().as('count')).where('status', '=', 'published').where('expires_at', '<=', new Date(Date.now() + 7 * 86400000)).executeTakeFirstOrThrow()
    ])
    return { counts: Object.fromEntries(counts.map(c => [c.status, Number(c.count)])), failedRuns: Number(failures.count), soonToExpire: Number(soon.count) }
  }
  async createRun(input: DiscoveryInput, db: Db = this.db): Promise<string> {
    const value = discoveryInputSchema.parse(input), id = uuidv7()
    // API and scheduled callers pass a transaction so enqueue and run creation
    // either both commit or both roll back.
    await db.insertInto('discovery_runs').values({ public_id: id, status: 'queued', input_json: asJson(value), error_code: null }).execute()
    await enqueueJob(db as Kysely<Database>, 'discover_templates', { runId: id }, { maxAttempts: 2 })
    return id
  }
  async enqueue(input: DiscoveryInput) { return this.db.transaction().execute(trx => this.createRun(input, trx)) }
  async runs(): Promise<DiscoveryRun[]> {
    const rows = await this.db.selectFrom('discovery_runs').selectAll().orderBy('created_at', 'desc').limit(50).execute()
    return rows.map(r => ({ id: r.public_id, status: r.status, input: discoveryInputSchema.parse(parseJson(r.input_json)), candidateCount: r.candidate_count, errorCode: r.error_code, attempt: r.attempt, createdAt: iso(r.created_at), updatedAt: iso(r.updated_at) }))
  }
  async claimRun(id: string): Promise<{ input: DiscoveryInput; attempt: number } | undefined> {
    return this.db.transaction().execute(async trx => {
      const run = await trx.selectFrom('discovery_runs').selectAll().where('public_id', '=', id).forUpdate().executeTakeFirst()
      if (!run || run.status === 'succeeded') return undefined
      if (run.status === 'running' && new Date(run.updated_at).getTime() > Date.now() - 5 * 60000) throw new AppError('DISCOVERY_BUSY', 'Discovery run is already active', 409)
      const attempt = run.attempt + 1
      await trx.updateTable('discovery_runs').set({ status: 'running', attempt, error_code: null, updated_at: new Date() }).where('public_id', '=', id).execute()
      return { input: discoveryInputSchema.parse(parseJson(run.input_json)), attempt }
    })
  }
  async finishRun(id: string, attempt: number, templates: TripTemplate[], input: DiscoveryInput) {
    return this.db.transaction().execute(async trx => {
      const run = await trx.selectFrom('discovery_runs').selectAll().where('public_id', '=', id).forUpdate().executeTakeFirst()
      if (!run || run.status !== 'running' || run.attempt !== attempt) throw new AppError('DISCOVERY_SUPERSEDED', 'Discovery attempt was superseded', 409)
      let count = 0
      for (const raw of templates.slice(0, input.candidateId ? 1 : 10)) {
        const template = tripTemplateSchema.parse(raw)
        if (input.candidateId) {
          const current = await this.locked(trx, input.candidateId, input.expectedVersion!)
          await this.append(trx, current, template, 'review', 'ai_regeneration', null)
          count++
        } else {
          const fingerprint = createHash('sha256').update(JSON.stringify({ sources: template.sourceFacts.flatMap(f => f.sourceUrls).sort(), destinations: template.anchorDestinations.map(l => l.id).sort(), title: template.title.toLowerCase().trim(), validFrom: template.validFrom, validTo: template.validTo })).digest('hex')
          const candidateId = uuidv7()
          const inserted = await trx.insertInto('discovery_candidates').values({ public_id: candidateId, fingerprint, status: 'review', category: template.category, current_version: 1, published_version: null, source_run_id: id, valid_from: new Date(`${template.validFrom}T00:00:00Z`), expires_at: endOfDay(template.validTo), verified_until: null }).onConflict(oc => oc.column('fingerprint').doNothing()).returning('public_id').executeTakeFirst()
          if (!inserted) continue
          await trx.insertInto('trip_template_versions').values({ candidate_id: candidateId, version: 1, payload_json: asJson(template), action: 'discovered_ai_draft_for_review', actor_id: null }).execute()
          count++
        }
      }
      await trx.updateTable('discovery_runs').set({ status: 'succeeded', candidate_count: count, updated_at: new Date() }).where('public_id', '=', id).execute()
      return count
    })
  }
  async failRun(id: string, attempt: number, code: string) {
    await this.db.updateTable('discovery_runs').set({ status: 'failed', error_code: code.slice(0, 100), updated_at: new Date() }).where('public_id', '=', id).where('attempt', '=', attempt).where('status', '=', 'running').execute()
  }
  async sources() {
    const rows = await this.db.selectFrom('discovery_sources').selectAll().orderBy('created_at', 'desc').limit(100).execute()
    return rows.map(r => ({ id: r.public_id, name: r.name, input: discoveryInputSchema.parse(parseJson(r.input_json)), intervalHours: r.interval_hours, enabled: r.enabled, nextRunAt: iso(r.next_run_at), lastRunId: r.last_run_id }))
  }
  async addSource(input: { name: string; input: DiscoveryInput; intervalHours: number }) {
    const id = uuidv7()
    await this.db.insertInto('discovery_sources').values({ public_id: id, name: input.name, input_json: asJson(input.input), interval_hours: input.intervalHours, last_run_id: null }).execute()
    return id
  }
  async setSourceEnabled(id: string, enabled: boolean) {
    const row = await this.db.updateTable('discovery_sources').set({ enabled }).where('public_id', '=', id).returning('public_id').executeTakeFirst()
    if (!row) throw missing()
  }
  async scheduleDueSources(now = new Date()) {
    await this.db.transaction().execute(async trx => {
      const sources = await trx.selectFrom('discovery_sources').selectAll().where('enabled', '=', true).where('next_run_at', '<=', now).orderBy('next_run_at').limit(3).forUpdate().skipLocked().execute()
      for (const source of sources) {
        const input = discoveryInputSchema.parse(parseJson(source.input_json))
        if (input.validTo < now.toISOString().slice(0, 10)) { await trx.updateTable('discovery_sources').set({ enabled: false }).where('public_id', '=', source.public_id).execute(); continue }
        const runId = await this.createRun(input, trx)
        await trx.updateTable('discovery_sources').set({ last_run_id: runId, next_run_at: new Date(now.getTime() + source.interval_hours * 3600000) }).where('public_id', '=', source.public_id).execute()
      }
    })
  }
}
