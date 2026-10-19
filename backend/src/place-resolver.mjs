import { defaultGeoIndex, normalizePlaceName, validPoint, distanceKm } from './geo-index.mjs'
import { PlaceEnrichment } from './place-enrichment.mjs'
import { entityLocation, entityNames, exactEntityName, entityPlace, claimValues, fromEnterpriseEntity } from './wikidata-entity.mjs'
import { actionUrl, wikimediaHttp } from './wikimedia-http.mjs'
import { commonsFile, queryCommons } from './commons-media.mjs'
import { enterpriseTokens } from './enterprise-tokens.mjs'

const unique = rows => [...new Map(rows.filter(Boolean).map(row => [row.qid, row])).values()]
const cityLike = row => /\b(city|town|village|municipality|capital|settlement|commune|borough|district)\b/i.test(row.description || '')
const variant = value => String(value || '').replace(/\s+(?:street|road|avenue)$/i, '').trim()
const physicalPlace = (row, input) => !/\b(world heritage site|heritage property|academic|scholarly article)\b/i.test(row.description || '') || articleMatch(row, [input.name, input.query].filter(Boolean))
const cityParts = value => String(value || '').split(/[,，]/).map(normalizePlaceName).filter(Boolean)
const cityVariants = value => /\p{Script=Han}/u.test(value || '') ? [...new Set([value, value.replace(/市$/, ''), value.endsWith('市') ? value : value + '市'])] : [value]
const exactCityName = (entity, name) => entityNames(entity).some(value => cityVariants(name).some(variant => normalizePlaceName(value) === normalizePlaceName(variant)))
const articleMatch = (row, names) => Object.values(row.entity?.sitelinks || {}).some(site => names.some(name => normalizePlaceName(site.title) === normalizePlaceName(name)))
const preferArticleIdentity = (rows, names) => {
  const linked = rows.filter(row => articleMatch(row, names))
  return linked.length === 1 ? linked : rows
}
const cityEntity = (entity, local) => {
  const place = entityPlace(entity, local, { allowCoarse: true })
  return place || { qid: entity.id, label: entity.labels?.en?.value || entityNames(entity)[0], names: entityNames(entity), description: entity.descriptions?.en?.value || '', entity }
}
export function placeIdentity(input) {
  if (!input || typeof input.name !== 'string' || !input.name.trim() || input.name.length > 180) throw Error('需要明确的景点名称')
  if (input.query != null && (typeof input.query !== 'string' || input.query.length > 160)) throw Error('无效的景点检索名称')
  if (input.city != null && (typeof input.city !== 'string' || input.city.length > 120)) throw Error('无效的景点城市')
  if (input.qid != null && (typeof input.qid !== 'string' || !/^Q[1-9]\d{0,11}$/.test(input.qid))) throw Error('无效的 Wikidata QID')
  if ((input.latitude != null || input.longitude != null) && !validPoint(input)) throw Error('无效的景点坐标')
  const clean = value => String(value || '').replace(/["|<>:]/g, ' ').replace(/\s+/g, ' ').trim()
  return { name: input.name.trim(), query: clean(input.query || input.name.replace(/[（(].*?[）)]/g, '')), city: clean(input.city),
    ...(input.qid ? { qid: input.qid } : {}), ...(validPoint(input) ? { latitude: input.latitude, longitude: input.longitude } : {}) }
}

export class PlaceResolver {
  constructor({ index = defaultGeoIndex(), http = wikimediaHttp, enrichment, offline = process.env.FLIGHTOR_PLACES_OFFLINE === '1', enterpriseToken = () => enterpriseTokens.getAccessToken() } = {}) {
    Object.assign(this, { index, http, offline, enterpriseToken })
    this.enrichment = enrichment === undefined ? new PlaceEnrichment() : enrichment
    this.pending = new Map()
  }
  #names(name) {
    const local = this.index?.byName(name) || []
    const enriched = (this.enrichment?.byName(name) || []).map(entity => {
      const row = this.index?.byQid(entity.id)
      return entityPlace(entity, row, { allowCoarse: true })
    })
    return unique([...local, ...enriched])
  }
  #filter(candidates, input, cities) {
    if (candidates.length > 200 || cities.length > 200) return []
    return candidates.filter(row => {
      if (!physicalPlace(row, input)) return false
      if (row.precision != null && row.precision > .01) return false
      if (validPoint(input) && distanceKm(input, row) > 2) return false
      if (!input.city) return true
      const cityNames = [input.city, ...cities.flatMap(city => [city.label, ...(city.names || [])])].map(normalizePlaceName).filter(Boolean)
      const description = ' ' + normalizePlaceName(row.description) + ' '
      if (cities.some(validPoint)) return cities.some(city => validPoint(city) && distanceKm(city, row) <= 50 || claimValues(row.entity, 'P131').some(value => value.id === city.qid))
      return cityNames.some(city => description.includes(' ' + city + ' '))
    })
  }
  async entities(ids, { signal } = {}) {
    ids = [...new Set(ids)].filter(id => /^Q[1-9]\d{0,11}$/.test(id)).slice(0, 50)
    const result = {}, missing = []
    for (const id of ids) {
      const entity = this.enrichment?.get(id)
      if (entity) result[id] = entity
      else missing.push(id)
    }
    if (missing.length && !this.offline) {
      let value, failure, token
      try { token = await this.enterpriseToken?.() } catch {}
      if (!token) {
        try {
          value = await this.http.json(actionUrl('www.wikidata.org', { action: 'wbgetentities', ids: missing.join('|'),
            props: 'labels|aliases|descriptions|claims|sitelinks', languages: 'en|zh|zh-hans|zh-hant', sitefilter: 'enwiki|zhwiki' }), { signal, ttlMs: 30 * 86400000 })
        } catch (error) { failure = error }
      }
      if (!value && token) {
        const entities = {}
        for (const id of missing) {
          try {
            const raw = await this.http.json(`https://api.enterprise.wikimedia.com/v2/wikidata/items/${id}`, { signal, headers: { authorization: 'Bearer ' + token }, ttlMs: 30 * 86400000 })
            const entity = fromEnterpriseEntity(raw)
            if (entity?.id === id) entities[id] = entity
          } catch (error) { failure = error }
        }
        const absent = missing.filter(id => !entities[id])
        if (absent.length) {
          try {
            const fallback = await this.http.json(actionUrl('www.wikidata.org', { action: 'wbgetentities', ids: absent.join('|'), props: 'labels|aliases|descriptions|claims|sitelinks', languages: 'en|zh|zh-hans|zh-hant', sitefilter: 'enwiki|zhwiki' }), { signal, ttlMs: 30 * 86400000 })
            Object.assign(entities, fallback.entities)
          } catch (error) { if (!Object.keys(entities).length) throw error }
        }
        value = { entities }
      }
      if (!value) throw failure || Error('Entity data unavailable')
      for (const [id, entity] of Object.entries(value.entities || {})) {
        if (!ids.includes(id) || entity.missing != null || entity.id !== id) continue
        result[id] = entity
        try { this.enrichment?.put(entity) } catch { /* Keep successful public data when disk is read-only. */ }
      }
    }
    return result
  }
  async #search(name, { signal, city = false, context } = {}) {
    const language = /\p{Script=Han}/u.test(name) ? 'zh' : 'en'
    {
      try {
        const token = await this.enterpriseToken?.()
        if (token) {
          for (const articleName of context ? [`${name}, ${context}`, `${name} (${context})`] : [name]) {
            try {
              const articles = await this.http.json(`https://api.enterprise.wikimedia.com/v2/articles/${encodeURIComponent(articleName)}`, {
                signal, method: 'POST', headers: { authorization: 'Bearer ' + token },
                body: JSON.stringify({ fields: ['name', 'main_entity', 'is_part_of'], filters: [{ field: 'is_part_of.identifier', value: language + 'wiki' }] }) })
              const ids = Array.isArray(articles) ? [...new Set(articles.filter(article => article.is_part_of?.identifier === language + 'wiki' && normalizePlaceName(article.name) === normalizePlaceName(articleName)).map(article => article.main_entity?.identifier).filter(id => /^Q[1-9]\d*$/.test(id || '')))] : []
              if (ids.length) return ids
            } catch { signal?.throwIfAborted() }
          }
        }
      } catch { /* Exact article names are optional; free Enterprise has no fuzzy name search. */ }
    }
    const value = await this.http.json(actionUrl('www.wikidata.org', { action: 'wbsearchentities', search: context ? name + ' ' + context : name, language, uselang: 'en', type: 'item', limit: '10' }), { signal, ttlMs: 86400000 })
    return (value.search || []).filter(item => /^Q[1-9]\d*$/.test(item.id || '') && (!city || cityLike(item))
      && !/\b(scientific article|article published|film directed|television|album|human|surname|fictional)\b/i.test(item.description || '')).map(item => item.id)
  }
  async resolve(raw, { signal, offline = this.offline } = {}) {
    const input = placeIdentity(raw)
    const key = JSON.stringify([input, offline])
    if (!signal && this.pending.has(key)) return this.pending.get(key)
    const task = this.#resolve(input, { signal, offline })
    if (!signal) this.pending.set(key, task)
    try { return await task } finally { if (!signal) this.pending.delete(key) }
  }
  async #resolve(input, { signal, offline }) {
    const names = [...new Set([input.query, input.name, variant(input.query), ...(input.city ? [`${input.query}, ${input.city}`, `${input.query} (${input.city})`] : [])].filter(Boolean))]
    const contextualCandidates = input.city ? unique([`${input.query}, ${input.city}`, `${input.query} (${input.city})`].flatMap(name => this.#names(name))) : []
    let candidates = input.qid ? [this.index?.byQid(input.qid) || entityPlace(this.enrichment?.get(input.qid))].filter(Boolean)
      : contextualCandidates.length ? contextualCandidates : unique(names.flatMap(name => this.#names(name)))
    const parts = cityParts(input.city)
    const learnedCities = input.city ? cityVariants(input.city).flatMap(name => this.enrichment?.byName(name) || []).map(entity => cityEntity(entity, this.index?.byQid(entity.id))) : []
    let cities = input.city ? unique([...this.#names(input.city), ...learnedCities, ...(parts.length > 1 ? this.#names(parts[0]) : [])]).filter(cityLike)
      .filter(city => parts.slice(1).every(part => (' ' + normalizePlaceName(city.description) + ' ').includes(' ' + part + ' '))) : []
    let matches = preferArticleIdentity(this.#filter(candidates, input, cities), names)
    if (matches.length === 1) return { status: 'resolved', place: matches[0], method: 'offline' }
    if (offline) return { status: matches.length > 1 ? 'ambiguous' : 'not-found', candidates: matches.map(row => row.qid), method: 'offline' }
    const budget = AbortSignal.timeout(17000)
    signal = signal ? AbortSignal.any([signal, budget]) : budget
    if (input.city && (!cities.length || /\p{Script=Han}/u.test(input.city) && !cities.some(city => articleMatch(city, [input.city])))) {
      const ids = await this.#search(input.city, { signal, city: true })
      const values = await this.entities(ids.slice(0, 8), { signal })
      cities = unique(Object.values(values).filter(entity => exactCityName(entity, input.city)).map(entity => cityEntity(entity, this.index?.byQid(entity.id)))).filter(cityLike)
      matches = preferArticleIdentity(this.#filter(candidates, input, cities), names)
      if (matches.length === 1 && !/\p{Script=Han}/u.test(input.query)) return { status: 'resolved', place: matches[0], method: 'local+city' }
    }
    let ids = input.qid ? [input.qid] : this.#filter(candidates.length <= 200 ? candidates : [], input, cities).map(row => row.qid)
    if (!input.qid) {
      let searched = await this.#search(input.query, { signal })
      if (!searched.length && input.city) searched = await this.#search(input.query, { signal, context: input.city })
      ids = [...new Set([...ids, ...searched])]
      if (!ids.length && variant(input.query) !== input.query) ids = await this.#search(variant(input.query), { signal })
    }
    if (ids.length > 50) return { status: 'ambiguous', candidates: ids, method: 'online' }
    const values = await this.entities(ids, { signal })
    const enriched = Object.values(values).filter(entity => input.qid || names.some(name => exactEntityName(entity, name)))
      .map(entity => entityPlace(entity, this.index?.byQid(entity.id)))
    candidates = unique(enriched)
    matches = preferArticleIdentity(this.#filter(candidates, input, cities), names)
    if (matches.length !== 1 && input.city && !input.qid) {
      const contextIds = await this.#search(input.query, { signal, context: input.city })
      const extra = await this.entities(contextIds, { signal })
      const contextPlaces = Object.values(extra).filter(entity => names.some(name => exactEntityName(entity, name)))
        .map(entity => entityPlace(entity, this.index?.byQid(entity.id)))
      matches = preferArticleIdentity(this.#filter(unique([...candidates, ...contextPlaces]), input, cities), names)
    }
    if (matches.length > 1 && cities.length) {
      // Prefer explicit administrative ancestry over a broad city-radius heuristic.
      const cityIds = new Set(cities.map(city => city.qid)), proven = new Set()
      let frontier = new Map(matches.map(place => [place.qid, claimValues(place.entity, 'P131').map(value => value.id)]))
      for (let depth = 0; depth < 4; depth++) {
        for (const [qid, ancestors] of frontier) if (ancestors.some(id => cityIds.has(id))) proven.add(qid)
        if (proven.size) break
        const parents = [...new Set([...frontier.values()].flat())].filter(id => !cityIds.has(id)).slice(0, 50)
        if (!parents.length) break
        const entities = await this.entities(parents, { signal })
        frontier = new Map([...frontier].map(([qid, ancestors]) => [qid, [...new Set(ancestors.flatMap(id => claimValues(entities[id], 'P131').map(value => value.id)))]]))
      }
      if (proven.size) matches = matches.filter(row => proven.has(row.qid))
    }
    if (matches.length !== 1) return { status: matches.length > 1 ? 'ambiguous' : 'not-found', candidates: matches.map(row => row.qid), method: 'online' }
    return { status: 'resolved', place: matches[0], method: 'online' }
  }
  async location(input, options) {
    const result = await this.resolve(input, options)
    if (!result.place) return null
    const { latitude, longitude, source } = result.place
    return { latitude, longitude, source }
  }
  async media(raw, { signal, onEvidence = () => {} } = {}) {
    const identity = placeIdentity(raw)
    const budget = AbortSignal.timeout(17000)
    signal = signal ? AbortSignal.any([signal, budget]) : budget
    const result = await this.resolve(identity, { signal })
    if (!result.place) return null
    const place = result.place
    const entity = (await this.entities([place.qid], { signal }))[place.qid]
    if (!entity) return null
    const mediaNames = [identity.query, identity.name, variant(identity.query), ...(identity.city ? [`${identity.query}, ${identity.city}`, `${identity.query} (${identity.city})`] : [])]
    if (!mediaNames.some(name => exactEntityName(entity, name))) return null
    const linkedIdentity = { ...identity, qid: place.qid, query: entity.labels?.en?.value || place.label }
    const options = { http: this.http, signal }
    let failure
    for (const title of claimValues(entity, 'P18').filter(value => typeof value === 'string').slice(0, 2)) {
      try { const media = await commonsFile(title, linkedIdentity, options); if (media) { onEvidence({ qid: place.qid, method: 'P18', file: title }); return media } } catch (error) { failure = error }
    }
    try {
      const title = await this.wikipediaImage(entity, { signal })
      if (title) { const media = await commonsFile(title, linkedIdentity, options); if (media) { onEvidence({ qid: place.qid, method: 'Wikipedia main image', file: title }); return media } }
    } catch (error) { failure = error }
    try {
      const media = await queryCommons(linkedIdentity, { ...options, requireDepicts: true })
      if (media) { onEvidence({ qid: place.qid, method: 'Commons depicts', source: media.source.url }); return media }
    } catch (error) { failure = error }
    if (failure) throw failure
    return null
  }
  async wikipediaImage(entity, { signal } = {}) {
    const site = entity.sitelinks?.enwiki ? 'en' : entity.sitelinks?.zhwiki ? 'zh' : null
    if (!site) return null
    const title = entity.sitelinks[site + 'wiki'].title
    const token = await this.enterpriseToken?.()
    if (token) {
      try {
        const articles = await this.http.json(`https://api.enterprise.wikimedia.com/v2/structured-contents/${encodeURIComponent(title)}`, {
          signal, method: 'POST', headers: { authorization: 'Bearer ' + token },
          body: JSON.stringify({ filters: [{ field: 'is_part_of.identifier', value: site + 'wiki' }] }) })
        const article = Array.isArray(articles) && articles.find(article => article.main_entity?.identifier === entity.id && article.is_part_of?.identifier === site + 'wiki')
        if (article?.image?.content_url) {
          const url = new URL(article.image.content_url)
          if (url.protocol === 'https:' && url.hostname === 'upload.wikimedia.org' && /^\/wikipedia\/commons\/[0-9a-f]\/[0-9a-f]{2}\//.test(url.pathname)) return decodeURIComponent(url.pathname.split('/').at(-1))
        }
      } catch { /* Public, identity-checked Wikipedia is available without Enterprise credentials. */ }
    }
    const value = await this.http.json(actionUrl(`${site}.wikipedia.org`, { action: 'query', titles: title, redirects: '1', prop: 'pageprops|pageimages', piprop: 'name', pilicense: 'free' }), { signal })
    const pages = value.query?.pages || []
    const page = pages.find(page => page.pageprops?.wikibase_item === entity.id)
    return page?.pageimage || null
  }
}

let singleton
export function defaultPlaceResolver() { return singleton ??= new PlaceResolver() }
