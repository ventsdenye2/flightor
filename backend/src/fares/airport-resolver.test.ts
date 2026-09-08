import { describe, expect, it, vi } from 'vitest'
import type { AviationProvider } from '../aviation/providers/provider.js'
import { resolveFareAirportPair } from './airport-resolver.js'

function airport(iata: string) {
  return { id: `airport-${iata.toLowerCase()}`, type: 'airport' as const, name: `Authoritative ${iata}`, countryCode: 'ZZ', iata }
}

function aviationWith(airports: Record<string, ReturnType<typeof airport>>): AviationProvider {
  return {
    name: 'authoritative-test',
    resolveLocation: vi.fn(),
    getAirport: vi.fn(async input => airports[input.iata]),
    getAirportRoutes: vi.fn(),
    getSchedules: vi.fn(),
    getFlightStatus: vi.fn()
  }
}

describe('fare airport resolver', () => {
  it('resolves small IATA selectors to authoritative airport facts', async () => {
    const aviation = aviationWith({ PEK: airport('PEK'), NRT: airport('NRT') })
    const result = await resolveFareAirportPair(aviation, { origin: 'pek', destination: 'NRT' })
    expect(result).toEqual({ origin: airport('PEK'), destination: airport('NRT') })
    expect(aviation.getAirport).toHaveBeenCalledTimes(2)
  })

  it('accepts a trusted handle but ignores model-authored descriptive fields', async () => {
    const authoritative = airport('NRT')
    const trusted = { ...authoritative, id: 'trusted-nrt', name: 'Earlier provider result' }
    const aviation = aviationWith({ PEK: airport('PEK'), NRT: authoritative })
    const result = await resolveFareAirportPair(aviation, { origin: 'PEK', destination: 'trusted-nrt' }, { trustedLocations: [trusted] })
    expect(result.destination).toEqual(authoritative)
  })

  it('fails unknown codes and untrusted handles at the aviation boundary', async () => {
    const aviation = aviationWith({ PEK: airport('PEK') })
    await expect(resolveFareAirportPair(aviation, { origin: 'PEK', destination: 'ZZZ' })).rejects.toMatchObject({ code: 'AIRPORT_NOT_FOUND' })
    await expect(resolveFareAirportPair(aviation, { origin: 'PEK', destination: 'model-object-id' })).rejects.toMatchObject({ code: 'AIRPORT_SELECTOR_INVALID' })
  })

  it('rejects same-airport searches before any aviation call', async () => {
    const aviation = aviationWith({ PEK: airport('PEK') })
    await expect(resolveFareAirportPair(aviation, { origin: 'PEK', destination: 'pek' })).rejects.toMatchObject({ code: 'ORIGIN_DESTINATION_SAME' })
    expect(aviation.getAirport).not.toHaveBeenCalled()
  })
})
