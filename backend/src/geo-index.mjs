import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { dataRoot } from './paths.mjs'

export const normalizePlaceName = value => String(value || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
export function distanceKm(a, b) {
  const r = Math.PI / 180, dlat = (b.latitude - a.latitude) * r, dlon = (b.longitude - a.longitude) * r
  return 12742 * Math.asin(Math.min(1, Math.sqrt(Math.sin(dlat / 2) ** 2 + Math.cos(a.latitude * r) * Math.cos(b.latitude * r) * Math.sin(dlon / 2) ** 2)))
}
export const validPoint = point => point && Number.isFinite(point.latitude) && Math.abs(point.latitude) <= 90 && Number.isFinite(point.longitude) && Math.abs(point.longitude) <= 180
const isCity = row => /\b(city|town|village|municipality|capital|settlement|commune|borough|district)\b/i.test(row.description || '')
const asPlace = row => row ? { ...row, qid: 'Q' + row.id, source: { label: 'Wikidata · Wikimedia Geo (CC0)', url: `https://www.wikidata.org/wiki/Q${row.id}`, status: 'unverified' } } : null

/** A read-only indexed SQLite connection. No Parquet scan or Python process per HTTP request. */
export class GeoIndex {
  constructor(file = path.join(dataRoot, 'wikimedia-geo', 'places.sqlite')) {
    this.db = new DatabaseSync(file, { readOnly: true })
    this.db.exec('PRAGMA query_only=ON; PRAGMA cache_size=-8192;')
    this.manifest = JSON.parse(this.db.prepare("SELECT value FROM metadata WHERE key='manifest'").get().value)
    if (this.manifest.schemaVersion !== 1) { this.close(); throw Error('Unsupported geo index schema') }
  }
  close() { this.db.close() }
  byQid(qid) {
    if (!/^Q[1-9]\d{0,11}$/.test(qid || '')) return null
    return asPlace(this.db.prepare('SELECT * FROM places WHERE id=?').get(Number(qid.slice(1))))
  }
  byName(name) {
    const key = normalizePlaceName(name)
    if (!key) return []
    return this.db.prepare('SELECT * FROM places WHERE name_key=? LIMIT 201').all(key).map(asPlace)
  }
  nearby(point, radiusKm = 2) {
    if (!validPoint(point) || !Number.isFinite(radiusKm) || radiusKm <= 0 || radiusKm > 20) throw Error('Invalid geo radius or coordinates')
    const delta = radiusKm / 110.574
    // Longitude is filtered by true great-circle distance, including poles and the dateline.
    const rows = this.db.prepare('SELECT * FROM places WHERE latitude BETWEEN ? AND ?').all(point.latitude - delta, point.latitude + delta)
    return rows.map(asPlace).map(row => ({ ...row, distanceKm: distanceKm(point, row) })).filter(row => row.distanceKm <= radiusKm).sort((a, b) => a.distanceKm - b.distanceKm).slice(0, 50)
  }
  resolve(input) {
    let candidates
    if (input.qid) candidates = [this.byQid(input.qid)].filter(Boolean)
    else {
      const names = [...new Set([input.query, input.name].filter(Boolean))]
      candidates = [...new Map(names.flatMap(name => this.byName(name)).map(row => [row.qid, row])).values()]
    }
    if (candidates.length > 200) return { status: 'ambiguous', candidates: [] }
    if (!candidates.length) return { status: 'not-found', candidates: [] }
    candidates = candidates.filter(row => row.precision == null || row.precision <= .01)
    if (input.city) {
      const cityKey = normalizePlaceName(input.city)
      const anchors = this.byName(input.city).filter(isCity)
      candidates = candidates.filter(row => {
        if (anchors.length && anchors.length <= 200) return anchors.some(anchor => distanceKm(anchor, row) <= 50)
        const description = ' ' + normalizePlaceName(row.description) + ' '
        return description.includes(' ' + cityKey + ' ')
      })
    }
    if (validPoint(input)) candidates = candidates.filter(row => distanceKm(input, row) <= 2)
    return candidates.length === 1 ? { status: 'resolved', place: candidates[0] }
      : { status: candidates.length ? 'ambiguous' : 'not-found', candidates }
  }
}

let cached
export function defaultGeoIndex() {
  if (cached) return cached
  const file = process.env.FLIGHTOR_GEO_INDEX || path.join(dataRoot, 'wikimedia-geo', 'places.sqlite')
  if (!fs.existsSync(file)) return null
  cached = new GeoIndex(file)
  return cached
}
