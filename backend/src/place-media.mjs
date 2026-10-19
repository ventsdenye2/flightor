import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { fetch, EnvHttpProxyAgent } from 'undici'
import { dataRoot } from './paths.mjs'

const api = 'https://commons.wikimedia.org/w/api.php'
let dispatcher
const pending = new Map()
const plain = value => String(value || '').replace(/<[^>]*>/g, ' ').replace(/&(?:amp|quot|lt|gt|nbsp);/g, ' ').replace(/\s+/g, ' ').trim()
const normalized = value => plain(value).normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
const safeUrl = (value, host) => { try { const url = new URL(value); return url.protocol === 'https:' && url.hostname === host && !url.username && !url.password ? url.href : null } catch { return null } }

export function mediaIdentity(input) {
  if (!input || typeof input.name !== 'string' || !input.name.trim() || input.name.length > 180) throw Error('需要明确的景点名称')
  if (input.query != null && (typeof input.query !== 'string' || input.query.length > 160)) throw Error('无效的景点检索名称')
  if (input.city != null && (typeof input.city !== 'string' || input.city.length > 120)) throw Error('无效的景点城市')
  const clean = value => String(value || '').replace(/["|<>:]/g, ' ').replace(/\s+/g, ' ').trim()
  return { name: input.name.trim(), query: clean(input.query || input.name.replace(/[（(].*?[）)]/g, '')), city: clean(input.city) }
}

export function chooseCommonsPhoto(pages, identity) {
  const tokens = normalized(identity.query).split(' ').filter(token => token.length > 1 && !['the', 'in', 'of', 'and', 'at'].includes(token))
  if (!tokens.length) return null
  const choices = []
  for (const page of pages || []) {
    const info = page.imageinfo?.[0], meta = info?.extmetadata || {}
    const title = normalized(page.title?.replace(/^File:/, ''))
    const description = normalized(meta.ImageDescription?.value)
    // Require the actual landmark name, never a city-only or arbitrary first result.
    if (!tokens.every(token => title.includes(token) || description.includes(token))) continue
    const src = safeUrl(info?.thumburl, 'upload.wikimedia.org') || safeUrl(info?.thumburl, 'thumb.wikimedia.org')
    const sourceUrl = safeUrl(info?.descriptionurl, 'commons.wikimedia.org')
    const license = plain(meta.LicenseShortName?.value)
    const licenseUrl = safeUrl(meta.LicenseUrl?.value?.replace(/^\/\//, 'https://'), 'creativecommons.org')
      || safeUrl(meta.LicenseUrl?.value, 'commons.wikimedia.org')
    const author = plain(meta.Artist?.value)
    const free = /^(CC BY(?:-SA)? [\d.]+|CC0(?: [\d.]+)?|Public domain|PD)$/i.test(license)
    if (!src || !sourceUrl || !author || !free || (!licenseUrl && !/^(Public domain|PD)$/i.test(license))) continue
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(info.mime) || info.width < 600 || info.height < 350) continue
    if (meta.Restrictions?.value || /(?:non.?commercial|no.?derivatives)/i.test(license)) continue
    const ratio = info.width / info.height
    choices.push({ score: (tokens.every(token => title.includes(token)) ? 4 : 0) + (ratio > 1.2 && ratio < 2.2 ? 2 : 0), media: {
      src, description: identity.name, author, license, licenseUrl: licenseUrl || sourceUrl,
      source: { label: 'Wikimedia Commons', url: sourceUrl, status: 'unverified' }
    } })
  }
  return choices.sort((a, b) => b.score - a.score)[0]?.media || null
}

export async function queryCommons(identity, { request = fetch, signal } = {}) {
  dispatcher ??= new EnvHttpProxyAgent()
  const url = new URL(api)
  url.search = new URLSearchParams({ action: 'query', format: 'json', formatversion: '2', generator: 'search',
    gsrsearch: `"${identity.query}" ${identity.city ? `"${identity.city}"` : ''} filetype:bitmap`, gsrnamespace: '6', gsrlimit: '8',
    prop: 'imageinfo', iiprop: 'url|mime|size|extmetadata', iiurlwidth: '960',
    iiextmetadatafilter: 'Artist|LicenseShortName|LicenseUrl|ImageDescription|Restrictions', maxlag: '5' }).toString()
  const response = await request(url, { dispatcher, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000),
    redirect: 'error', headers: { 'User-Agent': 'FlightOR/0.1 (local travel planner; Wikimedia Commons image lookup)', accept: 'application/json' } })
  if (!response.ok) throw Error('Commons暂不可用')
  const value = await response.json()
  if (value.error) throw Error('Commons查询未完成')
  return chooseCommonsPhoto(value.query?.pages, identity)
}

export async function loadPlaceMedia(input, { root = dataRoot, lookup = queryCommons, now = Date.now } = {}) {
  const identity = mediaIdentity(input)
  const key = crypto.createHash('sha256').update(JSON.stringify(identity)).digest('hex')
  const directory = path.join(root, 'place-media'), file = path.join(directory, key + '.json')
  try { const cached = JSON.parse(await fs.readFile(file, 'utf8')); if (cached.expiresAt > now()) return cached.result } catch {}
  const pendingKey = file
  if (pending.has(pendingKey)) return pending.get(pendingKey)
  const task = (async () => {
    try {
      const media = await lookup(identity)
      const result = { media, status: media ? 'ready' : 'not-found' }
      await fs.mkdir(directory, { recursive: true })
      const temporary = file + '.' + crypto.randomUUID() + '.tmp'
      await fs.writeFile(temporary, JSON.stringify({ expiresAt: now() + (media ? 7 * 86400000 : 3600000), result }))
      await fs.rename(temporary, file)
      return result
    } catch { return { media: null, status: 'unavailable' } }
  })()
  pending.set(pendingKey, task)
  try { return await task } finally { pending.delete(pendingKey) }
}
