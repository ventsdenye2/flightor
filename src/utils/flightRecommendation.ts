import type { FlightOption, TransitCountryPreferences, TransitCountryPreference } from '../types/flight'
import { countryOfAirport, findCountry, type Country } from '../mocks/countries'
import { flightConnections } from '../services/flightConnections'

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

/** 只计算航段之间的等待时间，避免把飞行时间误当作中转体验。 */
export function totalLayoverMinutes(flight: FlightOption): number | undefined {
  const connections = flightConnections(flight.segments.map(segment => ({ origin: segment.origin, destination: segment.destination,
    departureAt: segment.departTime, arrivalAt: segment.arriveTime })), flight.layovers)
  if (connections.length !== Math.max(0, flight.segments.length - 1) || connections.some(connection => connection.durationMinutes === undefined)) return undefined
  return connections.reduce((total, connection) => total + connection.durationMinutes!, 0)
}

/**
 * 综合推荐：价格 55% + 总时长 15% + 中转等待 20% + 衔接风险 10%，再叠加国家软偏好。
 * 中转等待仅影响排序，不会过滤长中转；用户仍可选择在中转国家停留游玩。
 * 分数越低越优；偏好可改变相近方案的次序，但不会掩盖极端价差/时长差。
 */
export function sortByRecommendation(
  flights: FlightOption[],
  preferences: TransitCountryPreferences = EMPTY_PREFERENCES
): FlightOption[] {
  if (flights.length < 2) return [...flights]
  const prices = flights.map(flight => flight.totalPrice)
  const durations = flights.flatMap(flight => flight.totalDuration === undefined ? [] : [flight.totalDuration])
  const flightLayovers = flights.map(totalLayoverMinutes)
  const layovers = flightLayovers.filter((value): value is number => value !== undefined)
  const minPrice = Math.min(...prices)
  const maxPrice = Math.max(...prices)
  const minDuration = Math.min(...durations)
  const maxDuration = Math.max(...durations)
  const minLayover = Math.min(...layovers)
  const maxLayover = Math.max(...layovers)
  const normalize = (value: number | undefined, min: number, max: number) => value === undefined ? 1 : (value - min) / (max - min || 1)

  const scored = flights.map((flight, index) => {
    const match = countryPreferenceMatch(flight, preferences)
    const countryAdjustment = match?.preference === 'preferred' ? -0.22 : 0
    const connectionRisk = flight.transferType === 'self' ? 0.1 : flight.transferType === 'airline' ? 0.04 : 0
    const score = (
      normalize(flight.totalPrice, minPrice, maxPrice) * 0.55 +
      normalize(flight.totalDuration, minDuration, maxDuration) * 0.15 +
      normalize(flightLayovers[index], minLayover, maxLayover) * 0.2 +
      connectionRisk +
      countryAdjustment
    )
    return { flight, score }
  })

  return scored.sort((a, b) => Number(a.flight.totalDuration === undefined) - Number(b.flight.totalDuration === undefined)
    || a.score - b.score || a.flight.totalPrice - b.flight.totalPrice).map(item => item.flight)
}
