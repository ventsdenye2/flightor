import { describe, expect, it } from 'vitest'
import { tripDatesConsistent, tripDurationDays, tripTravelWindow } from './dates.js'
import { InMemoryTripContextRepository, InMemoryTripRepository } from './repository.js'
import { emptyTripContext } from './types.js'

const exact = (date: string) => ({ from: date, to: date, precision: 'exact' as const })
const dates = { departureWindow: exact('2026-10-12'), returnWindow: exact('2026-10-13'), travelDays: 2 }

describe('inclusive Trip calendar constraints', () => {
  it('derives day coverage from fixed dates without persisting a missing duration', () => {
    const fixed = { departureWindow: exact('2026-10-12'), returnWindow: exact('2026-10-14') }
    expect(tripDurationDays(fixed)).toBe(3)
    expect(fixed).not.toHaveProperty('travelDays')
    expect(tripDurationDays({ departureWindow: { from: '2026-10-12', to: '2026-10-14', precision: 'approximate' } })).toBeUndefined()
  })
  it.each([
    ['2026-10-12', '2026-10-13', 2, true],
    ['2026-10-12', '2026-10-14', 2, false],
    ['2026-10-12', '2026-10-12', 1, true],
    ['2026-10-12', '2026-10-11', 2, false],
    ['2028-02-28', '2028-03-01', 3, true],
    ['2026-12-31', '2027-01-01', 2, true]
  ])('checks %s through %s with %i days', (from, to, travelDays, valid) => {
    expect(tripDatesConsistent({ departureWindow: exact(from), returnWindow: exact(to), travelDays })).toBe(valid)
  })

  it('accepts flexible dates only when some pair meets the duration', () => {
    const flexible = { ...dates, departureWindow: { from: '2026-10-11', to: '2026-10-13', precision: 'approximate' as const } }
    expect(tripDatesConsistent(flexible)).toBe(true)
    expect(tripDatesConsistent({ ...flexible, returnWindow: exact('2026-10-15') })).toBe(false)
  })

  it('rejects the saved failure: a whole trip span copied into an exact departure window', () => {
    const historical = { departureWindow: { from: '2026-10-12', to: '2026-10-13', precision: 'exact' as const }, returnWindow: exact('2026-10-14'), travelDays: 2 }
    expect(tripDatesConsistent(historical)).toBe(false)
    expect(() => tripTravelWindow(historical)).toThrow(expect.objectContaining({ code: 'TRIP_DATES_INCONSISTENT' }))
    expect(tripDatesConsistent({ departureWindow: { from: '2026-10-12', precision: 'exact' }, returnWindow: { to: '2026-10-14', precision: 'exact' }, travelDays: 2 })).toBe(false)
  })

  it('keeps missing bounds unknown and rejects impossible one-sided windows', () => {
    expect(tripDatesConsistent({ travelDays: 2 })).toBe(true)
    expect(tripDatesConsistent({ returnWindow: exact('2026-10-13'), travelDays: 2 })).toBe(true)
    expect(tripDatesConsistent({ departureWindow: { from: '2026-10-14', precision: 'approximate' }, returnWindow: dates.returnWindow })).toBe(false)
    expect(tripDatesConsistent({ departureWindow: { to: '2026-10-10', precision: 'approximate' }, returnWindow: dates.returnWindow, travelDays: 2 })).toBe(false)
    expect(tripTravelWindow({})).toBeUndefined()
  })

  it('derives inclusive research coverage and rejects conflicting historical inputs', () => {
    expect(tripTravelWindow({ departureWindow: exact('2028-02-28'), travelDays: 3 })).toEqual({ from: '2028-02-28', to: '2028-03-01' })
    expect(tripTravelWindow(dates)).toEqual({ from: '2026-10-12', to: '2026-10-13' })
    expect(() => tripTravelWindow({ ...dates, returnWindow: exact('2026-10-14') })).toThrow(expect.objectContaining({ code: 'TRIP_DATES_INCONSISTENT' }))
  })

  it('covers feasible dates without converting a flexible lower bound into an end date', () => {
    expect(tripTravelWindow({
      departureWindow: { from: '2026-10-12', precision: 'approximate' },
      returnWindow: { from: '2026-10-14', precision: 'approximate' }, travelDays: 2
    })).toEqual({ from: '2026-10-13' })
    expect(tripTravelWindow({
      departureWindow: { from: '2026-10-12', to: '2026-10-15', precision: 'approximate' },
      returnWindow: { from: '2026-10-14', to: '2026-10-15', precision: 'approximate' }, travelDays: 2
    })).toEqual({ from: '2026-10-13', to: '2026-10-15' })
    expect(tripTravelWindow({ returnWindow: exact('2026-10-13'), travelDays: 2 })).toEqual({ from: '2026-10-12', to: '2026-10-13' })
  })

  it('rejects merged sparse edits without consuming a version, and accepts an explicit correction', async () => {
    const repo = new InMemoryTripContextRepository([{ ...emptyTripContext('trip'), ...dates }])
    await expect(repo.update('trip', { returnWindow: exact('2026-10-14') }, 0)).rejects.toMatchObject({ code: 'TRIP_DATES_INCONSISTENT' })
    expect(await repo.get('trip')).toMatchObject({ ...dates, version: 0 })
    expect(await repo.update('trip', { returnWindow: exact('2026-10-14'), travelDays: 3 }, 0)).toMatchObject({ travelDays: 3, version: 1 })
    expect(await repo.update('trip', { returnWindow: null, travelDays: 2 }, 1)).not.toHaveProperty('returnWindow')
  })

  it('rejects invalid initial context and permits repairing a readable historical snapshot', async () => {
    const invalid = { ...dates, returnWindow: exact('2026-10-14') }
    await expect(new InMemoryTripRepository().create({ initialContext: invalid })).rejects.toMatchObject({ code: 'TRIP_DATES_INCONSISTENT' })
    const repo = new InMemoryTripContextRepository([{ ...emptyTripContext('legacy'), ...invalid }])
    expect(await repo.get('legacy')).toMatchObject(invalid)
    expect(await repo.update('legacy', { returnWindow: exact('2026-10-13') })).toMatchObject({ ...dates, version: 1 })
  })
})
