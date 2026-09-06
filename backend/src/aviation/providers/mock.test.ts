import { describe, expect, it } from 'vitest'
import { MockAviationProvider } from './mock.js'

describe('MockAviationProvider', () => {
  it('returns injected deterministic values and failures', async () => {
    const provider = new MockAviationProvider({
      getAirportRoutes: [],
      failures: { getAirport: new Error('boom') }
    })
    await expect(provider.getAirportRoutes({ origin: 'PEK' })).resolves.toEqual([])
    await expect(provider.getAirport({ iata: 'PEK' })).rejects.toThrow('boom')
  })
})
