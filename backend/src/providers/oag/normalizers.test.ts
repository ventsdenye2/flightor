import { describe, expect, it } from 'vitest'
import {
  normalizeConnection,
  normalizeLocation,
  normalizeSchedule,
  operatingDaysMask,
  responseRecords
} from './normalizers.js'

describe('OAG normalizers', () => {
  it('normalizes an official Locations v1 record', () => {
    expect(normalizeLocation({
      code: { iata: 'SIN', icao: 'WSSS' },
      type: 'Airport',
      name: 'Singapore Changi Airport',
      place: {
        city: { code: 'SIN', name: 'Singapore' },
        country: { code: 'SG', name: 'Singapore' },
        latitude: { decimalDegrees: 1.3644 },
        longitude: { decimalDegrees: 103.9915 }
      },
      timeZone: { code: { iata: 'SIN' } }
    })).toMatchObject({
      iata: 'SIN',
      icao: 'WSSS',
      cityCode: 'SIN',
      countryCode: 'SG',
      latitude: 1.3644
    })
  })

  it('normalizes schedules and converts weekdays to the PostgreSQL mask', () => {
    const schedule = normalizeSchedule({
      oagFingerprint: 'fingerprint-1',
      carrierCode: { iata: 'SQ' },
      flightNumber: 322,
      departure: { airport: { iata: 'SIN' }, passengerLocalTime: '23:45' },
      arrival: { airport: { iata: 'LHR' }, passengerLocalTime: '06:15' },
      arrivalIntervalDays: 1,
      effectivePeriod: { startDate: '2026-09-01', endDate: '2026-10-01' },
      legDaysOfOperation: ['monday', 'wednesday', 'sunday']
    })
    expect(schedule).toMatchObject({
      providerKey: 'fingerprint-1',
      origin: 'SIN',
      destination: 'LHR',
      flightNumber: '322',
      arrivalDayOffset: 1,
      operatingDaysMask: (1 << 1) | (1 << 3) | (1 << 0)
    })
    expect(operatingDaysMask(undefined)).toBe(127)
  })

  it('normalizes a valid single connection and rejects a loop', () => {
    const base = {
      connectionId: 'connection-1',
      daysOfOperation: ['tuesday'],
      effectivePeriod: { local: { startDate: '2026-09-01', endDate: '2026-09-30' } },
      leg1: {
        departure: { airport: { iata: 'SZX' }, passengerLocalTime: '08:00' },
        arrival: { airport: { iata: 'SIN' }, passengerLocalTime: '12:00' },
        carrierCode: { iata: 'SQ' },
        flightNumber: 857,
        connectionTime: 180,
        mctStatus: 'II'
      },
      leg2: {
        departure: { airport: { iata: 'SIN' }, passengerLocalTime: '15:00' },
        arrival: { airport: { iata: 'LHR' }, passengerLocalTime: '21:00' },
        carrierCode: { iata: 'SQ' },
        flightNumber: 322
      }
    }
    expect(normalizeConnection(base, '2026-09-15')).toMatchObject({
      providerKey: 'connection-1',
      origin: 'SZX',
      hub: 'SIN',
      destination: 'LHR',
      connectionMinutes: 180,
      mctStatus: 'II'
    })
    expect(normalizeConnection({
      ...base,
      leg2: { ...base.leg2, arrival: { airport: { iata: 'SZX' } } }
    }, '2026-09-15')).toBeNull()
  })

  it('accepts paged and singular provider responses', () => {
    expect(responseRecords({ data: [{ id: 1 }] })).toHaveLength(1)
    expect(responseRecords({ code: { iata: 'SIN' } })).toHaveLength(1)
  })
})
