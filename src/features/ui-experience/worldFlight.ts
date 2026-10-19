import airportCoordinates from '../../assets/ui-experience/airport-coordinates.json'
import type { FlightLegDisplay } from './presentation'

type Coordinate = [number, number]
export interface WorldPoint { x: number; y: number }
export interface WorldLeg { from: string; to: string; points: WorldPoint[]; distance: number }
const rad = Math.PI / 180
export const projectWorldPoint = ([lon, lat]: Coordinate): WorldPoint => ({ x: (lon + 180) / 3.6, y: (90 - lat) / 1.8 })
const vector = ([lon, lat]: Coordinate) => [Math.cos(lat * rad) * Math.cos(lon * rad), Math.cos(lat * rad) * Math.sin(lon * rad), Math.sin(lat * rad)]
function greatCircle(from: Coordinate, to: Coordinate) {
  const a = vector(from), b = vector(to)
  const angle = Math.acos(Math.max(-1, Math.min(1, a.reduce((sum, value, i) => sum + value * b[i], 0))))
  const points = Array.from({ length: 49 }, (_, i) => {
    const t = i / 48
    if (angle < .000001 || Math.abs(Math.sin(angle)) < .000001) {
      const delta = ((to[0] - from[0] + 540) % 360) - 180
      return projectWorldPoint([((from[0] + delta * t + 540) % 360) - 180, from[1] + (to[1] - from[1]) * t])
    }
    const v = a.map((value, n) => (Math.sin((1 - t) * angle) * value + Math.sin(t * angle) * b[n]) / Math.sin(angle))
    return projectWorldPoint([Math.atan2(v[1], v[0]) / rad, Math.atan2(v[2], Math.hypot(v[0], v[1])) / rad])
  })
  return { points, distance: angle }
}
export function worldFlightLegs(legs: FlightLegDisplay[]): WorldLeg[] {
  const directory = airportCoordinates as Record<string, number[]>
  return legs.flatMap(leg => {
    const from = directory[(leg.fromCode || leg.from).toUpperCase()], to = directory[(leg.toCode || leg.to).toUpperCase()]
    if (!from || !to) return []
    const arc = greatCircle(from as Coordinate, to as Coordinate)
    return arc.distance > .000001 ? [{ from: leg.from, to: leg.to, ...arc }] : []
  })
}
export function worldTrackLines(legs: WorldLeg[]) {
  return legs.flatMap(leg => leg.points.slice(1).flatMap((point, i) => {
    const from = leg.points[i]
    let dx = point.x - from.x
    if (dx > 50) dx -= 100
    if (dx < -50) dx += 100
    const dy = (point.y - from.y) / 2
    const line = { x: from.x, y: from.y, width: Math.hypot(dx, dy), angle: Math.atan2(dy, dx) / rad }
    return Math.abs(point.x - from.x) > 50 ? [line, { ...line, x: from.x + (dx > 0 ? -100 : 100) }] : [line]
  }))
}
export function worldFlightPosition(legs: WorldLeg[], progress: number) {
  if (!legs.length) return null
  const total = legs.reduce((sum, leg) => sum + leg.distance, 0)
  let traveled = Math.max(0, Math.min(1, progress)) * total, leg = legs[legs.length - 1]
  for (const candidate of legs) { leg = candidate; if (traveled <= candidate.distance) break; traveled -= candidate.distance }
  const offset = Math.min(47.999999, traveled / leg.distance * 48), index = Math.floor(offset), t = offset - index
  const a = leg.points[index], b = leg.points[index + 1]
  let dx = b.x - a.x
  if (dx > 50) dx -= 100
  if (dx < -50) dx += 100
  return { x: (a.x + dx * t + 100) % 100, y: a.y + (b.y - a.y) * t, angle: Math.atan2((b.y - a.y) / 2, dx) / rad }
}
