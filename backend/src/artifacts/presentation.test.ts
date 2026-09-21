import { describe, expect, it } from 'vitest'
import { artifactPresentationSchema, artifactReadingContent, MAX_AIRPORT_TIME_VIEWS, presentArtifact } from './presentation.js'
import type { ArtifactRecord } from './repository.js'
import { flexibleFlightSearchArtifactSchema } from '../fares/search-service.js'

function artifact(type: ArtifactRecord['type'], payload: unknown, schemaVersion = 1): ArtifactRecord {
  return {
    id: '01a07ecf-96a7-7628-966b-4998195fe516', tripId: 'trip', type, schemaVersion, payload,
    createdAt: '2026-09-08T02:18:48.000Z', updatedAt: '2026-09-08T02:18:48.000Z'
  }
}

const from = { id: '3', iata: 'PVG', timezone: 'Asia/Shanghai' }
const to = { id: '24', iata: 'NRT', timezone: 'Asia/Tokyo' }
const edge = {
  from, to, departureAt: '2026-10-10T06:55:00.000Z', arrivalAt: '2026-10-10T10:00:00.000Z',
  segments: [{ from, to, flightNumber: '9C 6217', departureAt: '2026-10-10T06:55:00.000Z', arrivalAt: '2026-10-10T10:00:00.000Z' }]
}

describe('Artifact time presentation', () => {
  it('projects nested optimized routes without changing the immutable payload or its UTC instants', () => {
    const stored = artifact('route_set', { kind: 'optimized_routes', representatives: [{ path: { edges: [structuredClone(edge)] } }] })
    const before = JSON.stringify(stored)
    const output = presentArtifact(stored)
    expect(JSON.stringify(stored)).toBe(before)
    expect(output.payload).toBe(stored.payload)
    expect(output.presentation?.airportTimes['/representatives/0/path/edges/0/departureAt']).toMatchObject({
      localDateTime: '2026-10-10T14:55:00', timezone: 'Asia/Shanghai', offset: '+08:00'
    })
    expect(output.presentation?.airportTimes['/representatives/0/path/edges/0/segments/0/arrivalAt']).toMatchObject({
      localDateTime: '2026-10-10T19:00:00', timezone: 'Asia/Tokyo', offset: '+09:00'
    })
    expect(Object.keys(output.presentation!.airportTimes)).toHaveLength(4)
    expect(artifactPresentationSchema.safeParse(output.presentation).success).toBe(true)
  })

  it('uses the same explicit view at each time field in the Agent-readable copy', () => {
    const stored = artifact('route_set', { kind: 'flight_paths', paths: [{ edges: [structuredClone(edge)] }] })
    const parsed = JSON.parse(artifactReadingContent(stored))
    const views = presentArtifact(stored).presentation!.airportTimes
    expect(parsed.payload.paths[0].edges[0].departureAt).toEqual(views['/paths/0/edges/0/departureAt'])
    expect(parsed.payload.paths[0].edges[0].departureAt.display).toContain('14:55')
    expect(parsed.payload.paths[0].edges[0].departureAt.instant).toBe('2026-10-10T06:55:00.000Z')
    expect(parsed.payload.paths[0].edges[0].segments[0].arrivalAt.display).toContain('19:00')
    expect((stored.payload as { paths: Array<{ edges: typeof edge[] }> }).paths[0]!.edges[0]!.departureAt).toBe('2026-10-10T06:55:00.000Z')
  })

  it('labels provider-local fare fields for a single-date search', () => {
    const offer = { segments: [{ origin: 'PVG', destination: 'NRT', departsAt: '2026-10-10 14:55', arrivesAt: '2026-10-10 19:00' }] }
    const single = presentArtifact(artifact('flight_search', { offers: [offer] }))
    expect(single.presentation?.airportTimes['/offers/0/segments/0/departsAt']).toMatchObject({
      basis: 'provider_local', localDateTime: '2026-10-10T14:55:00', airportIata: 'PVG'
    })
    expect(single.presentation?.airportTimes['/offers/0/segments/0/departsAt']?.instant).toBeUndefined()
  })

  it('projects the version 2 flexible-search domain payload for both UI and Agent reads', () => {
    const payload = flexibleFlightSearchArtifactSchema.parse({
      id: '01a07ecf-96a7-7628-966b-4998195fe516', type: 'flight_search',
      window: { origin: 'PVG', destination: 'NRT', departureDateFrom: '2026-10-10', departureDateTo: '2026-10-11', currency: 'CNY', travelClass: 1 },
      results: [{
        query: { origin: 'PVG', destination: 'NRT', departureDate: '2026-10-10', currency: 'CNY', travelClass: 1 },
        offers: [{
          id: 'fare-9c-6217', totalAmount: 902, currency: 'CNY', totalDurationMinutes: 185, airlines: ['Spring Airlines'], transferType: 'direct',
          segments: [{ origin: 'PVG', destination: 'NRT', departsAt: '2026-10-10 14:55', arrivesAt: '2026-10-10 19:00',
            flightNumber: '9C 6217', airline: 'Spring Airlines', durationMinutes: 185 }]
        }],
        provider: 'serpapi', checkedAt: '2026-09-08T02:18:48.000Z',
        verification: { status: 'verified', checkedAt: '2026-09-08T02:18:48.000Z', confidence: 0.9, sources: [{ provider: 'serpapi' }] }
      }],
      scannedDates: ['2026-10-10', '2026-10-11'], successfulDates: ['2026-10-10'], failedDates: ['2026-10-11']
    })
    const stored = artifact('flight_search', payload, 2)
    const presented = presentArtifact(stored)
    const arrival = presented.presentation?.airportTimes['/results/0/offers/0/segments/0/arrivesAt']
    expect(arrival).toMatchObject({
      basis: 'provider_local', localDateTime: '2026-10-10T19:00:00', airportIata: 'NRT',
      display: '2026-10-10 19:00 (provider local; timezone unavailable)'
    })
    expect(JSON.parse(artifactReadingContent(stored)).payload.results[0].offers[0].segments[0].arrivesAt).toEqual(arrival)
    expect(presented.payload).toBe(payload)
    expect(payload.results[0]?.offers[0]?.segments[0]?.arrivesAt).toBe('2026-10-10 19:00')
  })

  it('keeps unknown route and flight-search schema versions unprojected', () => {
    expect(presentArtifact(artifact('route_set', { edges: [edge] }, 2)).presentation).toBeUndefined()
    expect(presentArtifact(artifact('flight_search', { results: [] }, 3)).presentation).toBeUndefined()
  })

  it('labels UTC explicitly when a route snapshot has no airport timezone', () => {
    const stored = artifact('route_set', { kind: 'connection_edges', edges: [{
      from: { id: 'PVG', iata: 'PVG' }, to: { id: 'NRT', iata: 'NRT' }, departureAt: edge.departureAt
    }] })
    expect(presentArtifact(stored).presentation?.airportTimes['/edges/0/departureAt']).toMatchObject({
      basis: 'utc', timezone: 'UTC', display: '2026-10-10 06:55 (UTC; airport timezone unavailable)'
    })
  })

  it('does not reinterpret timestamps in unrelated artifact domains', () => {
    const stored = artifact('research', { from, to, departureAt: edge.departureAt })
    expect(presentArtifact(stored)).toBe(stored)
    expect(JSON.parse(artifactReadingContent(stored)).payload).toEqual(stored.payload)
  })

  it('public research reads expose only attributed references; internal Agent reads retain audit material', () => {
    const stored = artifact('research', { findings: [{ id: 'f', title: 'FREE_UNBOUND', summary: 'BUDGET_UNBOUND',
      sources: [{ title: 'Visitor information', url: 'https://example.com/visit', snippet: 'AUDIT_ONLY', page: { text: 'BODY_AUDIT' } }] }] }, 2)
    const output = JSON.stringify(presentArtifact(stored))
    expect(output).toContain('Visitor information')
    for (const hidden of ['FREE_UNBOUND', 'BUDGET_UNBOUND', 'AUDIT_ONLY', 'BODY_AUDIT']) expect(output).not.toContain(hidden)
    expect(artifactReadingContent(stored)).toContain('BUDGET_UNBOUND')
  })

  it('bounds projections for oversized stored payloads', () => {
    const stored = artifact('route_set', { edges: Array.from({ length: MAX_AIRPORT_TIME_VIEWS + 1 }, () => ({
      from: { id: 'PVG' }, to: { id: 'NRT' }, departureAt: edge.departureAt
    })) })
    const presentation = presentArtifact(stored).presentation!
    expect(Object.keys(presentation.airportTimes)).toHaveLength(MAX_AIRPORT_TIME_VIEWS)
    expect(presentation.truncated).toBe(true)
    expect(artifactPresentationSchema.safeParse(presentation).success).toBe(true)
  })
})

describe('Artifact fare fact compatibility', () => {
  it('marks the legacy SerpApi baggage default as unconfirmed without changing its snapshot', () => {
    const payload = { provider: 'serpapi', offers: [{ baggageRecheck: false }] }
    const stored = artifact('flight_search', payload)
    const before = JSON.stringify(stored)
    const output = presentArtifact(stored)
    expect(output.payload).toBe(payload)
    expect(JSON.stringify(stored)).toBe(before)
    expect(output.presentation?.unconfirmedFields).toEqual(['/offers/0/baggageRecheck'])
    expect(artifactPresentationSchema.safeParse(output.presentation).success).toBe(true)
    const reading = JSON.parse(artifactReadingContent(stored))
    expect(reading.payload.offers[0].baggageRecheck).toEqual({ status: 'unverified', reason: 'legacy_unattributed' })
    expect(payload.offers[0]!.baggageRecheck).toBe(false)
  })

  it('applies the same compatibility rule to each flexible-search result using its own provider', () => {
    const payload = { results: [
      { provider: 'serpapi', offers: [{ baggageRecheck: false }, { baggageRecheck: true }, {}] },
      { provider: 'another-provider', offers: [{ baggageRecheck: false }] },
      { provider: 'serpapi', offers: [{ baggageRecheck: false }] }
    ] }
    const stored = artifact('flight_search', payload, 2)
    const output = presentArtifact(stored)
    expect(output.payload).toBe(payload)
    expect(output.presentation?.unconfirmedFields).toEqual([
      '/results/0/offers/0/baggageRecheck', '/results/2/offers/0/baggageRecheck'
    ])
    const reading = JSON.parse(artifactReadingContent(stored))
    expect(reading.payload.results[0].offers[0].baggageRecheck).toEqual({ status: 'unverified', reason: 'legacy_unattributed' })
    expect(reading.payload.results[2].offers[0].baggageRecheck).toEqual(reading.payload.results[0].offers[0].baggageRecheck)
    expect(reading.payload.results[0].offers[1].baggageRecheck).toBe(true)
    expect(reading.payload.results[0].offers[2]).not.toHaveProperty('baggageRecheck')
    expect(reading.payload.results[1].offers[0].baggageRecheck).toBe(false)
  })

  it('preserves current unknown baggage facts and does not reinterpret other providers or schema versions', () => {
    for (const payload of [
      { provider: 'serpapi', offers: [{}] },
      { provider: 'serpapi', offers: [{ baggageRecheck: true }] },
      { provider: 'another-provider', offers: [{ baggageRecheck: false }] }
    ]) {
      const stored = artifact('flight_search', payload)
      expect(presentArtifact(stored).presentation?.unconfirmedFields).toBeUndefined()
      expect(JSON.parse(artifactReadingContent(stored)).payload).toEqual(payload)
    }
    const payload = { provider: 'serpapi', offers: [{ baggageRecheck: false }] }
    for (const stored of [artifact('flight_search', payload, 3), artifact('research', payload)]) {
      expect(presentArtifact(stored).presentation).toBeUndefined()
      expect(JSON.parse(artifactReadingContent(stored)).payload).toEqual(payload)
    }
  })
})
