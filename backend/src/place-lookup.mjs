import { defaultPlaceResolver, placeIdentity } from './place-resolver.mjs'
import { normalizePlaceName, validPoint, distanceKm } from './geo-index.mjs'
import { claimValues } from './wikidata-entity.mjs'
import { actionUrl } from './wikimedia-http.mjs'
import { commonsFile, queryCommons } from './commons-media.mjs'
import { cachedPlace } from './place-cache.mjs'
import { performance } from 'node:perf_hooks'

const source = qid => ({ label: 'Wikidata', url: `https://www.wikidata.org/wiki/${qid}`, status: 'unverified' })
const coordinate = place => validPoint(place) ? { latitude: place.latitude, longitude: place.longitude, source: place.source || source(place.qid || place.id) } : null
const fromEntity = entity => {
  const point = claimValues(entity, 'P625').find(validPoint)
  return point ? { ...coordinate(point), source: source(entity.id) } : null
}
// City is a separate field; strip a repeated trailing city or comma-separated street address.
// This is query syntax normalization, not another semantic correction round.
const searchName = input => {
  let query = input.query.split(/[,，]/)[0].trim()
  if (input.city && query.toLowerCase().endsWith(' ' + input.city.toLowerCase())) query = query.slice(0, -input.city.length).trim()
  return query || input.query
}

/** Coverage-first MVP policy. Strict PlaceResolver.resolve remains available for source analysis. */
export class PlaceLookup {
  constructor({ resolver = defaultPlaceResolver(), cacheRoot } = {}) { Object.assign(this, { resolver, cacheRoot }) }
  local(input) {
    const { index, enrichment } = this.resolver
    const names = [...new Set([input.query, searchName(input), input.name, ...(input.city ? [`${input.query}, ${input.city}`, `${input.query} (${input.city})`] : [])])]
    const known = input.qid && enrichment?.get(input.qid)
    const rows = input.qid ? [index?.byQid(input.qid), known ? { qid: known.id, ...fromEntity(known), entity: known } : null].filter(Boolean) : names.flatMap(name => [
      ...(index?.byName(name) || []), ...(enrichment?.byName(name) || []).map(entity => ({ qid: entity.id, ...fromEntity(entity), entity, description: entity.descriptions?.en?.value }))
    ])
    const cityKey = normalizePlaceName(input.city)
    const anchors = input.city ? (index?.byName(input.city) || []).filter(validPoint) : []
    const score = row => (cityKey && normalizePlaceName(row.description).includes(cityKey) ? 10 : 0)
      + (anchors.some(anchor => validPoint(row) && distanceKm(anchor, row) < 50) ? 5 : 0) + (validPoint(row) ? 1 : 0)
    return rows.filter(Boolean).sort((a, b) => score(b) - score(a))[0] || null
  }
  async candidate(input, { signal } = {}) {
    const local = this.local(input)
    if (local) return local
    if (this.resolver.offline) return null
    if (input.qid) return { qid: input.qid }
    const { http } = this.resolver
    const language = /\p{Script=Han}/u.test(input.query) ? 'zh' : 'en'
    try {
      const token = await this.resolver.enterpriseToken?.()
      if (token) {
        const articles = await http.json(`https://api.enterprise.wikimedia.com/v2/articles/${encodeURIComponent(searchName(input))}`, {
          signal, method: 'POST', headers: { authorization: 'Bearer ' + token },
          body: JSON.stringify({ fields: ['name', 'main_entity', 'is_part_of'], filters: [{ field: 'is_part_of.identifier', value: language + 'wiki' }] }) })
        const qid = Array.isArray(articles) && articles.find(row => /^Q[1-9]\d*$/.test(row.main_entity?.identifier || ''))?.main_entity.identifier
        if (qid) return { qid, via: 'enterprise' }
      }
    } catch { signal?.throwIfAborted() }
    const value = await http.json(actionUrl('www.wikidata.org', { action: 'wbsearchentities', search: searchName(input),
      language, uselang: 'en', type: 'item', limit: '5' }), { signal, ttlMs: 86400000 })
    const rows = (value.search || []).filter(row => /^Q[1-9]\d*$/.test(row.id || ''))
    const city = normalizePlaceName(input.city)
    rows.sort((a, b) => Number(!!city && normalizePlaceName(b.description).includes(city)) - Number(!!city && normalizePlaceName(a.description).includes(city)))
    if (rows.length) return { qid: rows[0].id, via: 'public-api' }
    // An empty successful public search is a semantic miss, even if optional Enterprise failed.
    return null
  }
  async lookup(raw, { fields = ['location', 'image'], signal, onField = () => {}, cache = true } = {}) {
    const input = placeIdentity(raw)
    const started = performance.now(), via = {}
    let candidateTask, entityTask
    let entitySource
    const candidate = () => candidateTask ??= this.candidate(input, { signal })
    const entity = async () => entityTask ??= (async () => {
      const place = await candidate()
      if (place?.entity) { entitySource = 'entity-cache'; return place.entity }
      return place?.qid ? (await this.resolver.entities([place.qid], { signal, onSource: (_id, source) => { entitySource = source } }))[place.qid] : null
    })()
    const location = async () => {
      const local = this.local(input)
      if (coordinate(local)) { via.location = local.entity ? 'entity-cache' : 'local-index'; return coordinate(local) }
      const place = await candidate()
      if (coordinate(place)) { via.location = place.via || 'local-index'; return coordinate(place) }
      const value = fromEntity(await entity()); via.location = entitySource || place?.via
      return value
    }
    const image = async () => {
      let failure, details
      try { details = await entity() } catch (error) { failure = error }
      const options = { http: this.resolver.http, signal }
      if (details) {
        for (const title of claimValues(details, 'P18').filter(value => typeof value === 'string').slice(0, 1)) {
          try { const media = await commonsFile(title, input, options); if (media) { via.image = (entitySource || 'entity-cache') + '+P18/Commons-license'; return media } } catch (error) { failure = error }
        }
        try {
          const title = await this.resolver.wikipediaImage(details, { signal, requireIdentity: false })
          if (title) { const media = await commonsFile(title, input, options); if (media) { via.image = 'main-image/Commons-license'; return media } }
        } catch (error) { failure = error }
      }
      // Image search is independent of whether any coordinate or entity was obtained.
      try { const media = await queryCommons(input, { ...options, acceptSearchResult: true }); if (media) { via.image = 'public-api/Commons-search'; return media } }
      catch (error) { failure = error }
      if (failure) throw failure
      return null
    }
    const result = {}
    await Promise.all(fields.map(async field => {
      const read = field === 'image' ? image : location
      const value = cache ? await cachedPlace(field === 'image' ? 'place-media' : 'place-locations', input, read,
        { root: this.cacheRoot, signal, onCacheHit: () => { via[field] = 'field-cache' } }) : await (async () => {
          try { const data = await read(); return { [field === 'image' ? 'media' : 'location']: data, status: data ? 'found' : 'not-found' } }
          catch { return { status: 'unavailable' } }
        })()
      const data = value[field === 'image' ? 'media' : 'location']
      result[field] = { status: data ? 'found' : signal?.aborted ? 'timed-out' : value.status, value: data, via: via[field] || null, elapsedMs: performance.now() - started }
      if (!signal?.aborted) await onField(field, result[field])
    }))
    return result
  }
}
let shared
export function defaultPlaceLookup() { return shared ??= new PlaceLookup() }
