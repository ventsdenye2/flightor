import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Kysely, PostgresDialect } from 'kysely'
import pg from 'pg'
import { up as initial } from '../../db/migrations/001_initial.js'
import { up as cloud } from '../../db/migrations/006_cloud_state.js'
import { up as routeRuns } from '../../db/migrations/007_route_generation_runs.js'
import { up as workspaceSchema } from '../../db/migrations/008_trip_workspace.js'
import { up as goalsSchema } from '../../db/migrations/010_planning_goals.js'
import type { Database } from '../../db/types.js'
import { PostgresArtifactRepository } from '../../artifacts/postgres.js'
import { createArtifactWorkspace, saveWorkspaceArtifact } from '../../artifacts/workspace.js'
import { PostgresConversationRepository } from '../../conversations/postgres.js'
import { PostgresUserIdentityRepository } from '../../identity/postgres.js'
import { PostgresTripRepository } from '../../trips/postgres.js'
import { PostgresGoalRepository, PostgresGoalRunRepository } from '../goals/postgres.js'
import { createDefaultGoalVerifierRegistry } from '../goals/default-verifiers.js'
import type { ToolExecutionContext } from '../runtime/registry.js'
import { publicationFor } from '../../travel-guides/publication.js'
import { GuideFinalizer, sourceRef } from '../../travel-guides/finalization.js'
import { travelGuideArtifactPayloadSchema } from '../../travel-guides/artifact.js'
import { guideCandidateRef } from '../../travel-guides/candidates.js'
import { DshEvidenceStore } from './evidence.js'
import { createCommitGuideTool } from './commit-guide.js'
import { adaptDshCommit, bindPreparedEditLimits, prepareDshSnapshot } from './preparation.js'

const databaseUrl = process.env.TEST_DATABASE_URL
const suite = databaseUrl ? describe : describe.skip
const city = { id: 'city:TYO', type: 'city' as const, name: 'Tokyo', countryCode: 'JP', cityCode: 'TYO' }

suite('D6 DSH preparation and PostgreSQL publication CAS', () => {
  const schema = `d6_preparation_${randomUUID().replaceAll('-', '')}`
  let admin: pg.Pool
  let pool: pg.Pool
  let recoveryPool: pg.Pool
  let db: Kysely<Database>
  let recoveryDb: Kysely<Database>
  let ownerId = ''

  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: databaseUrl })
    await admin.query(`create schema "${schema}"`)
    pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}`, application_name: schema, max: 8 })
    recoveryPool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}`, application_name: `${schema}_recovery`, max: 2 })
    db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) })
    recoveryDb = new Kysely<Database>({ dialect: new PostgresDialect({ pool: recoveryPool }) })
    for (const migrate of [initial, cloud, routeRuns, workspaceSchema, goalsSchema]) await migrate(db)
    ownerId = (await new PostgresUserIdentityRepository(db).resolveWechat({
      providerSubject: `${schema}-owner`, nickname: 'D6 preparation test', avatarUrl: ''
    })).userId
  }, 30_000)

  afterAll(async () => {
    await recoveryDb?.destroy()
    await db?.destroy()
    await admin?.query(`drop schema if exists "${schema}" cascade`)
    await admin?.end()
  })

  async function waitForTripLockWait() {
    await expect.poll(async () => {
      const result = await admin.query<{ blocked: boolean }>(
        'select exists (select 1 from pg_stat_activity where application_name = $1 and wait_event_type = $2) as blocked',
        [schema, 'Lock']
      )
      return result.rows[0]?.blocked
    }, { timeout: 3_000, interval: 10 }).toBe(true)
  }

  async function createTrip() {
    const trip = await new PostgresTripRepository(db, ownerId).create({
      initialContext: { travelDays: 1, destinationIntent: { mode: 'explicit', required: [city], preferred: [], excluded: [] } }
    })
    const conversation = await new PostgresConversationRepository(db, ownerId).create({ tripId: trip.id, title: 'D6 preparation test' })
    return { trip, conversation }
  }

  async function createGuide(tripId: string, conversationId: string, suffix: string,
    selection?: { artifactId: string; offerId: string; revision: number; selectedAt: string }) {
    const trips = new PostgresTripRepository(db, ownerId)
    const artifacts = new PostgresArtifactRepository(db, ownerId)
    const sourceId = randomUUID()
    await artifacts.create({ id: sourceId, tripId, conversationId, tripContextVersion: 0,
      type: 'research', schemaVersion: 2, payload: { fixture: 'source' } })
    const payload = travelGuideArtifactPayloadSchema.parse({
      kind: 'trip_travel_guide', schemaVersion: 1, builderVersion: 'd6-integration',
      sourceArtifactIds: [sourceId], routeArtifactId: randomUUID(),
      ...(selection ? { flightSelection: { kind: 'offer', artifactId: selection.artifactId,
        choiceId: selection.offerId, revision: selection.revision, selectedAt: selection.selectedAt } } : {}),
      days: [{ day: 1, city, kind: 'visit', theme: 'Tokyo culture', items: [{
        id: `activity-${suffix}`, city, title: `Tokyo cultural walk ${suffix}`, description: 'Visit a cultural area at a relaxed pace.',
        reason: 'interest_match', category: 'activity', sourceArtifactId: sourceId, sourceFindingId: `finding-${suffix}`,
        timeOfDay: 'morning', verification: { status: 'unverified', confidence: 0, checkedAt: new Date().toISOString(), sources: [] }
      }] }],
      unassignedActivityRefs: [],
      verification: { status: 'unverified', confidence: 0, checkedAt: new Date().toISOString(), sources: [] },
      warnings: [], createdAt: new Date().toISOString()
    })
    const scope = await createArtifactWorkspace({ ownerId, trips, artifacts, tripId, conversationId, requireGuideFinalization: true })
    const record = await saveWorkspaceArtifact(scope, { type: 'travel_guide', schemaVersion: 1, payload, sourceArtifactIds: [sourceId] })
    const guide = travelGuideArtifactPayloadSchema.parse(record.payload)
    const publication = publicationFor(record)!
    const text = {
      locale: 'en' as const,
      reply: 'Your Tokyo cultural itinerary is ready to explore.',
      overview: 'Explore Tokyo cultural areas at a relaxed pace.',
      days: guide.days.map(day => ({ day: day.day, theme: 'Cultural walk' })),
      activities: guide.days.flatMap(day => day.items).map(item => ({
        activityId: item.id, name: item.title,
        introduction: 'Walk through the area and explore its cultural setting at a relaxed pace.',
        recommendationReason: 'This visit matches the requested cultural interests and relaxed pace.',
        sourceRefs: [sourceRef(item)]
      }))
    }
    const variant = await new GuideFinalizer({ complete: async () => ({
      message: { role: 'assistant', content: JSON.stringify({ text, issues: [] }) }
    }) }).generate({ locale: 'en', guide, accepted: text, research: [], requirements: null })
    expect(variant.status).toBe('accepted')
    return { record, publication, variant, artifacts }
  }

  async function makeAccepted(tripId: string, conversationId: string, suffix: string,
    selection?: { artifactId: string; offerId: string; revision: number; selectedAt: string }) {
    const guide = await createGuide(tripId, conversationId, suffix, selection)
    const saved = await guide.artifacts.saveFinalVariant(guide.record.id, guide.publication.guideContentHash,
      'en', guide.variant)
    return { ...guide, record: saved, base: { id: saved.id, contentHash: guide.publication.guideContentHash, locale: 'en' as const } }
  }

  it('persists and recovers source-bound event dates and rejects a fake date quote before Artifact writes', async () => {
    const trips = new PostgresTripRepository(db, ownerId)
    const artifacts = new PostgresArtifactRepository(db, ownerId)
    const goals = new PostgresGoalRepository(db, ownerId)
    const goalRuns = new PostgresGoalRunRepository(db, ownerId)
    const trip = await trips.create({ initialContext: { travelDays: 2, interests: ['culture'],
      departureWindow: { from: '2026-10-10', to: '2026-10-10', precision: 'exact' },
      destinationIntent: { mode: 'explicit', required: [city], preferred: [], excluded: [] } } })
    const conversation = await new PostgresConversationRepository(db, ownerId).create({ tripId: trip.id, title: 'Temporal evidence DSH test' })
    const generationId = randomUUID()
    const evidence = new DshEvidenceStore({ ownerId, tripId: trip.id, conversationId: conversation.id,
      generationId, tripContextVersion: trip.context.version })
    const activitySources = await evidence.recordSearch({ sources: [{ url: 'https://example.com/tokyo-culture',
      snippet: 'Explore traditional architecture, museum exhibits, and quiet garden paths.' }] }, 'fixture-search', 'activity-search')
    const eventQuote = '開催期間は2026年10月10日(土)～10月11日(日)です。'
    const eventSources = await evidence.recordFetch('https://example.com/festival', { statusCode: 200,
      snippet: 'Official festival information.', body: { kind: 'text', content: eventQuote } }, 'fixture-fetch', 'event-fetch')
    const eventIntent = { kind: 'travel_guide' as const, parameters: { questions: ['Cultural visits and events'],
      researchTypes: ['activity', 'event'] as const, requiredEvidenceTypes: ['activity'] as const,
      maxResults: 10, maxCities: 1, allowPartial: true } }
    const context = { ownerId, tripId: trip.id, conversationId: conversation.id, generationId, requestId: randomUUID(),
      trips, artifacts, tripContextSnapshot: structuredClone(trip.context), resolvedLocations: new Map(),
      goalRepository: goals, goalRunRepository: goalRuns, goalVerifiers: createDefaultGoalVerifierRegistry(),
      isGenerationCurrent: () => true, research: { research: () => { throw new Error('Independent ResearchAgent forbidden') } }
    } as unknown as ToolExecutionContext
    const tool = createCommitGuideTool({ evidenceStore: evidence, locale: 'en', memoryEnabled: true })
    const candidates = ['temple', 'museum', 'garden'].map(key => ({ key, sourceRefs: activitySources.sourceRefs,
      title: `Tokyo ${key}`, summary: `Explore the ${key} and local culture.`, category: 'activity' as const, locationId: city.id }))
    candidates.push({ key: 'festival', sourceRefs: eventSources.sourceRefs,
      title: 'Tokyo festival', summary: 'A cultural event during the selected dates.', category: 'event' as const,
      locationId: city.id, temporalEvidence: { from: '2026-10-10', to: '2026-10-11',
        sourceRef: eventSources.sourceRefs[0]!, quote: '2026年10月10日(土)～10月11日(日)' } } as any)
    const supportKeys = ['transit', 'market', 'craft-street', 'history']
    candidates.push(...supportKeys.map(key => ({ key, sourceRefs: activitySources.sourceRefs,
      title: `Tokyo ${key}`, summary: 'Supplemental cultural material for the trip.', category: 'activity' as const, locationId: city.id })))
    const args = {
      intent: eventIntent, candidates, supportingCandidateKeys: supportKeys,
      days: [
        { day: 1, cityId: city.id, kind: 'visit' as const, theme: 'Culture and festival', items: [
          { activityKey: 'festival', candidateKey: 'festival', timeOfDay: 'morning' as const, planningNote: 'Explore the festival at a relaxed pace.' },
          { activityKey: 'temple', candidateKey: 'temple', timeOfDay: 'afternoon' as const, planningNote: 'Explore traditional architecture.' }
        ] },
        { day: 2, cityId: city.id, kind: 'visit' as const, theme: 'Museums and gardens', items: [
          { activityKey: 'museum', candidateKey: 'museum', timeOfDay: 'morning' as const, planningNote: 'Explore cultural exhibits.' },
          { activityKey: 'garden', candidateKey: 'garden', timeOfDay: 'afternoon' as const, planningNote: 'Enjoy a quiet garden walk.' }
        ] }
      ],
      text: { reply: 'Your Tokyo cultural itinerary is ready to explore.', overview: 'Explore Tokyo culture and enjoy a relaxed pace across two days.',
        days: [{ day: 1, theme: 'Culture and festival' }, { day: 2, theme: 'Museums and gardens' }],
        activities: [
          { activityKey: 'festival', name: 'Tokyo festival visit', introduction: 'Explore a cultural festival in Tokyo.', recommendationReason: 'This event matches your interest in local culture.' },
          { activityKey: 'temple', name: 'Temple visit', introduction: 'Explore traditional architecture in Tokyo.', recommendationReason: 'This visit matches your interest in local culture.' },
          { activityKey: 'museum', name: 'Museum visit', introduction: 'Explore cultural exhibits in Tokyo.', recommendationReason: 'This visit matches your interest in local culture.' },
          { activityKey: 'garden', name: 'Garden walk', introduction: 'Walk through quiet garden paths in Tokyo.', recommendationReason: 'This visit adds a quieter cultural experience.' }
        ] }
    }
    const execute = (value: typeof args) => tool.execute(tool.inputSchema.parse(value), context, new AbortController().signal) as Promise<any>

    const fake = structuredClone(args) as any
    fake.candidates[3]!.temporalEvidence.quote = '2026年10月10日(土)～10月12日(月)'
    await expect(execute(fake)).rejects.toMatchObject({ code: 'DSH_GUIDE_NEEDS_REVISION', details: {
      code: 'candidate_temporal_evidence_invalid', reason: 'quote_not_found'
    } })
    expect(await artifacts.listForTrip(trip.id)).toEqual([])

    await expect(execute(args)).resolves.toMatchObject({ status: 'accepted', completion: { status: 'satisfied' } })
    const freshArtifacts = new PostgresArtifactRepository(recoveryDb, ownerId)
    const records = await freshArtifacts.listForTrip(trip.id)
    const researchRecord = records.find(record => record.type === 'research')!
    const research = researchRecord.payload as any
    const eventFinding = research.findings.find((finding: any) => finding.id === 'festival')
    expect(eventFinding.temporalEvidence).toEqual({ from: '2026-10-10', to: '2026-10-11',
      sourceUrl: 'https://example.com/festival', quote: '2026年10月10日(土)～10月11日(日)' })
    expect(eventFinding.temporalEvidence).not.toHaveProperty('sourceRef')
    expect(eventFinding.verification.status).toBe('partially_verified')
    expect(eventFinding.sources[0].page).toMatchObject({ text: eventQuote })
    const guide = records.find(record => record.type === 'travel_guide')!
    const freshTrip = (await trips.get(trip.id))!
    expect(prepareDshSnapshot({ trip: freshTrip, records, conversationId: conversation.id,
      selectedFlight: null, locale: 'en' }).baseGuide?.id).toBe(guide.id)
    expect(guideCandidateRef({ ownerId, tripId: trip.id, tripContextVersion: freshTrip.version }, research, 'festival'))
      .toMatch(/^gc1\./)
    const freshGoals = new PostgresGoalRepository(recoveryDb, ownerId)
    const freshRuns = new PostgresGoalRunRepository(recoveryDb, ownerId)
    const prepared = await bindPreparedEditLimits(prepareDshSnapshot({ trip: freshTrip, records,
      conversationId: conversation.id, selectedFlight: null, locale: 'en' }), records, freshGoals, ownerId, new AbortController().signal)
    expect(prepared.editLimits).toEqual({ maxResults: 10, maxCities: 1 })
    const edit = adaptDshCommit({ intent: { kind: 'travel_guide', parameters: {
      questions: ['Make the second afternoon quieter'], researchTypes: ['activity', 'event'],
      requiredEvidenceTypes: ['activity'], allowPartial: true } }, replaceSlots: [{ day: 2, slot: 'afternoon' }],
      days: [{ day: 2, kind: 'visit', theme: 'Quiet garden', items: [{
        candidateRef: guideCandidateRef({ ownerId, tripId: trip.id, tripContextVersion: freshTrip.version }, research, 'garden'),
        timeOfDay: 'afternoon', planningNote: 'Enjoy a quiet garden visit at a slower pace.', text: {
          name: 'Quiet garden visit', introduction: 'Walk through quiet garden paths.', recommendationReason: 'A slower visit fits the requested pace.' } }] }],
      text: { reply: 'The second afternoon has a quieter garden visit.', overview: 'Keep the cultural visits and take a slower garden afternoon.',
        days: [{ day: 2, theme: 'Quiet garden' }] } }, prepared)
    const editGeneration = randomUUID()
    const editContext = { ...context, generationId: editGeneration, requestId: randomUUID(), artifacts: freshArtifacts,
      goalRepository: freshGoals, goalRunRepository: freshRuns, guideBaseCondition: prepared.baseGuide,
      activeGoalId: undefined, activeGoalRunId: undefined, activeGoalKind: undefined, activeGoalContextVersion: undefined, acceptedGoalIntent: undefined } as ToolExecutionContext
    const editTool = createCommitGuideTool({ evidenceStore: new DshEvidenceStore({ ownerId, tripId: trip.id,
      conversationId: conversation.id, generationId: editGeneration, tripContextVersion: freshTrip.version }), locale: 'en' })
    const originalGoal = await freshGoals.get(guide.goalId!)
    const beforeRecords = await freshArtifacts.listForTrip(trip.id)
    const tooSmall = { ...edit, intent: { kind: 'travel_guide', parameters: { ...(edit.intent as any).parameters, maxResults: 6 } } }
    await expect(editTool.execute(editTool.inputSchema.parse(tooSmall), editContext, new AbortController().signal))
      .rejects.toMatchObject({ details: { code: 'guide_edit_result_limit', selectedFindingCount: 8, maxResults: 6 } })
    expect(editContext.activeGoalId).toBeUndefined()
    expect(await freshArtifacts.listForTrip(trip.id)).toEqual(beforeRecords)
    const result = await editTool.execute(editTool.inputSchema.parse(edit), editContext, new AbortController().signal) as any
    expect(result).toMatchObject({ status: 'accepted', completion: { status: 'satisfied' } })
    const restored = (await new PostgresArtifactRepository(db, ownerId).get(result.artifact.id))!
    const afterGuide = travelGuideArtifactPayloadSchema.parse(restored.payload), beforeGuide = travelGuideArtifactPayloadSchema.parse(guide.payload)
    expect(afterGuide.days[0]).toEqual(beforeGuide.days[0])
    expect(afterGuide.days[1]!.items[0]).toEqual(beforeGuide.days[1]!.items[0])
    expect(afterGuide.supportingEvidence).toEqual(beforeGuide.supportingEvidence)
    expect(publicationFor(restored)?.finalization?.variants.en?.status).toBe('accepted')
    expect(await freshGoals.get(guide.goalId!)).toEqual(originalGoal)
  }, 30_000)

  it('captures the exact accepted guide from preparation and rejects a waiting edit after a concurrent winner publishes', async () => {
    const { trip, conversation } = await createTrip()
    const first = await makeAccepted(trip.id, conversation.id, 'first')
    const prepared = prepareDshSnapshot({ trip: trip.context, records: await first.artifacts.listForTrip(trip.id),
      conversationId: conversation.id, selectedFlight: null, locale: 'en' })
    expect(prepared.baseGuide).toEqual(first.base)

    const staleDraft = await createGuide(trip.id, conversation.id, 'stale-edit')
    const winner = await createGuide(trip.id, conversation.id, 'winner')
    const blocker = await pool.connect()
    let committed = false
    let pending: Promise<unknown> | undefined
    try {
      await blocker.query('begin')
      await blocker.query('select id from trips where public_id = $1 for update', [trip.id])
      pending = staleDraft.artifacts.saveFinalVariant(staleDraft.record.id, staleDraft.publication.guideContentHash,
        'en', staleDraft.variant, undefined, first.base).then(value => ({ value }), error => ({ error }))
      await waitForTripLockWait()

      const winnerPayload = winner.record.payload as Record<string, unknown>
      const publication = winnerPayload.publication as Record<string, unknown>
      const persisted = { ...winnerPayload, publication: { ...publication,
        finalization: { version: 1, variants: { en: winner.variant } } } }
      await blocker.query('update artifacts set payload_json = $1::jsonb, created_at = clock_timestamp() where public_id = $2',
        [JSON.stringify(persisted), winner.record.id])
      await blocker.query('commit')
      committed = true
      await expect(pending).resolves.toMatchObject({ error: { code: 'PUBLICATION_CONTENT_CHANGED' } })
      const recovery = new PostgresArtifactRepository(recoveryDb, ownerId)
      expect(publicationFor((await recovery.get(winner.record.id))!)?.finalization?.variants.en?.status).toBe('accepted')
      expect(publicationFor((await recovery.get(staleDraft.record.id))!)?.finalization?.variants.en).toBeUndefined()
    } finally {
      if (!committed) await blocker.query('rollback')
      blocker.release()
      await pending
    }
  }, 30_000)

  it('rechecks Trip context and selected-flight revisions after waiting for the locked Trip row', async () => {
    const { trip, conversation } = await createTrip()
    const accepted = await makeAccepted(trip.id, conversation.id, 'base')
    const staleTripDraft = await createGuide(trip.id, conversation.id, 'trip-stale')
    const blocker = await pool.connect()
    let committed = false
    let pending: Promise<unknown> | undefined
    try {
      await blocker.query('begin')
      await blocker.query('select id from trips where public_id = $1 for update', [trip.id])
      const changedContext = { ...trip.context, version: trip.context.version + 1, interests: ['updated during generation'] }
      await blocker.query('insert into trip_context_versions (trip_id, version, context_json) select id, $2, $3::jsonb from trips where public_id = $1',
        [trip.id, changedContext.version, JSON.stringify(changedContext)])
      await blocker.query('update trips set current_context_version = $2 where public_id = $1', [trip.id, changedContext.version])
      pending = staleTripDraft.artifacts.saveFinalVariant(staleTripDraft.record.id, staleTripDraft.publication.guideContentHash,
        'en', staleTripDraft.variant, undefined, accepted.base).then(value => ({ value }), error => ({ error }))
      await waitForTripLockWait()
      await blocker.query('commit')
      committed = true
      await expect(pending).resolves.toMatchObject({ error: { code: 'PUBLICATION_CONTENT_CHANGED' } })
    } finally {
      if (!committed) await blocker.query('rollback')
      blocker.release()
      await pending
    }

    const { trip: flightTrip, conversation: flightConversation } = await createTrip()
    const flightId = randomUUID()
    const selection = { kind: 'offer', artifactId: flightId, offerId: 'offer-one', layoverPreference: 'airport_only',
      contextVersion: 0, revision: 1, selectedAt: new Date().toISOString() }
    await db.updateTable('trips').set({ saved_route_json: JSON.stringify(selection) })
      .where('public_id', '=', flightTrip.id).execute()
    const flightBase = await makeAccepted(flightTrip.id, flightConversation.id, 'flight-base', selection)
    const flightDraft = await createGuide(flightTrip.id, flightConversation.id, 'flight-stale', selection)
    const flightBlocker = await pool.connect()
    let flightCommitted = false
    let flightPending: Promise<unknown> | undefined
    try {
      await flightBlocker.query('begin')
      await flightBlocker.query('select id from trips where public_id = $1 for update', [flightTrip.id])
      flightPending = flightDraft.artifacts.saveFinalVariant(flightDraft.record.id, flightDraft.publication.guideContentHash,
        'en', flightDraft.variant, undefined, flightBase.base).then(value => ({ value }), error => ({ error }))
      await waitForTripLockWait()
      await flightBlocker.query('update trips set saved_route_json = $2::jsonb where public_id = $1', [flightTrip.id,
        JSON.stringify({ ...selection, artifactId: randomUUID(), offerId: 'offer-two', revision: 2 })])
      await flightBlocker.query('commit')
      flightCommitted = true
      await expect(flightPending).resolves.toMatchObject({ error: { code: 'PUBLICATION_CONTENT_CHANGED' } })

      const recovery = await new PostgresArtifactRepository(recoveryDb, ownerId).get(flightBase.record.id)
      expect(publicationFor(recovery!)?.finalization?.variants.en?.status).toBe('accepted')
      await expect(new PostgresArtifactRepository(recoveryDb, ownerId).saveFinalVariant(flightBase.record.id,
        flightBase.publication.guideContentHash, 'en', flightBase.variant)).rejects.toMatchObject({ code: 'PUBLICATION_ATTEMPT_CHANGED' })
      expect((await new PostgresArtifactRepository(recoveryDb, ownerId).get(flightBase.record.id))?.updatedAt).toBe(flightBase.record.updatedAt)
    } finally {
      if (!flightCommitted) await flightBlocker.query('rollback')
      flightBlocker.release()
      await flightPending
    }
  }, 30_000)
})
