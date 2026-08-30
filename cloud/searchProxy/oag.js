// OAG aviation data client. Server-side only: never bundle subscription keys into the mini program.
// Products used here:
// - Schedules /flights: date-aware direct route topology
// - Flight Info Connections /connections: valid single connections and MCT-derived connection time
// - Master Data /locations: airport-country-city-timezone hierarchy
// - Flight Info v2 /flight-instances/: optional live flight-instance lookup

const OAG_BASE = 'https://api.oag.com'
const OAG_PATHS = {
  schedules: '/flights',
  connections: '/connections',
  locations: '/locations',
  flightInfo: '/flight-instances/'
}

const DAY_NAMES = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6
}

function buildQuery(params) {
  return Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&')
}

async function defaultFetchJson(url, init) {
  const response = await fetch(url, init)
  const json = await response.json().catch(() => ({}))
  if (!response.ok) {
    const message = json?.message || json?.error || `HTTP ${response.status}`
    throw new Error(`oag: ${message}`)
  }
  return json
}

async function requestJson(apiKey, path, params, opts = {}) {
  if (!apiKey) throw new Error('missing OAG subscription key')
  const fetchJson = opts.fetchJson || defaultFetchJson
  const baseUrl = opts.baseUrl || OAG_BASE
  const query = buildQuery(params)
  return fetchJson(`${baseUrl}${path}${query ? `?${query}` : ''}`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'Subscription-Key': apiKey
    }
  })
}

function get(value, paths, fallback = undefined) {
  for (const path of paths) {
    let cursor = value
    for (const part of path.split('.')) cursor = cursor == null ? undefined : cursor[part]
    if (cursor !== undefined && cursor !== null && cursor !== '') return cursor
  }
  return fallback
}

function upperCode(value) {
  if (value && typeof value === 'object') value = value.iata || value.IATA || value.code
  return typeof value === 'string' ? value.toUpperCase() : ''
}

function dateOnly(value) {
  return value == null ? null : String(value).slice(0, 10)
}

function normalizeOperatingDays(value) {
  if (!value) return [0, 1, 2, 3, 4, 5, 6]
  if (Array.isArray(value)) {
    const days = value
      .map(day => typeof day === 'number' ? day : DAY_NAMES[String(day).toLowerCase()])
      .filter(day => Number.isInteger(day) && day >= 0 && day <= 6)
    return days.length ? [...new Set(days)] : [0, 1, 2, 3, 4, 5, 6]
  }
  // OAG schedule feeds may use a seven-character operating pattern such as "1234567".
  const pattern = String(value)
  if (/^[1-7](?:,?[1-7])*$/.test(pattern) && (pattern.includes(',') || pattern.length < 7)) {
    return [...new Set(pattern.match(/[1-7]/g).map(day => Number(day) % 7))]
  }
  const days = []
  for (let index = 0; index < 7; index++) {
    if (pattern[index] && pattern[index] !== '0' && pattern[index] !== '-') days.push((index + 1) % 7)
  }
  return days.length ? days : [0, 1, 2, 3, 4, 5, 6]
}

function extractAirport(record, side) {
  const title = side === 'departure' ? 'Departure' : 'Arrival'
  return upperCode(get(record, [
    `${side}.airport.iata`, `${side}.airport`, `${side}Airport.iata`, `${side}Airport`,
    `${title}.Airport.IATA`, `${title}.Airport`, `${title}Airport`
  ]))
}

function effectivePeriod(record, fallbackDate) {
  return {
    validFrom: dateOnly(get(record, [
      'effectivePeriod.startDate', 'EffectivePeriod.StartDate', 'startDate', 'StartDate',
      'departure.date', 'DepartureDate'
    ], fallbackDate)),
    validTo: dateOnly(get(record, [
      'effectivePeriod.endDate', 'EffectivePeriod.EndDate', 'endDate', 'EndDate',
      'departure.date', 'DepartureDate'
    ], fallbackDate))
  }
}

function scheduleToEdge(record, query = {}) {
  const origin = extractAirport(record, 'departure') || upperCode(query.origin)
  const destination = extractAirport(record, 'arrival') || upperCode(query.destination)
  if (!origin || !destination || origin === destination) return null
  const period = effectivePeriod(record, query.date)
  return {
    origin,
    destination,
    operatingDays: normalizeOperatingDays(get(record, [
      'legDaysOfOperation', 'LegDaysOfOperation', 'daysOfOperation', 'DaysOfOperation',
      'operatingDays', 'OperatingDays'
    ])),
    validFrom: period.validFrom,
    validTo: period.validTo,
    source: 'oag-schedules',
    observedAt: new Date().toISOString(),
    carrier: upperCode(get(record, ['carrier.code.iata', 'carrier.iata', 'carrier', 'Carrier', 'CarrierCode'])),
    flightNumber: String(get(record, ['flightNumber', 'FlightNumber'], ''))
  }
}

function extractConnectionLegs(record) {
  const list = get(record, ['legs', 'Legs', 'segments', 'Segments'])
  if (Array.isArray(list)) return list
  return [record.leg1 || record.Leg1, record.leg2 || record.Leg2].filter(Boolean)
}

function connectionToRecord(record, query = {}) {
  const legs = extractConnectionLegs(record)
  if (legs.length < 2) return null
  const edges = legs.map(leg => scheduleToEdge(leg, { date: query.date })).filter(Boolean)
  if (edges.length < 2) return null
  const period = effectivePeriod(record, query.date)
  const operatingDays = normalizeOperatingDays(get(record, ['daysOfOperation', 'DaysOfOperation']))
  edges.forEach(edge => {
    edge.operatingDays = operatingDays
    edge.validFrom = period.validFrom || edge.validFrom
    edge.validTo = period.validTo || edge.validTo
    edge.source = 'oag-connections'
  })
  return {
    id: String(get(record, ['connectionId', 'ConnectionId', 'id'], '')),
    origin: edges[0].origin,
    destination: edges[edges.length - 1].destination,
    via: edges.slice(0, -1).map(edge => edge.destination),
    connectionTime: Number(get(record, [
      'connectionTime', 'ConnectionTime', 'leg1.connectionTime', 'Leg1.ConnectionTime'
    ], 0)) || 0,
    elapsedTime: Number(get(record, ['elapsedTime', 'ElapsedTime'], 0)) || 0,
    mctStatus: String(get(record, ['mctStatus', 'MctStatus', 'leg1.mctStatus', 'Leg1.MctStatus'], '')),
    isSelfConnection: Boolean(get(record, ['isSelfConnection', 'IsSelfConnection'], false)),
    connectionType: String(get(record, ['connectionType', 'ConnectionType'], '')),
    operatingDays,
    validFrom: period.validFrom,
    validTo: period.validTo,
    edges
  }
}

function normalizeLocation(record) {
  const iata = upperCode(get(record, ['code.iata', 'Code.Iata', 'iata']))
  if (!iata) return null
  return {
    iata,
    icao: upperCode(get(record, ['code.icao', 'Code.Icao', 'icao'])),
    type: String(get(record, ['type', 'Type'], 'AIRPORT')),
    name: String(get(record, ['name', 'Name'], '')),
    cityCode: upperCode(get(record, ['place.city.code', 'city.code.iata', 'city.code', 'cityCode', 'CityCode'])),
    cityName: String(get(record, ['place.city.name', 'city.name', 'cityName', 'CityName'], '')),
    countryCode: String(get(record, ['place.country.code', 'country.code.iso', 'country.code', 'countryCode', 'CountryCode'], '')).toUpperCase(),
    countryName: String(get(record, ['place.country.name', 'country.name', 'countryName', 'CountryName'], '')),
    latitude: Number(get(record, ['place.latitude.decimalDegrees', 'geo.latitude', 'geography.latitude', 'latitude', 'Latitude'], 0)) || 0,
    longitude: Number(get(record, ['place.longitude.decimalDegrees', 'geo.longitude', 'geography.longitude', 'longitude', 'Longitude'], 0)) || 0,
    timezone: String(get(record, ['timezone.code.iata', 'timezone.standardUtcVariation', 'timeZone.name', 'timezone.name', 'timeZone', 'timezone'], '')),
    terminals: Array.isArray(record.terminals) ? record.terminals : []
  }
}

async function schedules(apiKey, params, opts = {}) {
  const date = params.dateTo && params.dateTo !== params.dateFrom
    ? `${params.dateFrom}/${params.dateTo}`
    : params.dateFrom
  const json = await requestJson(apiKey, opts.path || OAG_PATHS.schedules, {
    DepartureAirport: upperCode(params.origin),
    ArrivalAirport: upperCode(params.destination),
    DepartureDate: date,
    ServiceType: 'Passenger',
    Limit: Math.min(1000, Math.max(1, Number(params.limit) || 100))
  }, opts)
  const data = Array.isArray(json?.data) ? json.data : []
  return {
    edges: data.map(record => scheduleToEdge(record, { origin: params.origin, destination: params.destination, date: params.dateFrom })).filter(Boolean),
    paging: json?.paging || null
  }
}

async function connections(apiKey, params, opts = {}) {
  const json = await requestJson(apiKey, opts.path || OAG_PATHS.connections, {
    DepartureAirport: upperCode(params.origin),
    ArrivalAirport: upperCode(params.destination),
    DepartureDate: params.dateFrom,
    ToDate: params.dateTo || params.dateFrom,
    Service: 'Passenger',
    Limit: Math.min(1000, Math.max(1, Number(params.limit) || 100))
  }, opts)
  const data = Array.isArray(json?.data) ? json.data : []
  return {
    connections: data.map(record => connectionToRecord(record, { date: params.dateFrom })).filter(Boolean),
    paging: json?.paging || null
  }
}

async function locations(apiKey, params = {}, opts = {}) {
  const json = await requestJson(apiKey, opts.path || OAG_PATHS.locations, {
    AirportCode: params.airportCode,
    CountryCode: params.countryCode,
    CityCode: params.cityCode,
    CodeType: 'IATA',
    Limit: Math.min(1000, Math.max(1, Number(params.limit) || 100))
  }, opts)
  return {
    locations: (Array.isArray(json?.data) ? json.data : []).map(normalizeLocation).filter(Boolean),
    paging: json?.paging || null
  }
}

async function flightInfo(apiKey, params, opts = {}) {
  const json = await requestJson(apiKey, opts.path || OAG_PATHS.flightInfo, {
    DepartureAirport: upperCode(params.origin),
    ArrivalAirport: upperCode(params.destination),
    DepartureDateTime: params.date,
    CarrierCode: params.carrierCode,
    FlightNumber: params.flightNumber,
    FlightType: 'scheduled',
    CodeType: 'IATA',
    version: 'v2',
    Limit: Math.min(100, Math.max(1, Number(params.limit) || 100))
  }, opts)
  return { flights: Array.isArray(json?.data) ? json.data : [], paging: json?.paging || null }
}

module.exports = {
  OAG_BASE,
  OAG_PATHS,
  requestJson,
  normalizeOperatingDays,
  scheduleToEdge,
  connectionToRecord,
  normalizeLocation,
  schedules,
  connections,
  locations,
  flightInfo
}
