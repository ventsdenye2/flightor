import { describe, expect, it } from 'vitest'
import { MockAviationProvider } from '../aviation/providers/mock.js'
import type { LocationRef } from '../aviation/types.js'
import { CatalogDestinationDiscoveryService } from './discovery.js'
import { destinationDiscoveryInputSchema } from './types.js'

const origin: LocationRef = { id: 'airport-pek', type: 'airport', name: 'Beijing', countryCode: 'CN', iata: 'PEK' }

const input = (extra: Partial<ReturnType<typeof destinationDiscoveryInputSchema.parse>> = {}) => destinationDiscoveryInputSchema.parse({
  regions: ['japan', 'visa_free'],
  interests: ['food'],
  requiredIatas: ['KIX'],
  preferredIatas: ['BKK'],
  excludedIatas: [],
  origin,
  limit: 8,
  ...extra
})

describe('CatalogDestinationDiscoveryService', () => {
  it('ranks required first, then preferred, then deterministic interests/cost and keeps catalog verification partial', async () => {
    const service = new CatalogDestinationDiscoveryService()
    const first = await service.discover(input())
    const second = await service.discover(input())

    expect(first).toEqual(second)
    expect(first.candidates[0]?.location.iata).toBe('KIX')
    expect(first.candidates.find(candidate => candidate.location.iata === 'BKK')?.reasons[0]).toContain('preferred')
    expect(first.candidates.every(candidate => candidate.verification.status === 'partially_verified')).toBe(true)
    expect(first.verification.status).toBe('partially_verified')
    expect(first.warnings).toContain('destination_catalog_is_curated_and_not_globally_complete')
  })

  it('annotates only matching direct catalog routes and makes one provider call', async () => {
    let calls = 0
    const provider = new MockAviationProvider({
      getAirportRoutes: [{ origin, destination: { id: 'airport-kix', type: 'airport', name: 'Osaka', countryCode: 'JP', iata: 'KIX' } }]
    })
    const wrapped = {
      ...provider,
      getAirportRoutes: async (value: { origin: string }, options?: { signal?: AbortSignal }) => {
        calls += 1
        return provider.getAirportRoutes(value, options)
      }
    }
    const result = await new CatalogDestinationDiscoveryService(wrapped).discover(input({ limit: 3 }))

    expect(calls).toBe(1)
    expect(result.candidates.find(candidate => candidate.location.iata === 'KIX')?.accessibility).toBe('direct')
    expect(result.candidates.filter(candidate => candidate.location.iata !== 'KIX').every(candidate => candidate.accessibility === 'unknown')).toBe(true)
  })

  it('keeps accessibility unknown when provider is absent, empty, or fails', async () => {
    const unavailable = await new CatalogDestinationDiscoveryService().discover(input({ limit: 2 }))
    expect(unavailable.candidates.every(candidate => candidate.accessibility === 'unknown')).toBe(true)
    expect(unavailable.warnings).toContain('destination_accessibility_unknown:provider_unavailable')

    const empty = await new CatalogDestinationDiscoveryService(new MockAviationProvider()).discover(input({ limit: 2 }))
    expect(empty.candidates.every(candidate => candidate.accessibility === 'unknown')).toBe(true)
    expect(empty.warnings).toContain('destination_accessibility_unknown:no_matching_route')

    const failed = await new CatalogDestinationDiscoveryService(new MockAviationProvider({ failure: new Error('provider down') })).discover(input({ limit: 2 }))
    expect(failed.candidates.every(candidate => candidate.accessibility === 'unknown')).toBe(true)
    expect(failed.warnings).toContain('destination_accessibility_unknown:provider_failure')
  })

  it('treats HND and NRT as one canonical city for exclusions', async () => {
    const result = await new CatalogDestinationDiscoveryService().discover(input({
      regions: ['japan'], requiredIatas: [], preferredIatas: [], excludedIatas: ['HND'], limit: 8
    }))
    expect(result.candidates.map(candidate => candidate.location.iata)).not.toContain('NRT')
    expect(result.candidates.map(candidate => candidate.location.iata)).not.toContain('HND')
    expect(result.candidates.map(candidate => candidate.location.iata)).toContain('KIX')
  })
})
