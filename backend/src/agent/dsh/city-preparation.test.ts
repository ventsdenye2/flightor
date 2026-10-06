import { describe, expect, it } from 'vitest'
import { uniqueSelectedTripCity } from './city-preparation.js'

const tokyo = { id: 'city:TYO', type: 'city' as const, name: 'Tokyo', countryCode: 'JP', cityCode: 'TYO' }
const trip = (required: any[], preferred: any[] = []) => ({ destinationIntent: { required, preferred } })

describe('deterministic DSH city preparation', () => {
  it('returns one canonical selected city and deduplicates the same identity', () => {
    expect(uniqueSelectedTripCity(trip([tokyo], [structuredClone(tokyo)]))).toEqual(tokyo)
  })

  it('does not choose between multiple cities or convert an airport to a city', () => {
    const osaka = { ...tokyo, id: 'city:OSA', name: 'Osaka', cityCode: 'OSA' }
    const narita = { id: 'airport:NRT', type: 'airport' as const, name: 'Narita', countryCode: 'JP', iata: 'NRT' }
    expect(uniqueSelectedTripCity(trip([tokyo, osaka]))).toBeUndefined()
    expect(uniqueSelectedTripCity(trip([narita]))).toBeUndefined()
    expect(uniqueSelectedTripCity(trip([]))).toBeUndefined()
  })
})
