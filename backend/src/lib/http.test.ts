import { describe, expect, it, vi } from 'vitest'
import { fetchJson, withQuery } from './http.js'

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

describe('fetchJson cancellation', () => {
  it('classifies caller aborts as cancelled and removes the caller listener after rejection', async () => {
    const caller = new AbortController()
    let requestSignal: AbortSignal | undefined
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      requestSignal = init?.signal
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    const pending = fetchJson('https://example.com', {}, { provider: 'example', timeoutMs: 1_000, signal: caller.signal })
    caller.abort('caller stopped')
    await expect(pending).rejects.toMatchObject({ code: 'PROVIDER_CANCELLED', statusCode: 502 })
    expect(requestSignal?.aborted).toBe(true)
    // A second abort must not trigger another request-side abort callback.
    caller.abort('caller stopped again')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
