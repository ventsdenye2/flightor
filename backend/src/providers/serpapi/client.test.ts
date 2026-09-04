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
      const requestUrl = new URL(fetchMock.mock.calls[0]![0] as string)
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
