import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { fetch, EnvHttpProxyAgent } from 'undici'
import { dataRoot } from './paths.mjs'

const normalize = value => String(value || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
const streetName = value => value.replace(/\s+(?:street|road|avenue)$/i, '').trim()
const pending = new Map()
let dispatcher, retryAfter = 0
export function locationIdentity(input) {
  if (!input || typeof input.name !== 'string' || !input.name.trim() || input.name.length > 180) throw Error('需要明确的景点名称')
  if (input.query != null && (typeof input.query !== 'string' || input.query.length > 160)) throw Error('无效的景点名称')
  if (typeof input.city !== 'string' || !input.city.trim() || input.city.length > 120) throw Error('需要景点所在城市')
  return { name: input.name.trim(), query: (input.query || input.name).trim(), city: input.city.trim() }
}
export function matchPlaceEntities(items, identity) {
  const query = normalize(streetName(identity.query)), city = normalize(identity.city)
  return (items || []).filter(item => /^Q\d+$/.test(item.id)
    && [item.label, item.match?.text].some(name => normalize(streetName(String(name || ''))) === query)
    && normalize(item.description).includes(city)
    && !/\b(?:painting|photograph|print|human|surname)\b/i.test(item.description || ''))
}
export function entityLocation(entity) {
  if (!/^Q\d+$/.test(entity?.id || '')) return null
  const claims = (entity?.claims?.P625 || []).filter(claim => claim.rank !== 'deprecated')
  const preferred = claims.some(claim => claim.rank === 'preferred') ? claims.filter(claim => claim.rank === 'preferred') : claims
  const points = preferred.map(claim => claim.mainsnak?.datavalue?.value).filter(point => point
    && point.globe === 'http://www.wikidata.org/entity/Q2'
    && Number.isFinite(point.latitude) && Math.abs(point.latitude) <= 90
    && Number.isFinite(point.longitude) && Math.abs(point.longitude) <= 180)
  if (!points.length || points.some(point => Math.abs(point.latitude - points[0].latitude) > .001 || Math.abs(point.longitude - points[0].longitude) > .001)) return null
  return { latitude: points[0].latitude, longitude: points[0].longitude,
    source: { label: 'Wikidata', url: `https://www.wikidata.org/wiki/${entity.id}`, status: 'unverified' } }
}
export async function queryPlaceLocation(identity, { request = fetch } = {}) {
  if (Date.now() < retryAfter) throw Error('地点服务稍后重试')
  dispatcher ??= new EnvHttpProxyAgent()
  const signal = AbortSignal.timeout(12000)
  const query = async parameters => {
    const url = new URL('https://www.wikidata.org/w/api.php')
    url.search = new URLSearchParams({ format: 'json', maxlag: '5', ...parameters }).toString()
    const response = await request(url, { dispatcher, signal, redirect: 'error', headers: { 'User-Agent': 'FlightOR/0.1 (local travel planner; landmark coordinates)', accept: 'application/json' } })
    if (response.status === 429) retryAfter = Date.now() + Math.max(60000, (Number(response.headers?.get('retry-after')) || 60) * 1000)
    if (!response.ok) throw Error('地点服务暂不可用')
    const value = await response.json()
    if (value.error) throw Error('地点查询未完成')
    return value
  }
  const search = async name => (await query({ action: 'wbsearchentities', search: name, language: 'en', uselang: 'en', type: 'item', limit: '5' })).search
  let matches = matchPlaceEntities(await search(identity.query), identity)
  if (!matches.length && streetName(identity.query) !== identity.query) matches = matchPlaceEntities(await search(streetName(identity.query)), identity)
  if (matches.length !== 1) return null
  const id = matches[0].id
  const value = await query({ action: 'wbgetentities', ids: id, props: 'claims' })
  return entityLocation(value.entities?.[id])
}
export async function loadPlaceLocation(input, { root = dataRoot, lookup = queryPlaceLocation, now = Date.now } = {}) {
  const identity = locationIdentity(input)
  const key = crypto.createHash('sha256').update(JSON.stringify(identity)).digest('hex')
  const directory = path.join(root, 'place-locations'), file = path.join(directory, key + '.json')
  try { const cached = JSON.parse(await fs.readFile(file, 'utf8')); if (cached.expiresAt > now()) return cached.result } catch {}
  if (pending.has(file)) return pending.get(file)
  const task = (async () => {
    try {
      const location = await lookup(identity)
      const result = { location, status: location ? 'resolved' : 'not-found' }
      await fs.mkdir(directory, { recursive: true })
      const temporary = file + '.' + crypto.randomUUID() + '.tmp'
      await fs.writeFile(temporary, JSON.stringify({ expiresAt: now() + (location ? 30 * 86400000 : 86400000), result }))
      await fs.rename(temporary, file)
      return result
    } catch { return { location: null, status: 'unavailable' } }
  })()
  pending.set(file, task)
  try { return await task } finally { pending.delete(file) }
}
