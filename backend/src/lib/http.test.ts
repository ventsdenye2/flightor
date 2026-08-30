import { describe, expect, it } from 'vitest'
import { withQuery } from './http.js'

describe('withQuery', () => {
  it('preserves a base URL that already includes a file path', () => {
    const url = withQuery('https://example.com/search.json', '', { engine: 'flights', empty: '' })
    expect(url).toBe('https://example.com/search.json?engine=flights')
  })

  it('joins provider paths and encodes query values', () => {
    const url = withQuery('https://api.example.com', '/locations', { CountryCode: 'CN', q: '深圳' })
    expect(url).toContain('/locations?')
    expect(url).toContain('CountryCode=CN')
    expect(url).toContain('q=%E6%B7%B1%E5%9C%B3')
  })
})
