import { describe, expect, it } from 'vitest'
import { admitDraftTemporalEvidence, supportedTemporalEvidence } from './temporal-evidence.js'

const sources = [
  { url: 'https://example.com/event', snippet: 'The festival runs 2026-10-26 through 2026-11-04.' },
  { url: 'https://example.com/other', snippet: 'Published 2026-09-20. The event date is late October.' }
]

describe('temporal evidence', () => {
  it('rejects reversed ranges', () => {
    expect(supportedTemporalEvidence({ sourceUrl: sources[0]!.url, from: '2026-11-04', to: '2026-10-26', quote: sources[0]!.snippet }, sources)).toBeUndefined()
  })
  it('rejects a fabricated quote', () => {
    expect(supportedTemporalEvidence({ sourceUrl: sources[0]!.url, from: '2026-10-26', to: '2026-11-04', quote: 'The festival runs 2026-10-26 through 2026-11-05.' }, sources)).toBeUndefined()
  })
  it('rejects a URL that is not in retrieved sources', () => {
    expect(supportedTemporalEvidence({ sourceUrl: 'https://evil.example/event', from: '2026-10-26', to: '2026-11-04', quote: sources[0]!.snippet }, sources)).toBeUndefined()
  })
  it('rejects an unselected source index', () => {
    expect(admitDraftTemporalEvidence({ sourceIndex: 1, from: '2026-10-26', to: '2026-11-04', quote: sources[0]!.snippet }, sources, [0])).toBeUndefined()
  })
  it('rejects fuzzy dates and dates that only describe retrieval metadata', () => {
    expect(admitDraftTemporalEvidence({ sourceIndex: 1, from: '2026-10-26', to: '2026-10-26', quote: sources[1]!.snippet }, sources, [1])).toBeUndefined()
    expect(admitDraftTemporalEvidence({ sourceIndex: 0, from: '2026-10-26', to: '2026-11-04', quote: 'Published 2026-09-20.' }, sources, [0])).toBeUndefined()
  })
  it('admits an explicit ISO single day and inclusive range', () => {
    const single = { url: 'https://example.com/single', snippet: 'Screening date: 2026-10-21.' }
    expect(admitDraftTemporalEvidence({ sourceIndex: 0, from: '2026-10-21', to: '2026-10-21', quote: single.snippet }, [single], [0])).toMatchObject({ from: '2026-10-21', to: '2026-10-21', sourceUrl: single.url })
    expect(admitDraftTemporalEvidence({ sourceIndex: 0, from: '2026-10-26', to: '2026-11-04', quote: sources[0]!.snippet }, sources, [0])).toMatchObject({ from: '2026-10-26', to: '2026-11-04', sourceUrl: sources[0]!.url })
  })
})
