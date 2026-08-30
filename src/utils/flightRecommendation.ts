import type { FlightOption, TransitCountryPreferences, TransitCountryPreference } from '../types/flight'
import { countryOfAirport, findCountry, type Country } from '../mocks/countries'

export interface CountryPreferenceMatch {
  country: Country
  preference: TransitCountryPreference
}

const EMPTY_PREFERENCES: TransitCountryPreferences = {
  preferred: [],
  excluded: []
}

/** 从所有中间航点推导中转国家，兼容单 Hub 与未来多次中转方案。 */
export function transitCountriesOf(flight: FlightOption): Country[] {
  if (flight.segments.length < 2) return []
  const codes = new Set<string>()
  for (let index = 0; index < flight.segments.length - 1; index++) {
    const country = countryOfAirport(flight.segments[index].destination)
    if (country) codes.add(country.code)
  }
  if (flight.hub) {
    const country = countryOfAirport(flight.hub.iata)
    if (country) codes.add(country.code)
  }
  return Array.from(codes)
    .map(code => findCountry(code))
    .filter((country): country is Country => Boolean(country))
}

export function countryPreferenceMatch(
  flight: FlightOption,
  preferences: TransitCountryPreferences = EMPTY_PREFERENCES
): CountryPreferenceMatch | null {
  const countries = transitCountriesOf(flight)
  const excluded = countries.find(country => preferences.excluded.includes(country.code))
  if (excluded) return { country: excluded, preference: 'excluded' }
  const preferred = countries.find(country => preferences.preferred.includes(country.code))
  if (preferred) return { country: preferred, preference: 'preferred' }
  return null
}

export function isExcludedByCountry(flight: FlightOption, preferences: TransitCountryPreferences): boolean {
  return transitCountriesOf(flight).some(country => preferences.excluded.includes(country.code))
}

/**
 * 综合推荐：价格 62% + 时长 28% + 衔接风险 10%，再叠加国家软偏好。
 * 分数越低越优；偏好可改变相近方案的次序，但不会掩盖极端价差/时长差。
 */
export function sortByRecommendation(
  flights: FlightOption[],
  preferences: TransitCountryPreferences = EMPTY_PREFERENCES
): FlightOption[] {
  if (flights.length < 2) return [...flights]
  const prices = flights.map(flight => flight.totalPrice)
  const durations = flights.map(flight => flight.totalDuration)
  const minPrice = Math.min(...prices)
  const maxPrice = Math.max(...prices)
  const minDuration = Math.min(...durations)
  const maxDuration = Math.max(...durations)
  const normalize = (value: number, min: number, max: number) => (value - min) / (max - min || 1)

  const score = (flight: FlightOption) => {
    const match = countryPreferenceMatch(flight, preferences)
    const countryAdjustment = match?.preference === 'preferred' ? -0.22 : 0
    const connectionRisk = flight.transferType === 'self' ? 0.1 : flight.transferType === 'airline' ? 0.04 : 0
    return (
      normalize(flight.totalPrice, minPrice, maxPrice) * 0.62 +
      normalize(flight.totalDuration, minDuration, maxDuration) * 0.28 +
      connectionRisk +
      countryAdjustment
    )
  }

  return [...flights].sort((a, b) => score(a) - score(b) || a.totalPrice - b.totalPrice)
}
