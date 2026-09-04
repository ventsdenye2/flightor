import { describe, expect, it } from 'vitest'
import type { RoutePick } from './engine.js'
import { confirmRoutePicks } from './confirm.js'
import { routePlanConfirmRequestSchema } from './schema.js'

function pick(): RoutePick {
  return {
    kind: 'cheapest',
    route: {
      cities: ['CDG', 'FCO'],
      citySeq: ['SZX', 'CDG', 'FCO', 'SZX'],
      legs: [
        { from: 'SZX', to: 'CDG', date: '2026-09-01', departTime: '22:00', arriveTime: '06:00', crossDay: true, duration: 720, price: 3000, airline: 'estimate' },
        { from: 'CDG', to: 'FCO', date: '2026-09-03', departTime: '10:00', arriveTime: '12:00', crossDay: false, duration: 120, price: 500, airline: 'estimate' },
        { from: 'FCO', to: 'SZX', date: '2026-09-05', departTime: '21:00', arriveTime: '15:00', crossDay: true, duration: 900, price: 3200, airline: 'estimate' }
      ],
      totalPrice: 6700,
      effCost: 5900,
      nightsSaved: 2,
      hasReal: false
    }
  }
}

function response(origin: string, destination: string, date: string, price: number) {
  return {
    best_flights: [{
      price: price + 100,
      total_duration: 110,
      flights: [{ flight_number: 'XX2', airline: 'Air Test', duration: 110, departure_airport: { id: origin, time: `${date} 09:00` }, arrival_airport: { id: destination, time: `${date} 11:00` } }]
    }],
    other_flights: [{
      price,
      total_duration: 100,
      flights: [{ flight_number: 'XX1', airline: 'Air Test', duration: 100, departure_airport: { id: origin, time: `${date} 22:00` }, arrival_airport: { id: destination, time: `${date} 06:00` } }]
    }]
  }
}

describe('route plan confirmation', () => {
  it('maps the cheapest real itinerary, limits concurrency to two and keeps failed estimates', async () => {
    let active = 0
    let peak = 0
    let calls = 0
    const client = {
      searchFlights: async ({ origin, destination, departDate }: { origin: string; destination: string; departDate: string }) => {
        active += 1
        peak = Math.max(peak, active)
        const callNumber = ++calls
        await new Promise(resolve => setTimeout(resolve, 1))
        active -= 1
        if (callNumber === 2) throw new Error('provider unavailable')
        return response(origin, destination, departDate, 1000 + callNumber)
      }
    }
    const [confirmed] = await confirmRoutePicks([pick()], client, { hasKey: true })
    expect(calls).toBe(3)
    expect(peak).toBeLessThanOrEqual(2)
    expect(confirmed?.probed).toBe(2)
    expect(confirmed?.failed).toBe(1)
    expect(confirmed?.route.legs[0]?.real).toBe(true)
    expect(confirmed?.route.legs[1]?.real).toBe(false)
    expect(confirmed?.route.totalPrice).toBe(confirmed?.route.legs.reduce((sum, leg) => sum + leg.price, 0))
    expect(confirmed?.route.effCost).not.toBe(pick().route.effCost)
    expect(confirmed?.note).toContain('估算价')
  })

  it('returns estimate-only confirmation without a SerpApi key', async () => {
    let calls = 0
    const confirmed = await confirmRoutePicks([pick()], { searchFlights: async () => { calls += 1; return {} } }, { hasKey: false })
    expect(calls).toBe(0)
    expect(confirmed[0]?.probed).toBe(0)
    expect(confirmed[0]?.failed).toBe(3)
    expect(confirmed[0]?.route.legs.every(leg => leg.real === false)).toBe(true)
    expect(confirmed[0]?.note).toContain('未配置 SerpApi')
  })

  it('rejects a request whose aggregate segment count exceeds eight', () => {
    expect(() => routePlanConfirmRequestSchema.parse({ picks: [pick(), pick(), pick()] })).toThrow(/8 legs/)
  })

  it('does not treat a provider itinerary from another departure date as real', async () => {
    const confirmed = await confirmRoutePicks([pick()], {
      searchFlights: async ({ origin, destination }) => response(origin, destination, '2026-12-31', 1_000)
    }, { hasKey: true })
    expect(confirmed[0]?.probed).toBe(0)
    expect(confirmed[0]?.failed).toBe(3)
    expect(confirmed[0]?.route.legs.every(leg => leg.real === false)).toBe(true)
  })

  it('shares a two-slot provider semaphore across concurrent confirmations', async () => {
    let active = 0
    let maxActive = 0
    let completedCalls = 0
    const client = {
      searchFlights: async ({ origin, destination, departDate }: { origin: string; destination: string; departDate: string }) => {
        active += 1
        maxActive = Math.max(maxActive, active)
        await new Promise(resolve => setTimeout(resolve, 2))
        active -= 1
        completedCalls += 1
        return response(origin, destination, departDate, 1_000)
      }
    }
    const results = await Promise.all([
      confirmRoutePicks([pick()], client, { hasKey: true }),
      confirmRoutePicks([pick()], client, { hasKey: true })
    ])
    expect(results).toHaveLength(2)
    expect(results.every(result => result[0]?.probed === 3 && result[0]?.failed === 0)).toBe(true)
    expect(completedCalls).toBe(6)
    expect(maxActive).toBeLessThanOrEqual(2)
  })
})
