import { locations, resolveLocation } from '../../trip-flight-tool/dist/core/locations.js'
import { airportAliases } from '../../trip-flight-tool/dist/core/location-aliases.js'
import catalog from '../../trip-flight-tool/dist/core/data/airports.json' with { type: 'json' }

const normalize = value => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/['’`]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
const chineseLabel = aliases => aliases.find(value => /[\u4e00-\u9fff]/.test(value))
const cities = locations.filter(location => location.kind === 'city')
const cityCodes = new Set(cities.map(location => location.code))
const airportLocations = new Map(locations.filter(location => location.kind === 'airport').map(location => [location.code, location]))
const entries = [
  ...cities.map(location => ({ code: location.code, kind: 'city', label: chineseLabel(location.aliases) || location.name,
    name: location.name, airports: location.airports, value: location.code, terms: [location.code, location.name, ...location.aliases] })),
  ...catalog.airports.map(airport => {
    const aliases = [...(airportAliases[airport.code] || []), ...(airportLocations.get(airport.code)?.aliases || [])]
    // SHA/CTU and some other codes represent a city in the CLI. Use the full airport name to preserve an airport-only selection.
    return { code: airport.code, kind: 'airport', label: chineseLabel(aliases) || airport.name, name: airport.name,
      city: airport.city, country: airport.country, airports: [airport.code], value: cityCodes.has(airport.code) ? airport.name : airport.code,
      terms: [airport.code, airport.icao, airport.name, airport.city, ...aliases] }
  })
].map(entry => ({ ...entry, terms: entry.terms.filter(Boolean).map(normalize) }))
const defaults = ['BJS', 'SHA', 'CAN', 'LIS', 'TYO', 'LON']

export function searchFlightLocations(input = '') {
  if (typeof input !== 'string' || input.length > 100) throw Error('地点关键词最多100字')
  const query = normalize(input)
  if (!query) return defaults.map(code => publicLocation(entries.find(entry => entry.kind === 'city' && entry.code === code)))
  let exact
  try { exact = resolveLocation(input) } catch { /* Ambiguous names remain separate choices. */ }
  const words = query.split(' ')
  return entries.map(entry => {
    let rank = entry.terms.some(term => term === query) ? 0
      : entry.terms.some(term => term.startsWith(query)) ? 2
        : entry.terms.some(term => words.every(word => term.includes(word))) ? 4 : 99
    if (exact && entry.kind === exact.kind && entry.code === exact.code) rank = -2
    return { entry, rank }
  }).filter(match => match.rank < 99)
    .sort((a, b) => a.rank - b.rank || (a.entry.kind === 'city' ? 0 : 1) - (b.entry.kind === 'city' ? 0 : 1) || a.entry.code.localeCompare(b.entry.code))
    .slice(0, 12).map(({ entry }) => publicLocation(entry))
}
function publicLocation({ terms, ...entry }) { return entry }
