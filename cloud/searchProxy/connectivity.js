// 机场直飞可达性索引（纯逻辑，可在搜索云函数、前端 Mock 与 node 测试中复用）
// 注意：内置边仅用于 Demo/离线候选剪枝；生产环境应由班期供应商定期刷新。

const TOPOLOGY_VERSION = 'demo-2026.08.30-v1'
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6]

const CHINA = ['SZX', 'CAN', 'PVG', 'SHA', 'PEK', 'PKX', 'CTU', 'HKG', 'TPE']
const ASIA = ['NRT', 'HND', 'KIX', 'CTS', 'NGO', 'FUK', 'ICN', 'PUS', 'BKK', 'KUL', 'SIN', 'HAN', 'SGN', 'DAD', 'MNL', 'CGK', 'DPS', 'DEL', 'BOM', 'BLR', 'CMB']
const MIDDLE_EAST = ['DOH', 'DXB', 'AUH', 'IST', 'JED', 'RUH', 'CAI']
const EUROPE = ['HEL', 'LHR', 'LGW', 'CDG', 'FRA', 'MUC', 'AMS', 'ZRH', 'FCO', 'MXP', 'MAD', 'BCN', 'VIE', 'CPH', 'ARN', 'OSL', 'DUB', 'LIS', 'ATH', 'PRG', 'WAW', 'SVO']
const NORTH_AMERICA = ['JFK', 'LAX', 'SFO', 'SEA', 'ORD', 'DFW', 'MIA', 'BOS', 'YVR', 'YYZ', 'MEX']
const OCEANIA = ['SYD', 'MEL', 'BNE', 'PER', 'AKL']
const AFRICA = ['JNB', 'NBO', 'ADD']
const SOUTH_AMERICA = ['GRU', 'EZE', 'SCL', 'BOG']

function edge(origin, destination, extra = {}) {
  return {
    origin,
    destination,
    operatingDays: ALL_DAYS,
    validFrom: '2025-01-01',
    validTo: '2027-12-31',
    source: 'demo-seed',
    observedAt: null,
    ...extra
  }
}

function hubEdges(hub, airports, extra = {}) {
  const result = []
  for (const airport of new Set(airports)) {
    if (airport === hub) continue
    result.push(edge(hub, airport, extra), edge(airport, hub, extra))
  }
  return result
}

// Hub 航线覆盖仅用于离线演示，避免 Mock 凭空连接任意两个机场。
const SEED_EDGES = [
  ...hubEdges('SIN', [...CHINA, ...ASIA, ...MIDDLE_EAST, ...EUROPE, ...NORTH_AMERICA, ...OCEANIA]),
  ...hubEdges('KUL', [...CHINA, ...ASIA, ...MIDDLE_EAST, ...EUROPE, ...OCEANIA]),
  ...hubEdges('BKK', [...CHINA, ...ASIA, ...MIDDLE_EAST, ...EUROPE, ...OCEANIA]),
  ...hubEdges('DOH', [...CHINA, ...ASIA, ...MIDDLE_EAST, ...EUROPE, ...NORTH_AMERICA, ...OCEANIA, ...AFRICA, ...SOUTH_AMERICA]),
  ...hubEdges('DXB', [...CHINA, ...ASIA, ...MIDDLE_EAST, ...EUROPE, ...NORTH_AMERICA, ...OCEANIA, ...AFRICA, ...SOUTH_AMERICA]),
  ...hubEdges('IST', [...CHINA, ...ASIA, ...MIDDLE_EAST, ...EUROPE, ...NORTH_AMERICA, ...AFRICA]),
  ...hubEdges('HEL', [...CHINA, ...ASIA, ...EUROPE, ...NORTH_AMERICA]),
  // 少量常见直飞边用于 Demo 的直飞基准；真实结果仍以供应商查询为准。
  edge('SZX', 'LHR'), edge('LHR', 'SZX'),
  edge('CAN', 'LHR'), edge('LHR', 'CAN'),
  edge('PVG', 'LHR'), edge('LHR', 'PVG'),
  edge('PEK', 'LHR'), edge('LHR', 'PEK'),
  edge('PVG', 'CDG'), edge('CDG', 'PVG'),
  edge('PEK', 'CDG'), edge('CDG', 'PEK'),
  edge('PVG', 'FRA'), edge('FRA', 'PVG'),
  edge('PEK', 'FRA'), edge('FRA', 'PEK')
]

function edgeKey(origin, destination) {
  return `${String(origin || '').toUpperCase()}|${String(destination || '').toUpperCase()}`
}

function dateOnly(value) {
  return String(value || '').slice(0, 10)
}

function weekday(isoDate) {
  const parsed = new Date(`${isoDate}T00:00:00Z`)
  return Number.isNaN(parsed.getTime()) ? null : parsed.getUTCDay()
}

function minutesBetween(from, to) {
  const start = new Date(String(from || '').replace(' ', 'T')).getTime()
  const end = new Date(String(to || '').replace(' ', 'T')).getTime()
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null
  return Math.round((end - start) / 60000)
}

function createConnectivityIndex(initialEdges = []) {
  const edgesByPair = new Map()
  const knownAirports = new Set()

  function addEdge(routeEdge) {
    if (!routeEdge || !routeEdge.origin || !routeEdge.destination) return
    const normalized = {
      operatingDays: ALL_DAYS,
      validFrom: null,
      validTo: null,
      source: 'unknown',
      observedAt: null,
      ...routeEdge,
      origin: String(routeEdge.origin).toUpperCase(),
      destination: String(routeEdge.destination).toUpperCase()
    }
    if (normalized.origin === normalized.destination) return
    knownAirports.add(normalized.origin)
    knownAirports.add(normalized.destination)
    const key = edgeKey(normalized.origin, normalized.destination)
    const existing = edgesByPair.get(key)
    if (existing && normalized.source === 'provider-observed') {
      const operatingDays = [...new Set([...(existing.operatingDays || []), ...(normalized.operatingDays || [])])]
      edgesByPair.set(key, {
        ...existing,
        operatingDays,
        validFrom: existing.validFrom && normalized.validFrom ? (existing.validFrom < normalized.validFrom ? existing.validFrom : normalized.validFrom) : existing.validFrom || normalized.validFrom,
        validTo: existing.validTo && normalized.validTo ? (existing.validTo > normalized.validTo ? existing.validTo : normalized.validTo) : existing.validTo || normalized.validTo,
        observedAt: normalized.observedAt,
        source: existing.source === 'demo-seed' ? existing.source : 'provider-observed'
      })
      return
    }
    edgesByPair.set(key, normalized)
  }

  initialEdges.forEach(addEdge)

  function routeStatus(origin, destination, date) {
    const from = String(origin || '').toUpperCase()
    const to = String(destination || '').toUpperCase()
    if (!from || !to || from === to) return { status: 'unreachable', reason: 'invalid_pair' }
    const routeEdge = edgesByPair.get(edgeKey(from, to))
    if (!routeEdge) {
      return knownAirports.has(from) && knownAirports.has(to)
        ? { status: 'unreachable', reason: 'no_scheduled_route' }
        : { status: 'unknown', reason: 'outside_index_coverage' }
    }
    if (!date) return { status: 'reachable', edge: routeEdge }
    const isoDate = dateOnly(date)
    if (routeEdge.validFrom && isoDate < routeEdge.validFrom) return { status: 'unreachable', reason: 'outside_validity', edge: routeEdge }
    if (routeEdge.validTo && isoDate > routeEdge.validTo) return { status: 'unreachable', reason: 'outside_validity', edge: routeEdge }
    const day = weekday(isoDate)
    if (day == null) return { status: 'unknown', reason: 'invalid_date', edge: routeEdge }
    if (Array.isArray(routeEdge.operatingDays) && !routeEdge.operatingDays.includes(day)) {
      return { status: 'unreachable', reason: 'not_operating_on_date', edge: routeEdge }
    }
    return { status: 'reachable', edge: routeEdge }
  }

  function canFly(origin, destination, date) {
    return routeStatus(origin, destination, date).status === 'reachable'
  }

  function outgoing(origin, date) {
    const from = String(origin || '').toUpperCase()
    const result = []
    for (const routeEdge of edgesByPair.values()) {
      if (routeEdge.origin === from && canFly(routeEdge.origin, routeEdge.destination, date)) result.push(routeEdge)
    }
    return result
  }

  /** 简单路径搜索：visited 集合从根源上禁止闭环；maxTransfers 默认 2。 */
  function findPaths(origin, destination, date, opts = {}) {
    const maxTransfers = opts.maxTransfers == null ? 2 : Math.max(0, Math.min(2, Number(opts.maxTransfers)))
    const from = String(origin || '').toUpperCase()
    const to = String(destination || '').toUpperCase()
    const paths = []
    const maxFlights = maxTransfers + 1

    function dfs(current, path) {
      if (path.length - 1 > maxFlights) return
      if (current === to) {
        paths.push([...path])
        return
      }
      if (path.length - 1 === maxFlights) return
      for (const routeEdge of outgoing(current, date)) {
        if (path.includes(routeEdge.destination)) continue
        dfs(routeEdge.destination, [...path, routeEdge.destination])
      }
    }

    if (from && to && from !== to) dfs(from, [from])
    return paths
  }

  /** 供应商实际返回的航段即为一次日期级可达性证据。 */
  function observeSegments(segments, observedAt = new Date().toISOString()) {
    for (const segment of segments || []) {
      const serviceDate = dateOnly(segment.departTime)
      const day = weekday(serviceDate)
      addEdge({
        origin: segment.origin,
        destination: segment.destination,
        operatingDays: day == null ? ALL_DAYS : [day],
        validFrom: serviceDate || null,
        validTo: serviceDate || null,
        source: 'provider-observed',
        observedAt
      })
    }
  }

  /**
   * 校验航段连续性、闭环、次数、最低衔接时间与已知直飞边。
   * 较长中转/总行程只作为排序提示，允许用户利用中转时间游玩。
   */
  function validateItinerary(segments, opts = {}) {
    const reasons = []
    const warnings = []
    const list = Array.isArray(segments) ? segments : []
    const maxTransfers = opts.maxTransfers == null ? 2 : Math.max(0, Math.min(2, Number(opts.maxTransfers)))
    const transferType = opts.transferType || 'airline'
    const minLayover = opts.minLayoverMinutes == null ? (transferType === 'self' ? 240 : 60) : opts.minLayoverMinutes
    const preferredLayoverMax = opts.preferredLayoverMaxMinutes == null
      ? (transferType === 'self' ? 1440 : 720)
      : opts.preferredLayoverMaxMinutes
    const preferredTotalMax = opts.preferredTotalMaxMinutes == null ? 2880 : opts.preferredTotalMaxMinutes
    const requireKnown = opts.requireKnown === true

    if (list.length === 0) reasons.push('empty_itinerary')
    if (list.length - 1 > maxTransfers) reasons.push('too_many_transfers')

    const visited = new Set()
    const layovers = []
    for (let index = 0; index < list.length; index++) {
      const segment = list[index]
      if (!segment.origin || !segment.destination || segment.origin === segment.destination) reasons.push('invalid_segment')
      if (index === 0) visited.add(segment.origin)
      if (visited.has(segment.destination)) reasons.push('cycle_or_repeated_airport')
      visited.add(segment.destination)
      if (index > 0) {
        const previous = list[index - 1]
        if (previous.destination !== segment.origin) reasons.push('disconnected_segments')
        const layover = minutesBetween(previous.arriveTime, segment.departTime)
        if (layover == null) reasons.push('unknown_connection_time')
        else {
          layovers.push(layover)
          if (layover < minLayover) reasons.push('connection_too_short')
          if (layover > preferredLayoverMax) warnings.push('long_layover')
        }
      }
      if (requireKnown && routeStatus(segment.origin, segment.destination, dateOnly(segment.departTime)).status !== 'reachable') {
        reasons.push('unknown_or_unreachable_segment')
      }
    }

    if (list.length > 0) {
      const total = minutesBetween(list[0].departTime, list[list.length - 1].arriveTime)
      if (total != null && total > preferredTotalMax) warnings.push('long_total_duration')
    }
    return {
      valid: reasons.length === 0,
      reasons: [...new Set(reasons)],
      warnings: [...new Set(warnings)],
      layovers,
      totalLayoverMinutes: layovers.reduce((sum, value) => sum + value, 0)
    }
  }

  return {
    addEdge,
    routeStatus,
    canFly,
    outgoing,
    findPaths,
    observeSegments,
    validateItinerary,
    edgeCount: () => edgesByPair.size,
    airportCount: () => knownAirports.size
  }
}

const defaultIndex = createConnectivityIndex(SEED_EDGES)

module.exports = {
  TOPOLOGY_VERSION,
  SEED_EDGES,
  createConnectivityIndex,
  addEdge: defaultIndex.addEdge,
  routeStatus: defaultIndex.routeStatus,
  canFly: defaultIndex.canFly,
  outgoing: defaultIndex.outgoing,
  findPaths: defaultIndex.findPaths,
  observeSegments: defaultIndex.observeSegments,
  validateItinerary: defaultIndex.validateItinerary,
  edgeCount: defaultIndex.edgeCount,
  airportCount: defaultIndex.airportCount
}
