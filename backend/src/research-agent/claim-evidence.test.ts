import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { admitClaimEvidence, hasClaimConflict, sourcePageSchema, supportedClaimEvidence } from './claim-evidence.js'

const text = 'The adult ticket costs 900 yen. The museum is open daily.'
const retrievedAt = '2026-09-21T00:00:00.000Z'
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const page = { text, retrievedAt, contentHash: hash(text) }
const source = { url: 'https://example.com/museum', page }
const claim = {
  kind: 'price' as const,
  subject: 'adult ticket',
  value: '900 yen',
  quote: 'The adult ticket costs 900 yen.',
  sourceUrl: source.url,
  retrievedAt,
  contentHash: page.contentHash,
  status: 'source_observed' as const
}

describe('claim evidence provenance', () => {
  it('requires a SHA-256 source page hash', () => {
    expect(sourcePageSchema.safeParse(page).success).toBe(true)
    expect(sourcePageSchema.safeParse({ ...page, contentHash: hash('different') }).success).toBe(false)
  })

  it('rejects invented quotes, values outside quotes, and mismatched timestamps or hashes', () => {
    expect(supportedClaimEvidence({ ...claim, quote: 'The adult ticket costs 999 yen.' }, [source])).toBeUndefined()
    expect(supportedClaimEvidence({ ...claim, value: '1,200 yen', quote: 'The adult ticket costs 900 yen.' }, [source])).toBeUndefined()
    expect(supportedClaimEvidence({ ...claim, retrievedAt: '2026-09-22T00:00:00.000Z' }, [source])).toBeUndefined()
    expect(supportedClaimEvidence({ ...claim, contentHash: hash('other') }, [source])).toBeUndefined()
  })

  it('admits only selected indexed sources with retrieved page evidence', () => {
    const drafts = [{ kind: 'price' as const, subject: 'adult ticket', value: '900 yen', quote: 'The adult ticket costs 900 yen.', sourceIndex: 0 }]
    expect(admitClaimEvidence(drafts, [source], [])).toEqual([])
    expect(admitClaimEvidence(drafts, [source], [0])).toEqual([claim])
    expect(admitClaimEvidence([{ ...drafts[0], sourceIndex: 1 }], [source], [1])).toEqual([])
    expect(admitClaimEvidence([{ ...drafts[0], quote: '900 yen' }], [{ url: source.url }], [0])).toEqual([])
  })

  it('does not treat a search snippet as page evidence or infer future validity', () => {
    const snippetSource = { url: source.url, snippet: text }
    const draft = [{ kind: 'price' as const, subject: 'adult ticket', value: '900 yen', quote: 'The adult ticket costs 900 yen.', sourceIndex: 0 }]
    expect(admitClaimEvidence(draft, [snippetSource], [0])).toEqual([])
    const admitted = supportedClaimEvidence(claim, [source])
    expect(admitted).toEqual(claim)
    expect(admitted).not.toHaveProperty('validUntil')
    expect(admitted).not.toHaveProperty('futureValidity')
  })

  it('flags conflicting values for the same subject and kind, while separating products', () => {
    const otherProduct = { ...claim, subject: 'child ticket', value: '500 yen', quote: 'The museum is open daily.' }
    expect(hasClaimConflict([claim, { ...claim, value: '1,000 yen', quote: 'The adult ticket costs 1,000 yen.' }])).toBe(true)
    expect(hasClaimConflict([claim, otherProduct])).toBe(false)
  })
})
