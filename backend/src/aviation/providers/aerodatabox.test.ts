import { describe, expect, it } from 'vitest'
import { AppError } from '../../lib/errors.js'
import { AeroDataBoxProvider } from './aerodatabox.js'

function response(body: unknown, status = 200): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function provider(fetch: (input: string | URL, init?: RequestInit) => Promise<Response>, extra: Record<string, unknown> = {}) {
  return new AeroDataBoxProvider({ AERODATABOX_API_KEY: 'secret-key', AERODATABOX_BASE_URL: 'https://example.test', fetch, ...extra })
}

const listing = (iata: string, name = `${iata} airport`) => ({ iata, icao: `Z${iata}`, name, countryCode: 'CN', location: { lat: 40, lon: 116 }, timeZone: 'Asia/Shanghai' })

describe('AeroDataBoxProvider', () => {
  it('splits daily FIDS into twelve-hour windows and restores its implicit origin without duplicating noon flights', async () => {
    const urls: string[] = []
    const p = provider(async input => {
      urls.push(decodeURIComponent(String(input)))
      return response({ departures: [{ number: 'BA304', departure: { scheduledTime: { local: '2026-09-08 12:00+01:00' } }, arrival: { airport: listing('CDG'), scheduledTime: { local: '2026-09-08 14:15+02:00' } } }] })
    })
    const flights = await p.getSchedules({ origin: 'LHR', destination: 'CDG', dateFrom: '2026-09-08' })
    expect(urls).toHaveLength(2)
    expect(urls[0]).toContain('T00:00/2026-09-08T12:00')
    expect(urls[1]).toContain('T12:00/2026-09-08T23:59')
    expect(flights).toHaveLength(1)
    expect(flights[0]).toMatchObject({ originIata: 'LHR', destinationIata: 'CDG', departureLocal: '2026-09-08T12:00+01:00' })
    await expect(p.getSchedules({ origin: 'LHR', destination: 'CDG', dateFrom: '2026-09-08', dateTo: '2026-09-30' })).rejects.toMatchObject({ code: 'INVALID_SCHEDULE_RANGE' })
    expect(urls).toHaveLength(2)
  })
  it('fails closed when unconfigured and keeps city-only resolution local', async () => {
    await expect(new AeroDataBoxProvider({}).getAirport({ iata: 'PEK' })).rejects.toMatchObject({ code: 'PROVIDER_NOT_CONFIGURED' })
    let called = false
    const result = await new AeroDataBoxProvider({ AERODATABOX_API_KEY: 'secret', fetch: async () => { called = true; return response([]) } }).resolveLocation({ query: 'Beijing', types: ['city'] })
    expect(called).toBe(false)
    expect(result.matches).toEqual([])
    expect(result.verification.status).toBe('partially_verified')
  })

  it('uses RapidAPI authentication and normalizes airport search', async () => {
    let seenUrl = ''
    let seenHeaders: HeadersInit | undefined
    const p = provider(async (input, init) => { seenUrl = String(input); seenHeaders = init?.headers; return response({ items: [listing('PEK')] }) }, { AERODATABOX_BASE_URL: 'https://aerodatabox.p.rapidapi.com' })
    const result = await p.resolveLocation({ query: 'PEK', limit: 1 })
    expect(seenUrl).toContain('/airports/search/term?q=PEK')
    expect(seenHeaders).toMatchObject({ 'X-RapidAPI-Key': 'secret-key', 'X-RapidAPI-Host': 'aerodatabox.p.rapidapi.com' })
    expect(result.matches[0]).toMatchObject({ id: 'PEK', type: 'airport', countryCode: 'CN', latitude: 40, longitude: 116, timezone: 'Asia/Shanghai' })
  })

  it('uses direct gateway authentication and treats 204 as empty', async () => {
    let headers: HeadersInit | undefined
    const p = provider(async (_input, init) => { headers = init?.headers; return response(undefined, 204) }, { AERODATABOX_BASE_URL: 'https://api.aerodatabox.com' })
    await expect(p.getAirport({ iata: 'PEK' })).resolves.toBeUndefined()
    expect(headers).toMatchObject({ 'X-Api-Key': 'secret-key' })
  })

  it('normalizes daily route statistics without inventing weekly schedules', async () => {
    const calls: string[] = []
    const p = provider(async input => {
      calls.push(String(input))
      return calls.length === 1 ? response(listing('PEK', 'Beijing Capital')) : response({ routes: [{ destination: listing('HKG', 'Hong Kong'), averageDailyFlights: 3 }] })
    })
    await expect(p.getAirportRoutes({ origin: 'PEK' })).resolves.toEqual([{ origin: expect.objectContaining({ iata: 'PEK' }), destination: expect.objectContaining({ iata: 'HKG' }) }])
  })

  it('normalizes FIDS schedules and flight status while tolerating malformed records', async () => {
    const p = provider(async input => String(input).includes('/flights/airports/')
      ? response({ departures: [{ number: 'CA123', airline: { iata: 'CA' }, departure: { airport: listing('PEK'), scheduledTime: { local: '2026-09-07T08:00' } }, arrival: { airport: listing('HKG'), scheduledTime: { local: '2026-09-07T12:00' } } }, null] })
      : response([{ number: 'CA123', status: 'Landed', lastUpdatedUtc: '2026-09-07T04:00:00Z', departure: { airport: listing('PEK'), scheduledTime: { local: '2026-09-07T08:00' } }, arrival: { airport: listing('HKG'), scheduledTime: { local: '2026-09-07T12:00' } } }, { nope: true }]))
    await expect(p.getSchedules({ origin: 'PEK', destination: 'HKG', dateFrom: '2026-09-07' })).resolves.toMatchObject([{ flightNumber: 'CA123', marketingCarrier: 'CA', departureLocal: '2026-09-07T08:00' }])
    await expect(p.getFlightStatus({ flightNumber: 'CA123', date: '2026-09-07' })).resolves.toMatchObject({ status: 'landed', originIata: 'PEK', destinationIata: 'HKG', updatedAt: '2026-09-07T04:00:00Z' })
  })

  it('drops a schedule record whose destination is absent instead of using the query as fact', async () => {
    const p = provider(async () => response({ departures: [{
      number: 'CA404', departure: { airport: listing('PEK'), scheduledTime: { local: '2026-09-07T08:00' } },
      arrival: { scheduledTime: { local: '2026-09-07T12:00' } }
    }] }))
    await expect(p.getSchedules({ origin: 'PEK', destination: 'HKG', dateFrom: '2026-09-07' })).resolves.toEqual([])
  })

  it('rejects malformed JSON and combines carrier with a numeric flight number', async () => {
    let seenUrl = ''
    const malformed = provider(async () => new Response('{', { status: 200 }))
    await expect(malformed.getAirport({ iata: 'PEK' })).rejects.toMatchObject({ code: 'PROVIDER_MALFORMED_RESPONSE' })
    const p = provider(async input => {
      seenUrl = String(input)
      return response([])
    })
    await p.getFlightStatus({ carrierCode: 'ca', flightNumber: '123', date: '2026-09-07' })
    expect(seenUrl).toContain('/flights/number/CA123/2026-09-07')
  })

  it('maps provider errors without leaking credentials and maps timeout', async () => {
    for (const status of [400, 401, 429, 451, 500]) {
      const p = provider(async () => response({ message: 'secret-key must not escape' }, status))
      await expect(p.getAirport({ iata: 'PEK' })).rejects.toSatisfy((error: unknown) => error instanceof AppError && !error.message.includes('secret-key'))
    }
    const p = provider(async (_input, init) => await new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
    }), { timeoutMs: 1 })
    await expect(p.getAirport({ iata: 'PEK' })).rejects.toMatchObject({ code: 'PROVIDER_TIMEOUT', statusCode: 504 })
  })
})
