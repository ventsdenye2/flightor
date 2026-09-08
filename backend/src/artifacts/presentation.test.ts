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
