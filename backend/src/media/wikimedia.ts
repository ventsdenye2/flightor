import type { MediaProvider, MediaResult, MediaTarget, PlacePhoto } from './types.js'
import { unresolvedReason } from '../places/nominatim.js'

export type MediaRead = (url: string, kind: 'json' | 'image', signal: AbortSignal) => Promise<Buffer>
const normalize = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[\s_\p{P}\p{S}]/gu, '')
const plain = (s: unknown) => String(s ?? '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').trim().slice(0, 600)
const wikiSource = (value: string) => {
  try { const u = new URL(value); return u.protocol === 'https:' && /^(en|ja|zh)\.wikipedia\.org$/.test(u.hostname) && u.pathname.startsWith('/wiki/') && !u.username && !u.password ? u : undefined } catch { return undefined }
}
export function imageSignature(bytes: Buffer): boolean {
  return bytes.length > 12 && (bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255])) || bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || bytes.toString('ascii',0,4)==='RIFF' && bytes.toString('ascii',8,12)==='WEBP')
}
/** One exact entity path. No open image search, generated URLs, or geocoding. */
export class WikimediaMediaProvider implements MediaProvider {
  constructor(private readonly read: MediaRead) {}
  async search(target: MediaTarget, signal: AbortSignal): Promise<MediaResult> {
    const result = (reason: string, photos: PlacePhoto[] = []): MediaResult => ({ status: photos.length ? 'ready' : 'empty', reason, photos, checkedAt: new Date().toISOString() })
    const { hint, place } = target
    if (target.blocked || unresolvedReason(hint) || hint.scope === 'city' || place && !['venue','park','district','street'].includes(place.kind)) return result('ambiguous_or_unsupported')
    const sources = hint.sourceUrls.map(wikiSource).filter((s): s is URL => !!s)
    const unique = [...new Map(sources.map(u => [u.href, u])).values()]
    if (unique.length > 1) return result('multiple_entities')
    if (!place && unique.length !== 1) return result('source_identity_required')
    const names = [...new Set([place?.name, ...(place?.aliases ?? []), hint.name, ...hint.aliases].filter((s): s is string => !!s))]
    // At most one request per language, using exact titles (never the first search hit).
    const lookups = unique.length ? [{ host: unique[0]!.hostname, titles: decodeURIComponent(unique[0]!.pathname.slice(6)) }]
      : ['en','ja','zh'].map(lang => ({ host: `${lang}.wikipedia.org`, titles: names.slice(0, 6).join('|') }))
    for (const lookup of lookups) {
      signal.throwIfAborted()
      const url = new URL(`https://${lookup.host}/w/api.php`)
      url.search = new URLSearchParams({ action:'query', format:'json', formatversion:'2', redirects:'1', titles:lookup.titles, prop:'pageimages|coordinates|pageprops|info', piprop:'name', pilicense:'free', inprop:'url', colimit:'1' }).toString()
      const data = JSON.parse((await this.read(url.href, 'json', signal)).toString())
      const pages = (data.query?.pages ?? []).filter((p: any) => !p.missing && p.pageimage && p.pageprops?.disambiguation === undefined)
      const matched = pages.filter((p: any) => {
        if (!names.some(n => normalize(n) === normalize(p.title))) return false
        if (unique.length && !place) return true // exact original source + title; no invented POI identity
        const c = p.coordinates?.[0]
        if (!c || !place || c.globe !== 'earth') return false
        // Small venue/park footprint; never substitute a city or a distant namesake.
        const dy = (c.lat - place.coordinates.latitude) * 111.2
        const dx = (c.lon - place.coordinates.longitude) * 111.2 * Math.cos(c.lat * Math.PI / 180)
        return Math.hypot(dx,dy) < 1.5
      })
      if (matched.length > 1) return result('ambiguous_entity')
      if (!matched.length) continue
      const page = matched[0]
      const infoUrl = new URL('https://commons.wikimedia.org/w/api.php')
      infoUrl.search = new URLSearchParams({ action:'query', format:'json', formatversion:'2', titles:`File:${page.pageimage}`, prop:'imageinfo', iiprop:'url|size|mime|extmetadata', iiurlwidth:'960', iiextmetadatalanguage:'en' }).toString()
      const info = JSON.parse((await this.read(infoUrl.href,'json',signal)).toString()).query?.pages?.[0]?.imageinfo?.[0]
      if (!info) return result('no_commons_file')
      const meta = info.extmetadata ?? {}, license = plain(meta.LicenseShortName?.value), author = plain(meta.Artist?.value)
      const licenseUrl = plain(meta.LicenseUrl?.value)
      if (!/^(CC BY(?:-SA)? [234]\.0|CC0(?: 1\.0)?|Public domain)$/i.test(license) || !author || !/^https:\/\/(creativecommons\.org|commons\.wikimedia\.org)\//.test(licenseUrl)) return result('license_not_supported')
      if (meta.Restrictions?.value || !['image/jpeg','image/png','image/webp'].includes(info.mime)) return result('restricted_or_not_photo')
      const src = info.thumburl
      if (typeof src !== 'string' || !/^https:\/\/(upload|thumb)\.wikimedia\.org\//.test(src) || !String(info.descriptionurl).startsWith('https://commons.wikimedia.org/wiki/File:')) return result('invalid_source_url')
      const bytes = await this.read(src,'image',signal)
      if (!imageSignature(bytes)) return result('invalid_image_bytes')
      return result('entity_photo', [{ src, title: plain(page.pageimage), width:info.thumbwidth, height:info.thumbheight,
        source:{ label:`${author} · ${license}`, url:info.descriptionurl, author, license, licenseUrl },
        entityUrl:page.fullurl, ...(place ? {placeId:place.placeId}:{}), association:place?'resolved_place':'source_activity', retrievedAt:new Date().toISOString() }])
    }
    return result('no_exact_entity_photo')
  }
}
