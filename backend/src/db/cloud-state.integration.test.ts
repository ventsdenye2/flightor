import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Kysely, PostgresDialect } from 'kysely'
import pg from 'pg'
import { up as createInitialSchema } from './migrations/001_initial.js'
import { up as createCloudStateSchema } from './migrations/006_cloud_state.js'
import type { Database } from './types.js'
import { PostgresUserIdentityRepository } from '../identity/postgres.js'
import { PostgresTripRepository } from '../trips/postgres.js'
import { PostgresConversationRepository } from '../conversations/postgres.js'
import { PostgresArtifactRepository } from '../artifacts/postgres.js'
import { PostgresUserMemoryRepository } from '../memory/postgres.js'

const databaseUrl = process.env.TEST_DATABASE_URL
const suite = databaseUrl ? describe : describe.skip

suite('Phase 2 PostgreSQL integration', () => {
  let db: Kysely<Database>
  let userA = ''
  let userB = ''

  beforeAll(async () => {
    db = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: databaseUrl }) }) })
    await createInitialSchema(db)
    await createCloudStateSchema(db)
    const identities = new PostgresUserIdentityRepository(db)
    const first = await identities.resolveWechat({ providerSubject: 'phase2-user-a', nickname: 'A', avatarUrl: '' })
    const duplicate = await identities.resolveWechat({ providerSubject: 'phase2-user-a', nickname: 'A2', avatarUrl: '' })
    const second = await identities.resolveWechat({ providerSubject: 'phase2-user-b', nickname: 'B', avatarUrl: '' })
    expect(duplicate.userId).toBe(first.userId)
    userA = first.userId
    userB = second.userId
  }, 30_000)

  afterAll(async () => { await db?.destroy() })

  it('enforces trip snapshots, conversations, artifacts, memory, and cross-user ownership', async () => {
    const tripsA = new PostgresTripRepository(db, userA)
    const tripsB = new PostgresTripRepository(db, userB)
    const trip = await tripsA.create({ title: 'Postgres contract' })
    expect((await tripsA.update(trip.id, { notes: ['cloud'] }, 0)).version).toBe(1)
    await expect(tripsA.update(trip.id, { notes: ['stale'] }, 0)).rejects.toMatchObject({ code: 'TRIP_CONTEXT_VERSION_CONFLICT' })
    await expect(tripsB.getTrip(trip.id)).resolves.toBeUndefined()

    const conversationsA = new PostgresConversationRepository(db, userA)
    const conversationsB = new PostgresConversationRepository(db, userB)
    const conversation = await conversationsA.create({ tripId: trip.id })
    await conversationsA.appendMessage({ conversationId: conversation.id, role: 'user', content: 'hello', metadata: { trace_ref: 'trace-1' } })
    expect((await conversationsA.listMessages(conversation.id))[0]?.metadata).toEqual({ trace_ref: 'trace-1' })
    await expect(conversationsB.get(conversation.id)).resolves.toBeUndefined()

    const artifactsA = new PostgresArtifactRepository(db, userA)
    const artifactsB = new PostgresArtifactRepository(db, userB)
    const artifact = await artifactsA.create({
      tripId: trip.id, conversationId: conversation.id, type: 'flight_search', schemaVersion: 1,
      payload: { id: 'payload-artifact', type: 'flight_search', offers: [] },
      verification: { status: 'verified' }
    })
    expect(await artifactsA.get(artifact.id)).toMatchObject({ schemaVersion: 1, type: 'flight_search' })
    await expect(artifactsB.get(artifact.id)).resolves.toBeUndefined()

    const memoryA = new PostgresUserMemoryRepository(db, userA)
    const memoryB = new PostgresUserMemoryRepository(db, userB)
    expect(await memoryA.get()).toMatchObject({ enabled: true, markdown: '', version: 0 })
    expect(await memoryA.updateMarkdown('# Long-term', 0)).toMatchObject({ version: 1 })
    expect(await memoryA.setEnabled(false, 1)).toMatchObject({ enabled: false, markdown: '# Long-term', version: 2 })
    await expect(memoryA.getForAgent()).resolves.toBeUndefined()
    expect(await memoryA.updateMarkdown('# Explicit edit while disabled', 2)).toMatchObject({ enabled: false, version: 3 })
    await expect(memoryA.getForAgent()).resolves.toBeUndefined()
    await expect(memoryA.setEnabled(true, 2)).rejects.toMatchObject({ code: 'USER_MEMORY_VERSION_CONFLICT' })
    await expect(memoryB.get()).resolves.toMatchObject({ markdown: '', version: 0 })
  }, 30_000)
})
