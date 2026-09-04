import { describe, expect, it } from 'vitest'
import {
  DESTINATION_PROFILES,
  recommendDestinations,
  resolveDestinationMentions
} from './catalog.js'

describe('destination catalog', () => {
  it('contains Japan airports and existing Europe/visa-free candidates', () => {
    expect(DESTINATION_PROFILES.some(profile => profile.iata === 'NRT' && profile.region === 'japan')).toBe(true)
    expect(DESTINATION_PROFILES.some(profile => profile.iata === 'HND' && profile.canonicalIata === 'NRT')).toBe(true)
    expect(DESTINATION_PROFILES.some(profile => profile.iata === 'KIX' && profile.region === 'japan')).toBe(true)
    expect(DESTINATION_PROFILES.some(profile => profile.iata === 'CDG' && profile.region === 'schengen')).toBe(true)
    expect(DESTINATION_PROFILES.some(profile => profile.iata === 'BKK' && profile.region === 'visa_free')).toBe(true)
  })

  it('resolves explicit city names and IATA only, without guessing a country', () => {
    expect(resolveDestinationMentions('东京、巴黎、NRT').map(profile => profile.iata)).toEqual(['NRT', 'CDG'])
    expect(resolveDestinationMentions('HND').map(profile => profile.iata)).toEqual(['HND'])
    expect(resolveDestinationMentions('我想去日本和法国')).toEqual([])
  })

  it('ranks culture matches ahead of non-matching destinations deterministically', () => {
    const first = recommendDestinations({ regions: ['schengen'], interests: ['culture'], limit: 6 })
    const second = recommendDestinations({ regions: ['schengen'], interests: ['culture'], limit: 6 })
    expect(first).toEqual(second)
    expect(first.map(item => item.iata)).toEqual(['FRA', 'MUC', 'VIE', 'PRG', 'MAD', 'LIS'])
    expect(first.every(item => item.reason.zh.includes('文化'))).toBe(true)
  })

  it('covers every requested region when a small limit would otherwise favor one region', () => {
    const two = recommendDestinations({ regions: ['japan', 'schengen'], interests: ['culture'], limit: 3 })
    expect(new Set(two.map(item => item.region))).toEqual(new Set(['japan', 'schengen']))
    expect(new Set(two.map(item => item.iata)).size).toBe(two.length)

    const three = recommendDestinations({ regions: ['japan', 'schengen', 'visa_free'], interests: ['culture'], limit: 3 })
    expect(new Set(three.map(item => item.region))).toEqual(new Set(['japan', 'schengen', 'visa_free']))
  })

  it('honours required/excluded IATAs and de-duplicates Tokyo aliases', () => {
    const result = recommendDestinations({
      regions: ['japan'],
      requiredIatas: ['KIX'],
      excludedIatas: ['NRT'],
      limit: 8
    })
    expect(result.map(item => item.iata)).toEqual(['KIX'])
    expect(new Set(result.map(item => item.iata)).size).toBe(result.length)
  })
})
