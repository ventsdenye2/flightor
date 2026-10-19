import { defaultPlaceResolver, placeIdentity } from './place-resolver.mjs'
import { cachedPlace } from './place-cache.mjs'
export { chooseCommonsPhoto, queryCommons } from './commons-media.mjs'
export const mediaIdentity = placeIdentity
export async function loadPlaceMedia(input, { lookup = identity => defaultPlaceResolver().media(identity), ...options } = {}) {
  return cachedPlace('place-media', mediaIdentity(input), lookup, options)
}
