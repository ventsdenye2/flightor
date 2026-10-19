import { defaultPlaceResolver, PlaceResolver, placeIdentity } from './place-resolver.mjs'
import { WikimediaHttp } from './wikimedia-http.mjs'
import { cachedPlace } from './place-cache.mjs'
export { entityLocation } from './wikidata-entity.mjs'

export function locationIdentity(input) {
  const identity = placeIdentity(input)
  if (!identity.city && !identity.qid) throw Error('需要景点所在城市')
  return identity
}
export async function queryPlaceLocation(identity, { request, resolver } = {}) {
  resolver ??= request ? new PlaceResolver({ index: null, enrichment: null, http: new WikimediaHttp({ request, root: null, intervalMs: 0 }) }) : defaultPlaceResolver()
  return resolver.location(identity)
}
export async function loadPlaceLocation(input, { lookup = queryPlaceLocation, ...options } = {}) {
  return cachedPlace('place-locations', locationIdentity(input), lookup, options)
}
