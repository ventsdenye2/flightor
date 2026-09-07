import { describe, expect, it } from 'vitest'
import { classifyResearchSourceAuthority, registrableResearchHostname, verifyResearchFinding } from './verification.js'
import type { ResearchSourceCandidate } from './search-provider.js'

const source = (url: string, authority: ResearchSourceCandidate['authority'] = 'unknown'): ResearchSourceCandidate => ({
  title: 'Result',
  snippet: 'A bounded snippet',
  url,
  domain: new URL(url).hostname,
  authority
})

describe('deterministic research verification', () => {
  it('keeps event/date snippet evidence at most partially verified', () => {
    const record = verifyResearchFinding('event', [source('https://city.gov.jp/events/1', 'government_tourism')], { checkedAt: '2026-09-07T00:00:00.000Z' })
    expect(record.status).toBe('partially_verified')
    expect(record.status).not.toBe('verified')
    expect(record.sources[0]?.reference).toBe('https://city.gov.jp/events/1')
  })

  it('keeps snippet-only non-events partial with authoritative or independent support', () => {
    expect(verifyResearchFinding('activity', [source('https://city.gov.jp/guide', 'government_tourism')], { checkedAt: '2026-09-07T00:00:00.000Z' }).status).toBe('partially_verified')
    expect(verifyResearchFinding('activity', [source('https://a.example.com/a'), source('https://b.example.org/b')], { checkedAt: '2026-09-07T00:00:00.000Z' }).status).toBe('partially_verified')
    expect(verifyResearchFinding('activity', [source('https://a.example.com/a'), source('https://www.example.com/b')], { checkedAt: '2026-09-07T00:00:00.000Z' }).status).toBe('unverified')
  })

  it('uses conservative host authority and stable registrable roots', () => {
    expect(classifyResearchSourceAuthority('https://www.city.gov.jp/events')).toBe('government_tourism')
    expect(classifyResearchSourceAuthority('https://official.example.com/events')).toBe('unknown')
    expect(classifyResearchSourceAuthority('https://www.gotokyo.org/en/')).toBe('government_tourism')
    expect(classifyResearchSourceAuthority('https://gotokyo.org.example.com/en/')).toBe('unknown')
    expect(registrableResearchHostname('https://a.example.co.uk/a')).toBe('example.co.uk')
    expect(registrableResearchHostname('https://b.example.co.uk/b')).toBe('example.co.uk')
  })
})
