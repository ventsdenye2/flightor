import { describe, expect, it } from 'vitest'
import { AeroDataBoxProvider } from './aerodatabox.js'

describe('AeroDataBoxProvider', () => {
  it('fails closed when unconfigured and when capability is unmapped', async () => {
    await expect(new AeroDataBoxProvider({}).getAirport({ iata: 'PEK' })).rejects.toMatchObject({ code: 'PROVIDER_NOT_CONFIGURED' })
    await expect(new AeroDataBoxProvider({ AERODATABOX_API_KEY: 'x' }).getAirport({ iata: 'PEK' })).rejects.toMatchObject({ code: 'PROVIDER_CAPABILITY_UNAVAILABLE' })
  })
})
