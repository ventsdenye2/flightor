import { describe, expect, it, vi } from 'vitest'
import type { AppEnv } from '../../config/env.js'
import { AppError } from '../../lib/errors.js'
import { SerpApiClient } from './client.js'

const config = {
  SERPAPI_KEY: 'test-secret',
  SERPAPI_BASE_URL: 'https://serpapi.example/search.json'
} as AppEnv

describe('SerpApi travel-guide search', () => {
  it('builds a bounded Google query from catalog fields and normalizes safe results', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        organic_results: [
          { title: 'Tokyo guide', snippet: 'Museums and food ideas.', link: 'https://example.com/tokyo' },
          { title: 'Bad protocol', snippet: 'should be ignored', link: 'javascript:alert(1)' },
          { title: 'Data URL', snippet: 'should be ignored', link: 'data:text/plain,bad' },
          { title: 'Another guide', snippet: 'More ideas.', link: 'http://another.example/guide' }
        ]
      })
    }))
    vi.stubGlobal('fetch', fetchMock)
    try {
      const result = await new SerpApiClient(config).searchTravelGuide({
        cityIata: 'NRT',
        interests: ['food'],
        travelDays: 5
      })
      const requestUrl = new URL((fetchMock.mock.calls[0] as unknown[])[0] as string)
      expect(requestUrl.searchParams.get('engine')).toBe('google')
      expect(requestUrl.searchParams.get('q')).toContain('Tokyo')
      expect(requestUrl.searchParams.get('q')).toContain('5-day')
      expect(requestUrl.searchParams.get('q')).not.toContain('google_flights')
      expect(requestUrl.searchParams.get('api_key')).toBe('test-secret')
      expect(result).toEqual([
        { title: 'Tokyo guide', snippet: 'Museums and food ideas.', url: 'https://example.com/tokyo', domain: 'example.com' },
        { title: 'Another guide', snippet: 'More ideas.', url: 'http://another.example/guide', domain: 'another.example' }
      ])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('rejects a non-catalog city before making a network call', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    try {
      await expect(new SerpApiClient(config).searchTravelGuide({
        cityIata: 'XXX',
        interests: ['food'],
        travelDays: 5
      })).rejects.toMatchObject({ code: 'INVALID_TRAVEL_GUIDE_REQUEST' } satisfies Partial<AppError>)
      expect(fetchMock).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('SerpApi bounded organic search', () => {
  it('uses the Google contract, canonicalizes safe URLs, and keeps only parseable publication metadata', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        organic_results: [
          { title: 'one', snippet: 'first', link: 'HTTPS://Example.com/path/?b=2&a=1#fragment', date: 'Sep 6, 2026' },
          { title: 'duplicate', snippet: 'same', link: 'https://example.com/path?a=1&b=2' },
          { title: 'credential', snippet: 'bad', link: 'https://user:pass@example.com/secret' },
          { title: 'unsafe', snippet: 'bad', link: 'javascript:alert(1)' }
        ]
      })
    }))
    vi.stubGlobal('fetch', fetchMock)
    try {
      const result = await new SerpApiClient(config).searchOrganic({ query: 'Tokyo events', limit: 10 }, undefined)
      const requestUrl = new URL((fetchMock.mock.calls[0] as unknown[])[0] as string)
      expect(requestUrl.searchParams.get('engine')).toBe('google')
      expect(requestUrl.searchParams.get('q')).toBe('Tokyo events')
      expect(requestUrl.searchParams.get('num')).toBe('10')
      expect(requestUrl.searchParams.get('hl')).toBe('en')
      expect(requestUrl.searchParams.get('gl')).toBe('us')
      expect(result).toEqual([{ title: 'one', snippet: 'first', url: 'https://example.com/path?a=1&b=2', domain: 'example.com', publishedAt: '2026-09-06T00:00:00.000Z' }])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it.each([
    { error: 'Invalid key' },
    { search_metadata: { status: 'Error' } }
  ])('fails on SerpApi provider errors without returning fabricated results', async payload => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => payload }))
    vi.stubGlobal('fetch', fetchMock)
    try {
      await expect(new SerpApiClient(config).searchOrganic({ query: 'x' })).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('rejects oversized limits, credentials and missing keys before provider use', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    try {
      await expect(new SerpApiClient(config).searchOrganic({ query: 'x', limit: 21 })).rejects.toMatchObject({ code: 'INVALID_RESEARCH_SEARCH' })
      expect(fetchMock).not.toHaveBeenCalled()
      const emptyConfig = { ...config, SERPAPI_KEY: '' } as AppEnv
      await expect(new SerpApiClient(emptyConfig).searchOrganic({ query: 'x' })).rejects.toMatchObject({ code: 'PROVIDER_NOT_CONFIGURED' })
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
