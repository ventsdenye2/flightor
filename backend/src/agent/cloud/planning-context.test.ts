import { describe, expect, it } from 'vitest'
import { InMemoryArtifactRepository } from '../../artifacts/repository.js'
import { InMemoryGoalRepository, InMemoryGoalRunRepository } from '../goals/repository.js'
import type { GoalArtifactRef } from '../goals/types.js'
import { preparePlanningContext, PLANNING_CONTEXT_LIMITS } from './planning-context.js'
import type { ResearchArtifact, ResearchBrief } from '../../research-agent/types.js'
import type { TripContext } from '../../trips/types.js'

const OWNER_A = 'owner-a'
const OWNER_B = 'owner-b'
const TRIP_ID = 'trip-a'
const OTHER_TRIP_ID = 'trip-b'
const VERSION = 2
const NOW = '2026-09-20T00:00:00.000Z'

const tokyo = { id: 'tokyo', type: 'city' as const, name: 'Tokyo', countryCode: 'JP', cityCode: 'TYO' }
const trip: TripContext = {
  id: TRIP_ID,
  destinationIntent: { mode: 'explicit', required: [tokyo], preferred: [], excluded: [] },
  departureWindow: { from: '2026-10-01', to: '2026-10-01', precision: 'exact' },
  returnWindow: { from: '2026-10-03', to: '2026-10-03', precision: 'exact' },
  travelDays: 3,
  interests: ['food'], priorities: {}, transferPreferences: {}, locationRoleOverrides: [],
  mustIncludeEvents: [], requiredGroundLegs: [], notes: [], version: VERSION
}

const iso = (day: string) => `${day}T00:00:00.000Z`
const source = (id: string) => ({
  title: `Source ${id}`, url: `https://example.com/${id}`, domain: 'example.com',
  snippet: `Evidence for ${id}`, authority: 'official_venue' as const
})

type FindingOptions = {
  category?: ResearchArtifact['findings'][number]['category']
  id?: string
  verification?: Partial<ResearchArtifact['findings'][number]['verification']>
  destination?: typeof tokyo
  summary?: string
}

function finding(index: number, options: FindingOptions = {}) {
  const id = options.id ?? `finding-${index}`
  const evidence = source(id)
  return {
    id,
    category: options.category ?? 'activity',
    destinations: [options.destination ?? tokyo],
    title: `Finding ${id}`,
    summary: options.summary ?? `Useful evidence for ${id}`,
    sources: [evidence],
    verification: {
      status: 'verified' as const,
      checkedAt: NOW,
      confidence: 0.9,
      sources: [{ provider: 'fixture', reference: evidence.url }],
      ...options.verification
    },
    warnings: []
  }
}

function researchPayload(
  id: string,
  findings: ReturnType<typeof finding>[],
  options: { types?: ResearchBrief['researchTypes']; from?: string; to?: string; extra?: Record<string, unknown> } = {}
): ResearchArtifact {
  return {
    id,
    type: 'research',
    schemaVersion: 2,
    brief: {
      destinations: [tokyo],
      travelWindow: options.from || options.to ? { from: options.from, to: options.to } : undefined,
      interests: ['food'], questions: ['What should we do?'],
      researchTypes: options.types ?? ['activity'], maxResults: 20
    },
    findings,
    queryCount: 1,
    warnings: [],
    uncertainties: [],
    createdAt: NOW,
    ...options.extra
  } as ResearchArtifact
}

async function addResearch(
  repo: InMemoryArtifactRepository,
  id: string,
  findings: ReturnType<typeof finding>[],
  options: Parameters<typeof researchPayload>[2] = {},
  artifactOptions: { tripId?: string; schemaVersion?: number; tripContextVersion?: number; omitTripContextVersion?: boolean } = {}
) {
  const input = {
    id,
    tripId: artifactOptions.tripId ?? TRIP_ID,
    type: 'research', schemaVersion: artifactOptions.schemaVersion ?? 2,
    payload: researchPayload(id, findings, options)
  } as Parameters<InMemoryArtifactRepository['create']>[0]
  if (!artifactOptions.omitTripContextVersion) input.tripContextVersion = artifactOptions.tripContextVersion ?? VERSION
  return repo.create(input)
}

function goalInput(id: string, ownerTrip = TRIP_ID) {
  return {
    id,
    tripId: ownerTrip,
    kind: 'travel_guide' as const,
    parameters: {
      questions: ['Plan the trip'], researchTypes: ['activity' as const], maxResults: 8,
      maxCities: 1, allowPartial: false
    },
    createdContextVersion: VERSION,
    idempotencyKey: `goal-key-${id}`
  }
}

function goalRef(id: string): GoalArtifactRef {
  return { id, type: 'research', schemaVersion: 2, observedAt: NOW }
}

describe('preparePlanningContext', () => {
  it('keeps artifact data owner and Trip scoped, and re-reads run refs through that scope', async () => {
    const sharedArtifacts = new Map()
    const artifactsA = new InMemoryArtifactRepository(OWNER_A, new Set([TRIP_ID, OTHER_TRIP_ID]), sharedArtifacts)
    const artifactsB = new InMemoryArtifactRepository(OWNER_B, new Set([TRIP_ID]), sharedArtifacts)
    const artifactA = await addResearch(artifactsA, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', [finding(1)])
    const artifactB = await addResearch(artifactsB, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', [finding(2)])
    await addResearch(artifactsA, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', [finding(3)], {}, { tripId: OTHER_TRIP_ID })

    const sharedGoals = new Map()
    const sharedRuns = new Map()
    const goalsA = new InMemoryGoalRepository(OWNER_A, sharedGoals)
    const goalsB = new InMemoryGoalRepository(OWNER_B, sharedGoals)
    const goalA = await goalsA.create(goalInput('11111111-1111-4111-8111-111111111111'))
    const goalB = await goalsB.create(goalInput('22222222-2222-4222-8222-222222222222'))
    const runsA = new InMemoryGoalRunRepository(OWNER_A, goalsA, sharedRuns)
    const runsB = new InMemoryGoalRunRepository(OWNER_B, goalsB, sharedRuns)
    const runA = await runsA.create({
      id: '33333333-3333-4333-8333-333333333333', goalId: goalA.goal.id, tripId: TRIP_ID,
      generationId: 'generation-a', contextVersion: VERSION, contextSnapshot: trip, idempotencyKey: 'run-a'
    })
    await runsA.update(runA.run.id, 0, { status: 'running', workingSet: { artifactRefs: [goalRef(artifactA.id), goalRef(artifactB.id)], locationHandles: [] } })
    await runsB.create({
      id: '44444444-4444-4444-8444-444444444444', goalId: goalB.goal.id, tripId: TRIP_ID,
      generationId: 'generation-b', contextVersion: VERSION, contextSnapshot: trip, idempotencyKey: 'run-b'
    })

    const before = await artifactsA.listForTrip(TRIP_ID)
    const result = await preparePlanningContext({ trip, ownerId: OWNER_A, artifacts: artifactsA, goals: goalsA, runs: runsA, now: NOW })
    const context = JSON.parse(result.content)

    expect(context.unfinishedGoals.map((goal: { id: string }) => goal.id)).toEqual([goalA.goal.id])
    expect(context.research.map((item: { artifactId: string }) => item.artifactId)).toContain(artifactA.id)
    expect(context.research.map((item: { artifactId: string }) => item.artifactId)).not.toContain(artifactB.id)
    expect(context.research.map((item: { artifactId: string }) => item.artifactId)).not.toContain('cccccccc-cccc-4ccc-8ccc-cccccccccccc')
    expect((await goalsA.get(goalA.goal.id))?.status).toBe('pending')
    expect((await runsA.get(runA.run.id))?.status).toBe('running')
    expect(await artifactsA.listForTrip(TRIP_ID)).toHaveLength(before.length)
  })

  it('excludes legacy, missing, mismatched and malformed research envelopes', async () => {
    const artifacts = new InMemoryArtifactRepository(OWNER_A, new Set([TRIP_ID]))
    const good = await addResearch(artifacts, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', [finding(1)])
    await addResearch(artifacts, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', [finding(2)], {}, { schemaVersion: 1 })
    await addResearch(artifacts, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', [finding(3)], {}, { omitTripContextVersion: true })
    await addResearch(artifacts, 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', [finding(4)], {}, { tripContextVersion: 1 })
    await addResearch(artifacts, 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', [finding(5)], { extra: { id: 'payload-id-does-not-match-envelope' } })

    const result = await preparePlanningContext({ trip, artifacts, now: NOW })
    const context = JSON.parse(result.content)
    expect(context.research.map((item: { artifactId: string }) => item.artifactId)).toEqual([good.id])
    expect(context.omitted).toContain('incompatible_artifact_versions')
    expect(context.omitted).toContain('unsupported_or_invalid_research')
  })

  it('filters expired/unverified evidence and round-robins practical findings', async () => {
    const artifacts = new InMemoryArtifactRepository(OWNER_A, new Set([TRIP_ID]))
    const findings = [
      finding(1, { category: 'activity' }), finding(2, { category: 'activity' }), finding(3, { category: 'activity' }),
      finding(4, { category: 'activity' }), finding(5, { category: 'activity' }), finding(6, { category: 'activity' }),
      finding(7, { category: 'activity' }), finding(8, { category: 'activity' }), finding(9, { category: 'activity' }),
      finding(10, { category: 'practical' }), finding(11, { category: 'activity', verification: { status: 'unverified' } }),
      finding(12, { category: 'practical', verification: { expiresAt: '2026-09-19T00:00:00.000Z' } })
    ]
    const record = await addResearch(artifacts, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', findings, { types: ['activity', 'practical'] })
    const result = await preparePlanningContext({ trip, artifacts, now: NOW })
    const context = JSON.parse(result.content)
    const selected = context.research[0].findings as Array<{ id: string; category: string }>
    expect(selected.some(item => item.category === 'practical')).toBe(true)
    expect(selected.map(item => item.id)).not.toContain('finding-11')
    expect(selected.map(item => item.id)).not.toContain('finding-12')
    expect(context.evidenceCoverage[0].categories).toEqual(expect.arrayContaining(['activity', 'practical']))
    expect(context.research[0].artifactId).toBe(record.id)
  })

  it('reports date gaps as missing coverage and never calls incomplete evidence complete', async () => {
    const artifacts = new InMemoryArtifactRepository(OWNER_A, new Set([TRIP_ID]))
    await addResearch(artifacts, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', [finding(1, { category: 'activity' })], {
      types: ['activity', 'practical'], from: '2026-10-01', to: '2026-10-02'
    })
    const result = await preparePlanningContext({ trip, artifacts, now: NOW })
    const context = JSON.parse(result.content)
    expect(context.research[0].windowCoversTrip).toBe(false)
    expect(context.missingFromPreload).toEqual(['activity', 'practical'])
    expect(context.missingByDestination).toEqual([{ destinationId: tokyo.id, categories: ['activity', 'practical'] }])
    expect(context.policy).toContain('not exhaustive evidence or delivery acceptance')
  })

  it('keeps an inconsistent historical date snapshot readable without claiming coverage', async () => {
    const artifacts = new InMemoryArtifactRepository(OWNER_A, new Set([TRIP_ID]))
    await addResearch(artifacts, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', [finding(1, { category: 'activity' })], {
      types: ['activity', 'practical'], from: '2026-10-01', to: '2026-10-03'
    })
    const inconsistentTrip: TripContext = {
      ...trip,
      returnWindow: { from: '2026-09-30', to: '2026-09-30', precision: 'exact' }
    }
    const result = await preparePlanningContext({ trip: inconsistentTrip, artifacts, now: NOW })
    const context = JSON.parse(result.content)
    expect(context.dateStatus).toBe('needs_correction')
    expect(context.expectedTravelWindow).toBeNull()
    expect(context.research[0].windowCoversTrip).toBe(false)
    expect(context.missingByDestination).toEqual([{ destinationId: tokyo.id, categories: ['activity', 'practical'] }])
    expect(context.omitted).toContain('trip_dates_need_correction')
  })

  it('keeps serialized preload valid JSON under the character budget and records omission', async () => {
    const artifacts = new InMemoryArtifactRepository(OWNER_A, new Set([TRIP_ID]))
    for (let artifactIndex = 0; artifactIndex < 4; artifactIndex++) {
      await addResearch(artifacts, `${artifactIndex + 1}`.repeat(8) + '-4aaa-8aaa-aaaa' + `${artifactIndex + 1}`.repeat(8),
        Array.from({ length: 8 }, (_, index) => finding(index + artifactIndex * 8, { summary: 'x'.repeat(1_500) })),
        { types: ['activity'] })
    }
    const result = await preparePlanningContext({ trip, artifacts, now: NOW })
    expect(result.metrics.characters).toBeLessThanOrEqual(PLANNING_CONTEXT_LIMITS.characters)
    expect(() => JSON.parse(result.content)).not.toThrow()
    expect(JSON.parse(result.content).omitted).toContain('serialized_character_limit')
    expect(JSON.parse(result.content).policy).toContain('omitted')
  })

  it('propagates cancellation before reading repositories', async () => {
    const controller = new AbortController()
    controller.abort()
    const artifacts = new InMemoryArtifactRepository(OWNER_A, new Set([TRIP_ID]))
    await expect(preparePlanningContext({ trip, artifacts, signal: controller.signal })).rejects.toThrow()
  })
})
