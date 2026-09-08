import { describe, expect, it } from 'vitest'
import { airportTimeViewSchema, projectAirportTime } from './airport-time.js'

describe('AirportTimeView', () => {
  it('displays each endpoint in its own airport timezone without changing the flight instant', () => {
    expect(projectAirportTime('2026-10-10T06:55:00.000Z', { timezone: 'Asia/Shanghai', airportIata: 'PVG' })).toEqual({
      basis: 'airport_local', display: '2026-10-10 14:55 (Asia/Shanghai, UTC+08:00)',
      instant: '2026-10-10T06:55:00.000Z', localDateTime: '2026-10-10T14:55:00',
      timezone: 'Asia/Shanghai', offset: '+08:00', airportIata: 'PVG'
    })
    expect(projectAirportTime('2026-10-10T10:00:00.000Z', { timezone: 'Asia/Tokyo', airportIata: 'NRT' })).toMatchObject({
      basis: 'airport_local', display: '2026-10-10 19:00 (Asia/Tokyo, UTC+09:00)',
      instant: '2026-10-10T10:00:00.000Z', localDateTime: '2026-10-10T19:00:00', offset: '+09:00'
    })
  })

  it('keeps local calendar dates across both directions of a UTC date boundary', () => {
    expect(projectAirportTime('2026-10-10T23:30:00Z', { timezone: 'Asia/Tokyo' })).toMatchObject({
      instant: '2026-10-10T23:30:00.000Z', localDateTime: '2026-10-11T08:30:00',
      display: '2026-10-11 08:30 (Asia/Tokyo, UTC+09:00)'
    })
    expect(projectAirportTime('2026-10-10T00:15:00+08:00', { timezone: 'Asia/Shanghai' })).toMatchObject({
      instant: '2026-10-09T16:15:00.000Z', localDateTime: '2026-10-10T00:15:00', offset: '+08:00'
    })
  })

  it('uses the timezone offset at the flight instant across a DST transition', () => {
    expect(projectAirportTime('2026-03-08T06:30:00Z', { timezone: 'America/New_York' })).toMatchObject({
      localDateTime: '2026-03-08T01:30:00', offset: '-05:00'
    })
    expect(projectAirportTime('2026-03-08T07:30:00Z', { timezone: 'America/New_York' })).toMatchObject({
      localDateTime: '2026-03-08T03:30:00', offset: '-04:00'
    })
  })

  it.each([undefined, 'Mars/Unknown'])('explicitly labels UTC when the airport timezone is %s', timezone => {
    const view = projectAirportTime('2026-10-10T06:55:00Z', { timezone, airportIata: 'PVG' })
    expect(view).toEqual({
      basis: 'utc', display: '2026-10-10 06:55 (UTC; airport timezone unavailable)',
      instant: '2026-10-10T06:55:00.000Z', timezone: 'UTC', offset: '+00:00', airportIata: 'PVG'
    })
    expect(view.localDateTime).toBeUndefined()
    expect(airportTimeViewSchema.safeParse(view).success).toBe(true)
  })

  it('preserves provider-local fare clocks without inventing an offset or UTC instant', () => {
    expect(projectAirportTime('2026-10-10 19:00', { airportIata: 'NRT', providerLocal: true })).toEqual({
      basis: 'provider_local', display: '2026-10-10 19:00 (provider local; timezone unavailable)',
      localDateTime: '2026-10-10T19:00:00', airportIata: 'NRT'
    })
  })

  it.each(['2026-02-30T06:55:00Z', '2026-02-30 14:55', '2026-10-10T25:55:00Z', 'not a time'])('rejects invalid calendar or clock values: %s', value => {
    expect(projectAirportTime(value, { timezone: 'Asia/Shanghai', providerLocal: true })).toEqual({
      basis: 'unavailable', display: 'Time unavailable'
    })
  })
})
