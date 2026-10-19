import { placeIdentity } from './place-resolver.mjs'
import { defaultPlaceLookup } from './place-lookup.mjs'
import { cachedPlace } from './place-cache.mjs'
export { chooseCommonsPhoto, queryCommons } from './commons-media.mjs'
export const mediaIdentity = placeIdentity
export async function loadPlaceMedia(input, { lookup, ...options } = {}) {
  const identity = mediaIdentity(input)
  if (lookup) return cachedPlace('place-media', identity, lookup, options)
  const result = (await defaultPlaceLookup().lookup(identity, { fields: ['image'], signal: AbortSignal.timeout(17000) })).image
  return { media: result.value || null, status: result.status === 'found' ? 'ready' : result.status }
}
