import { describe, expect, it } from 'vitest'
import type { LocationRef } from '../aviation/types.js'
import {
  type LocationIdentityPolicy,
  airportExactIdentity,
  cityGroupingCode,
  cityGroupingIdentity,
  locationsOverlap,
  representativeAirportCode
} from './identity.js'
import { CURATED_LOCATION_IDENTITY_POLICY } from './curated-directory.js'

const airport = (iata: string, cityCode?: string): LocationRef => ({
  id: `airport:${iata.toLowerCase()}`,
  type: 'airport',
  name: iata,
  countryCode: 'JP',
  iata,
  ...(cityCode ? { cityCode } : {})
})

const city = (cityCode: string): LocationRef => ({
  id: `city:${cityCode.toLowerCase()}`,
  type: 'city',
  name: cityCode,
  countryCode: 'JP',
  cityCode
})

describe('shared location identity', () => {
  it('keeps airport exact identity distinct while grouping Tokyo airports', () => {
    const nrt = airport('NRT', 'TYO')
    const hnd = airport('HND', 'TYO')

    expect(airportExactIdentity(nrt)).toBe('airport:NRT')
    expect(airportExactIdentity(hnd)).toBe('airport:HND')
    expect(locationsOverlap(nrt, hnd, CURATED_LOCATION_IDENTITY_POLICY)).toBe(false)
    expect(locationsOverlap(nrt, city('TYO'), CURATED_LOCATION_IDENTITY_POLICY)).toBe(true)
    expect(locationsOverlap(hnd, city('TYO'), CURATED_LOCATION_IDENTITY_POLICY)).toBe(true)
  })

  it('groups OSA and KIX without merging unrelated cities', () => {
    expect(cityGroupingCode('OSA', CURATED_LOCATION_IDENTITY_POLICY)).toBe('OSA')
    expect(cityGroupingCode('KIX', CURATED_LOCATION_IDENTITY_POLICY)).toBe('OSA')
    expect(cityGroupingIdentity(city('OSA'), CURATED_LOCATION_IDENTITY_POLICY)).toBe('city:OSA')
    expect(locationsOverlap(airport('KIX'), city('OSA'), CURATED_LOCATION_IDENTITY_POLICY)).toBe(true)
    expect(locationsOverlap(city('OSA'), city('TYO'), CURATED_LOCATION_IDENTITY_POLICY)).toBe(false)
  })

  it('supports catalog representations without changing exact airport identity', () => {
    const catalogTokyo = airport('NRT', 'NRT')
    expect(locationsOverlap(catalogTokyo, city('TYO'), CURATED_LOCATION_IDENTITY_POLICY)).toBe(true)
    expect(representativeAirportCode('TYO', CURATED_LOCATION_IDENTITY_POLICY)).toBe('NRT')
    expect(representativeAirportCode('HND', CURATED_LOCATION_IDENTITY_POLICY)).toBe('NRT')
    expect(representativeAirportCode('OSA', CURATED_LOCATION_IDENTITY_POLICY)).toBe('KIX')
    expect(representativeAirportCode('CDG', CURATED_LOCATION_IDENTITY_POLICY)).toBe('CDG')
  })

  it('uses an injected directory rather than a built-in city list', () => {
    const customPolicy: LocationIdentityPolicy = {
      directory: {
        groups: {
          AAA: { cityCode: 'ZZZ', representativeAirport: 'AAA' },
          AAB: { cityCode: 'ZZZ', representativeAirport: 'AAA' },
          ZZZ: { cityCode: 'ZZZ', representativeAirport: 'AAA' }
        }
      }
    }
    expect(cityGroupingCode('AAB', customPolicy)).toBe('ZZZ')
    expect(representativeAirportCode('AAB', customPolicy)).toBe('AAA')
    expect(locationsOverlap(airport('AAB'), city('ZZZ'), customPolicy)).toBe(true)
    expect(cityGroupingCode('NRT', customPolicy)).toBe('NRT')
  })

  it('honours an airport cityCode even when the directory has no entry', () => {
    const parisAirport = airport('CDG', 'PAR')
    expect(cityGroupingCode(parisAirport, CURATED_LOCATION_IDENTITY_POLICY)).toBe('PAR')
    expect(locationsOverlap(parisAirport, city('PAR'), CURATED_LOCATION_IDENTITY_POLICY)).toBe(true)
  })
})
