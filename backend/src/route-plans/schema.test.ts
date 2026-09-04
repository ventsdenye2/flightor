import { describe, expect, it } from 'vitest'
import { iataSchema, routePlanConfirmRequestSchema, routePlanRequestSchema } from './schema.js'

const pick = {
  kind: 'cheapest' as const,
  route: {
    cities: ['CDG', 'FCO'],
    citySeq: ['SZX', 'CDG', 'FCO', 'SZX'],
    legs: [
      { from: 'SZX', to: 'CDG', date: '2026-09-01', departTime: '22:00', arriveTime: '06:00', crossDay: true, duration: 720, price: 3000, airline: 'CA' },
      { from: 'CDG', to: 'FCO', date: '2026-09-03', departTime: '10:00', arriveTime: '12:00', crossDay: false, duration: 120, price: 500, airline: 'AF' },
      { from: 'FCO', to: 'SZX', date: '2026-09-05', departTime: '21:00', arriveTime: '15:00', crossDay: true, duration: 900, price: 3200, airline: 'CA' }
    ],
    totalPrice: 6700,
    effCost: 5900,
    nightsSaved: 2,
    hasReal: false
  }
}

describe('route plan schemas', () => {
  it('accepts the Japan directory airports while keeping the allowlist strict', () => {
    expect(iataSchema.parse('NRT')).toBe('NRT')
    expect(iataSchema.parse('HND')).toBe('HND')
    expect(iataSchema.parse('KIX')).toBe('KIX')
    expect(() => iataSchema.parse('AAA')).toThrow()
  })

  it('accepts bounded plan input and rejects unknown fields/invalid dates', () => {
    expect(routePlanRequestSchema.parse({ text: '深圳出发，9月1号到9月5号玩3天' })).toEqual({ text: '深圳出发，9月1号到9月5号玩3天' })
    expect(() => routePlanRequestSchema.parse({ text: 'ok', extra: true })).toThrow()
    expect(() => routePlanRequestSchema.parse({ text: 'ok', today: '2026-02-30' })).toThrow()
    expect(() => routePlanRequestSchema.parse({ text: '   ' })).toThrow()
  })

  it('enforces nested pick boundaries and strictness', () => {
    expect(routePlanConfirmRequestSchema.parse({ picks: [pick] }).picks).toHaveLength(1)
    expect(() => routePlanConfirmRequestSchema.parse({ picks: [], extra: true })).toThrow()
    expect(() => routePlanConfirmRequestSchema.parse({ picks: [{ ...pick, extra: true }] })).toThrow()
    expect(() => routePlanConfirmRequestSchema.parse({ picks: [{ ...pick, route: { ...pick.route, legs: [{ ...pick.route.legs[0]!, price: -1 }, ...pick.route.legs.slice(1)] } }] })).toThrow()
    expect(() => routePlanConfirmRequestSchema.parse({ picks: [{ ...pick, route: { ...pick.route, cities: ['XXX', 'FCO'], citySeq: ['SZX', 'XXX', 'FCO', 'SZX'], legs: [{ ...pick.route.legs[0]!, to: 'XXX' }, ...pick.route.legs.slice(1)] } }] })).toThrow()
    expect(() => routePlanConfirmRequestSchema.parse({ picks: [{ ...pick, route: { ...pick.route, citySeq: ['SZX', 'XXX', 'FCO', 'SZX'] } }] })).toThrow()
  })
})
