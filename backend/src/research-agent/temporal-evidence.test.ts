import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
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

  it('matches duplicate URLs by exact content regardless of order and keeps draft sourceIndex authoritative', () => {
    const url = 'https://example.com/event'
    const quote = 'The event runs 2026-11-01 through 2026-11-15.'
    const summary = { url, snippet: 'Festival overview and visitor details.' }
    const bodyText = `Official dates: ${quote}`
    const body = { url, snippet: 'Official event page.', page: { text: bodyText, contentHash: createHash('sha256').update(bodyText).digest('hex') } }
    const evidence = { sourceUrl: url, from: '2026-11-01', to: '2026-11-15', quote }

    expect(supportedTemporalEvidence(evidence, [summary, body])).toMatchObject({ sourceUrl: url, quote })
    expect(supportedTemporalEvidence(evidence, [body, summary])).toMatchObject({ sourceUrl: url, quote })
    expect(admitDraftTemporalEvidence({ sourceIndex: 0, from: evidence.from, to: evidence.to, quote }, [summary, body], [0, 1])).toBeUndefined()
    expect(admitDraftTemporalEvidence({ sourceIndex: 1, from: evidence.from, to: evidence.to, quote }, [summary, body], [0, 1]))
      .toMatchObject({ sourceUrl: url, quote })
  })

  it('accepts one explicit CJK occurrence range from hash-verified page text', () => {
    const text = '会期は2026年11月1日(日)～11月15日(日)です。'
    const source = { url: 'https://example.com/event', snippet: 'Event information.',
      page: { text, contentHash: createHash('sha256').update(text).digest('hex') } }

    expect(supportedTemporalEvidence({ sourceUrl: source.url, from: '2026-11-01', to: '2026-11-15',
      quote: '2026年11月1日(日)～11月15日(日)' }, [source])).toMatchObject({ from: '2026-11-01', to: '2026-11-15' })
  })

  it('rejects a mismatched date range or page text whose content hash is wrong', () => {
    const text = '会期は2026年11月1日(日)～11月15日(日)です。'
    const page = { text, contentHash: createHash('sha256').update(text).digest('hex') }
    const quote = '2026年11月1日(日)～11月15日(日)'

    expect(supportedTemporalEvidence({ sourceUrl: 'https://example.com/event', from: '2026-11-01', to: '2026-11-16', quote }, [
      { url: 'https://example.com/event', snippet: 'Event information.', page }
    ])).toBeUndefined()
    expect(supportedTemporalEvidence({ sourceUrl: 'https://example.com/event', from: '2026-11-01', to: '2026-11-15', quote }, [
      { url: 'https://example.com/event', snippet: 'Event information.', page: { ...page, contentHash: '0'.repeat(64) } }
    ])).toBeUndefined()
    expect(supportedTemporalEvidence({ sourceUrl: 'https://example.com/event', from: '2026-11-01', to: '2026-11-15', quote }, [
      { url: 'https://example.com/event', snippet: quote, page: { ...page, contentHash: '0'.repeat(64) } }
    ])).toBeUndefined()
  })

  it('rejects publication, retrieval, and query-window dates even when copied exactly', () => {
    const cases: Array<[string, string]> = [
      ['Published 2026-11-01 through 2026-11-15.', 'Published 2026-11-01 through 2026-11-15.'],
      ['Published 2026-11-01 through 2026-11-15.', '2026-11-01 through 2026-11-15'],
      ['Published on 2026-11-01 through 2026-11-15.', '2026-11-01 through 2026-11-15'],
      ['Published from 2026-11-01 through 2026-11-15.', '2026-11-01 through 2026-11-15'],
      ...['检索日期为2026年11月1日～11月15日。', '发布日期：2026年11月1日～11月15日。',
        '最后更新日期是2026年11月1日～11月15日。', '抓取日期是2026年11月1日～11月15日。',
        '有效期为2026年11月1日～11月15日。', '查询窗口是2026年11月1日～11月15日。',
        '查询窗口为2026年11月1日～11月15日。', '検索期間は2026年11月1日～11月15日です。',
        '検索期間は2026年11月1日～11月15日です。'].map(text => [text, text]),
      ['查询窗口为2026年11月1日～11月15日。', '2026年11月1日～11月15日'],
      ['検索期間は2026年11月1日～11月15日です。', '2026年11月1日～11月15日']
    ]
    for (const [sourceText, quote] of cases) {
      const source = { url: 'https://example.com/event', snippet: sourceText }
      expect(supportedTemporalEvidence({ sourceUrl: source.url, from: '2026-11-01', to: '2026-11-15', quote }, [source])).toBeUndefined()
    }
    const separateOccurrence = { url: 'https://example.com/event',
      snippet: 'Published 2026-09-24; Event runs 2026-11-01 through 2026-11-15.' }
    expect(supportedTemporalEvidence({ sourceUrl: separateOccurrence.url, from: '2026-11-01', to: '2026-11-15',
      quote: 'Event runs 2026-11-01 through 2026-11-15.' }, [separateOccurrence])).toMatchObject({ from: '2026-11-01', to: '2026-11-15' })
    const queryThenEvent = { url: 'https://example.com/event', snippet:
      'Query window: 2026-11-01 through 2026-11-15.\nEvent runs 2026-11-01 through 2026-11-15.' }
    expect(supportedTemporalEvidence({ sourceUrl: queryThenEvent.url, from: '2026-11-01', to: '2026-11-15',
      quote: '2026-11-01 through 2026-11-15' }, [queryThenEvent])).toMatchObject({ from: '2026-11-01', to: '2026-11-15' })
    const querySnippetValidBody = { url: 'https://example.com/event', snippet: 'Query window: 2026-11-01 through 2026-11-15.',
      page: { text: 'Event runs 2026-11-01 through 2026-11-15.', contentHash: createHash('sha256')
        .update('Event runs 2026-11-01 through 2026-11-15.').digest('hex') } }
    expect(supportedTemporalEvidence({ sourceUrl: querySnippetValidBody.url, from: '2026-11-01', to: '2026-11-15',
      quote: '2026-11-01 through 2026-11-15' }, [querySnippetValidBody])).toMatchObject({ from: '2026-11-01', to: '2026-11-15' })
  })

  it('rejects ambiguous, mixed, or incomplete CJK date ranges', () => {
    const quote = '2026年11月1日～11月15日; 2026年11月20日～11月30日'
    const source = { url: 'https://example.com/event', snippet: quote }
    expect(supportedTemporalEvidence({ sourceUrl: source.url, from: '2026-11-01', to: '2026-11-15', quote }, [source])).toBeUndefined()
    expect(supportedTemporalEvidence({ sourceUrl: source.url, from: '2026-11-01', to: '2026-11-15',
      quote: '2026年11月1日～2026年11月15日 and 2026-11-20' }, [{ ...source, snippet: '2026年11月1日～2026年11月15日 and 2026-11-20' }])).toBeUndefined()
    expect(supportedTemporalEvidence({ sourceUrl: source.url, from: '2026-11-01', to: '2026-11-15',
      quote: '11月1日～15日' }, [{ ...source, snippet: '11月1日～15日' }])).toBeUndefined()
    const nestedWeekday = '2026年11月1日(2026年12月1日～12月15日)～11月15日'
    expect(supportedTemporalEvidence({ sourceUrl: source.url, from: '2026-11-01', to: '2026-11-15', quote: nestedWeekday },
      [{ ...source, snippet: nestedWeekday }])).toBeUndefined()
  })
})
