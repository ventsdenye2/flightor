import { describe, expect, it } from 'vitest'
import { DshEvidenceStore, InMemoryDshEvidenceRepository, convertCandidatesToResearch, inspectCandidateTemporalEvidence, type DshEvidenceScope } from './evidence.js'
import type { LocationRef } from '../../aviation/types.js'
import type { ResearchBrief } from '../../research-agent/types.js'

const scope: DshEvidenceScope = { ownerId: 'owner-1', tripId: 'trip-1', conversationId: 'conversation-1', generationId: 'generation-1', tripContextVersion: 3 }
const tokyo: LocationRef = { id: 'city:TYO', type: 'city', name: 'Tokyo', countryCode: 'JP', cityCode: 'TYO' }
const brief: ResearchBrief = { destinations: [tokyo], interests: ['culture'], questions: ['What to visit?'], researchTypes: ['activity'] }
const clock = () => new Date('2026-09-24T08:00:00.000Z')

function store(repository = new InMemoryDshEvidenceRepository()) {
  return new DshEvidenceStore(scope, { repository, now: clock })
}

describe('DSH evidence capture', () => {
  it('records canonical search sources, including truncated snippets, as untrusted', async () => {
    const evidence = store()
    const captured = await evidence.recordSearch({ sources: [
      { url: 'https://example.com/place#section', title: 'Museum', snippet: 'Visitor information.' }
    ], truncated: true }, 'deepseek-web-search', 'tool-1')

    expect(captured.urls).toEqual(['https://example.com/place'])
    expect(captured.evidenceRefs).toHaveLength(1)
    expect(captured.sourceRefs).toHaveLength(1)
    expect(captured.sourceRefs[0]).toMatch(/^s1\.[a-f0-9]{10}\.[a-f0-9]{10}\.1$/)
    const record = await evidence.get(captured.evidenceRefs[0]!)
    expect(await evidence.get(captured.sourceRefs[0]!)).toEqual(record)
    expect(record).toMatchObject({ ...scope, provider: 'deepseek-web-search', toolCallId: 'tool-1', depth: 'search_snippet',
      status: 'available', truncated: true, untrusted: true, snippet: 'Visitor information.' })
    expect(record?.contentHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('keeps source aliases bound to their generation, Trip version, and evidence hash', async () => {
    const repository = new InMemoryDshEvidenceRepository()
    const evidence = store(repository)
    const captured = await evidence.recordSearch({ sources: [{ url: 'https://example.com/place', snippet: 'Current source.' }] }, 'web-search', 'tool-current')
    const changed = await evidence.recordSearch({ sources: [{ url: 'https://example.com/place', snippet: 'Changed source.' }] }, 'web-search', 'tool-changed')
    const foreign = new DshEvidenceStore({ ...scope, generationId: 'generation-2' }, { repository, now: clock })
    expect(await foreign.get(captured.sourceRefs[0]!)).toBeNull()
    expect(await foreign.get(captured.evidenceRefs[0]!)).toBeNull()
    expect(changed.sourceRefs[0]).not.toBe(captured.sourceRefs[0])
    expect((await evidence.get(captured.sourceRefs[0]!))?.contentHash).not.toBe((await evidence.get(changed.sourceRefs[0]!))?.contentHash)
  })

  it('keeps canonical SHA-256 evidence references on the repository lookup path', async () => {
    const ref = 'a'.repeat(64)
    const repository = new InMemoryDshEvidenceRepository()
    const originalStore = store(repository)
    const captured = await originalStore.recordSearch({ sources: [{ url: 'https://example.com/place', snippet: 'SHA-backed current-scope evidence.' }] },
      'web-search', 'tool-sha-ref')
    const original = await repository.get(captured.evidenceRefs[0]!)
    const record = { ...original!, evidenceRef: ref }
    await repository.put(record)
    const current = new DshEvidenceStore(scope, { repository, now: clock })

    await expect(current.get(ref)).resolves.toEqual(record)
    await expect(new DshEvidenceStore({ ...scope, ownerId: 'other-owner' }, { repository }).get(ref)).resolves.toBeNull()
    await expect(new DshEvidenceStore({ ...scope, tripContextVersion: scope.tripContextVersion + 1 }, { repository }).get(ref)).resolves.toBeNull()
  })

  it('accepts short source aliases when mapping candidates and keeps legacy UUID refs', async () => {
    const evidence = store()
    const captured = await evidence.recordSearch({ sources: [{ url: 'https://example.com/place', snippet: 'Original provider snippet.' }] }, 'web-search', 'tool-short-ref')
    expect(captured.evidenceRefs[0]).toMatch(/^[0-9a-f-]{36}$/)
    const artifact = await convertCandidatesToResearch({ artifactId: 'research-short-ref', brief, candidates: [{ key: 'finding-short-ref', evidenceRefs: captured.sourceRefs,
      title: 'Curated title', summary: 'Model-authored summary.', category: 'activity', location: tokyo }] }, evidence)
    expect(artifact.findings[0]?.sources[0]?.snippet).toBe('Original provider snippet.')
  })

  it('captures fetch text and records final URL, status, hash, and truncation state', async () => {
    const evidence = store()
    const captured = await evidence.recordFetch('https://example.com/request', {
      url: 'https://example.com/final', statusCode: 200, body: { kind: 'text', content: 'Official visitor page.' }, truncated: true
    }, 'deepseek-web-fetch', 'tool-2')
    const record = await evidence.get(captured.evidenceRefs[0]!)

    expect(record).toMatchObject({ url: 'https://example.com/request', finalUrl: 'https://example.com/final',
      depth: 'fetched_body', status: 'available', statusCode: 200, truncated: true, body: 'Official visitor page.' })
  })

  it('does not expose non-2xx, absent-body, or errored fetches as evidence references', async () => {
    const evidence = store()
    const notFound = await evidence.recordFetch('https://example.com/missing', {
      statusCode: 404, body: { kind: 'text', content: 'Not found page' }, truncated: false
    }, 'web-fetch', 'tool-3')
    const empty = await evidence.recordFetch('https://example.com/empty', {
      statusCode: 200, body: { kind: 'text', content: '' }, truncated: false
    }, 'web-fetch', 'tool-4')
    const errored = await evidence.recordFetch('https://example.com/error', {
      statusCode: 200, body: { kind: 'text', content: 'partial body' }, error: 'tool failed', truncated: false
    }, 'web-fetch', 'tool-5')

    expect(notFound.evidenceRefs).toEqual([])
    expect(empty.evidenceRefs).toEqual([])
    expect(errored.evidenceRefs).toEqual([])
  })

  it('converts only store-backed refs, and keeps candidate summaries separate from provider source text', async () => {
    const evidence = store()
    const captured = await evidence.recordSearch({ sources: [{ url: 'https://example.com/place', title: 'Official Place', snippet: 'Original provider snippet.' }], truncated: false }, 'web-search', 'tool-6')
    const artifact = await convertCandidatesToResearch({ artifactId: 'research-1', brief, candidates: [{ key: 'finding-1', evidenceRefs: captured.evidenceRefs,
      title: 'Curated title', summary: 'Model-authored summary.', category: 'activity', location: tokyo }] }, evidence)
    const finding = artifact.findings[0]!

    expect(finding.summary).toBe('Model-authored summary.')
    expect(finding.sources[0]?.snippet).toBe('Original provider snippet.')
    expect(finding.sources[0]?.snippet).not.toBe(finding.summary)
    expect(finding.verification.status).toBe('partially_verified')
    expect(finding.warnings).toContain('web_content_untrusted')
  })

  it('binds CJK event dates to an exact quote in the selected fetched source and preserves partial verification', async () => {
    const evidence = store()
    const pageText = '菊花壇展開催期間は2026年11月1日(日)～11月15日(日)です。'
    const captured = await evidence.recordFetch('https://example.com/event', { url: 'https://example.com/event/final', statusCode: 200,
      body: { kind: 'text', content: pageText }, snippet: '菊花壇展の案内。' }, 'web-fetch', 'tool-event')
    const candidate = { key: 'event', evidenceRefs: captured.sourceRefs, title: 'Flower exhibition', summary: 'A seasonal display. ',
      category: 'event' as const, location: tokyo, temporalEvidence: { from: '2026-11-01', to: '2026-11-15',
        sourceRef: captured.sourceRefs[0]!, quote: '2026年11月1日(日)～11月15日(日)' } }

    const artifact = await convertCandidatesToResearch({ artifactId: 'research-event', brief: { ...brief, researchTypes: ['event'] }, candidates: [candidate] }, evidence)

    expect(artifact.findings[0]?.temporalEvidence).toEqual({ from: '2026-11-01', to: '2026-11-15',
      sourceUrl: 'https://example.com/event/final', quote: candidate.temporalEvidence.quote })
    expect(artifact.findings[0]?.sources[0]?.page?.text).toBe(pageText)
    expect(artifact.findings[0]?.verification.status).toBe('partially_verified')
  })

  it('persists selected CJK temporal evidence to Research v2 after removing the compact sourceRef', async () => {
    const evidence = store()
    const quote = '会期は2026年11月1日(日)～11月15日(日)です。'
    const captured = await evidence.recordFetch('https://example.com/event', { statusCode: 200,
      body: { kind: 'text', content: quote }, snippet: '会期のお知らせ。' }, 'web-fetch', 'tool-event-persist')
    const temporalEvidence = { from: '2026-11-01', to: '2026-11-15', sourceRef: captured.sourceRefs[0]!, quote: '2026年11月1日(日)～11月15日(日)' }
    const artifact = await convertCandidatesToResearch({ artifactId: 'research-event-persist', brief: { ...brief, researchTypes: ['event'] }, candidates: [{
      key: 'event', evidenceRefs: captured.sourceRefs, title: 'Flower exhibition', summary: 'A seasonal display.', category: 'event', location: tokyo, temporalEvidence
    }] }, evidence)

    expect(artifact.findings[0]?.temporalEvidence).toEqual({ from: temporalEvidence.from, to: temporalEvidence.to,
      sourceUrl: 'https://example.com/event', quote: temporalEvidence.quote })
    expect(artifact.findings[0]?.temporalEvidence).not.toHaveProperty('sourceRef')
  })

  it('validates the specifically selected receipt when search and fetch receipts share a URL', async () => {
    const evidence = store()
    const url = 'https://example.com/event'
    const search = await evidence.recordSearch({ sources: [{ url, snippet: 'Event page and visitor details.' }] }, 'web-search', 'event-search')
    const quote = 'The festival runs 2026-11-01 through 2026-11-15.'
    const fetched = await evidence.recordFetch(url, { statusCode: 200, body: { kind: 'text', content: `Official dates: ${quote}` } }, 'web-fetch', 'event-fetch')
    const artifact = await convertCandidatesToResearch({ artifactId: 'research-same-url', brief: { ...brief, researchTypes: ['event'] }, candidates: [{
      key: 'event', evidenceRefs: [...search.sourceRefs, ...fetched.sourceRefs], title: 'Tokyo festival', summary: 'An event.', category: 'event', location: tokyo,
      temporalEvidence: { from: '2026-11-01', to: '2026-11-15', sourceRef: fetched.sourceRefs[0]!, quote }
    }] }, evidence)

    expect(artifact.findings[0]?.temporalEvidence).toMatchObject({ sourceUrl: url, quote })
    expect(artifact.findings[0]?.sources).toHaveLength(2)
    await expect(inspectCandidateTemporalEvidence({ key: 'event', evidenceRefs: [...search.sourceRefs, ...fetched.sourceRefs],
      title: 'Tokyo festival', summary: 'An event.', category: 'event', location: tokyo,
      temporalEvidence: { from: '2026-11-01', to: '2026-11-15', sourceRef: search.sourceRefs[0]!, quote }
    }, evidence)).resolves.toBe('quote_not_found')
  })

  it('rejects a temporal source outside the candidate sourceRefs and a cross-scope temporal ref', async () => {
    const repository = new InMemoryDshEvidenceRepository()
    const evidence = store(repository)
    const own = await evidence.recordSearch({ sources: [{ url: 'https://example.com/event', snippet: '2026-11-01 through 2026-11-15.' }] }, 'web-search', 'own')
    const temporalEvidence = { from: '2026-11-01', to: '2026-11-15', sourceRef: own.sourceRefs[0]!, quote: '2026-11-01 through 2026-11-15' }
    const base = { key: 'event', evidenceRefs: own.sourceRefs, title: 'Event', summary: 'Event summary', category: 'event' as const, location: tokyo }

    await expect(inspectCandidateTemporalEvidence({ ...base, temporalEvidence: { ...temporalEvidence, sourceRef: 's1.unselected.ref.1' } }, evidence))
      .resolves.toBe('source_not_selected')

    const foreign = new DshEvidenceStore({ ...scope, ownerId: 'foreign-owner' }, { repository })
    const foreignSource = await foreign.recordSearch({ sources: [{ url: 'https://example.com/event', snippet: '2026-11-01 through 2026-11-15.' }] }, 'web-search', 'foreign')
    await expect(inspectCandidateTemporalEvidence({ ...base, evidenceRefs: foreignSource.sourceRefs,
      temporalEvidence: { ...temporalEvidence, sourceRef: foreignSource.sourceRefs[0]! } }, evidence)).resolves.toBe('unavailable')
  })

  it('reports an exact-source date mismatch separately from a missing quote', async () => {
    const evidence = store()
    const captured = await evidence.recordSearch({ sources: [{ url: 'https://example.com/event',
      snippet: 'The event runs 2026-11-01 through 2026-11-15.' }] }, 'web-search', 'event')
    const base = { key: 'event', evidenceRefs: captured.sourceRefs, title: 'Event', summary: 'Event summary', category: 'event' as const, location: tokyo }

    await expect(inspectCandidateTemporalEvidence({ ...base, temporalEvidence: { from: '2026-11-01', to: '2026-11-16',
      sourceRef: captured.sourceRefs[0]!, quote: 'The event runs 2026-11-01 through 2026-11-15.' } }, evidence)).resolves.toBe('date_mismatch')
    await expect(inspectCandidateTemporalEvidence({ ...base, temporalEvidence: { from: '2026-11-01', to: '2026-11-15',
      sourceRef: captured.sourceRefs[0]!, quote: 'The event runs 2026-11-01 through 2026-11-16.' } }, evidence)).resolves.toBe('quote_not_found')
  })

  it('rejects fabricated refs, foreign scope refs, and locations outside the trusted brief', async () => {
    const repository = new InMemoryDshEvidenceRepository()
    const evidence = store(repository)
    const captured = await evidence.recordSearch({ sources: [{ url: 'https://example.com/place', snippet: 'Original snippet.' }] }, 'web-search', 'tool-7')
    const candidate = { key: 'finding-1', title: 'Place', summary: 'Summary', category: 'activity' as const, location: tokyo }

    await expect(convertCandidatesToResearch({ artifactId: 'research-2', brief, candidates: [{ ...candidate, evidenceRefs: ['invented-ref'] }] }, evidence)).rejects.toThrow(/evidence is unavailable/)
    const foreign = new DshEvidenceStore({ ...scope, tripId: 'trip-elsewhere' }, { repository, now: clock })
    await expect(convertCandidatesToResearch({ artifactId: 'research-3', brief, candidates: [{ ...candidate, evidenceRefs: captured.evidenceRefs }] }, foreign)).rejects.toThrow(/evidence is unavailable/)
    const wrongLocation = { ...tokyo, id: 'city:OSA', name: 'Osaka', cityCode: 'OSA' }
    await expect(convertCandidatesToResearch({ artifactId: 'research-4', brief, candidates: [{ ...candidate, evidenceRefs: captured.evidenceRefs, location: wrongLocation }] }, evidence)).rejects.toThrow(/location is outside brief/)
  })

  it('does not upgrade search failures or empty snippets', async () => {
    const evidence = store()
    const result = await evidence.recordSearch({ status: 'error', sources: [
      { url: 'https://example.com/failure', snippet: 'Must not be accepted.' },
      { url: 'https://example.com/empty', snippet: '' }
    ], truncated: false }, 'web-search', 'tool-8')
    expect(result.evidenceRefs).toEqual([])
  })
})
