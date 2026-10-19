import { WikimediaHttp, wikimediaHttp, actionUrl } from './wikimedia-http.mjs'
import { normalizePlaceName } from './geo-index.mjs'

const plain = value => String(value || '').replace(/<[^>]*>/g, ' ').replace(/&(?:amp|quot|lt|gt|nbsp);/g, ' ').replace(/\s+/g, ' ').trim()
const safeUrl = (value, host) => { try { const url = new URL(value); return url.protocol === 'https:' && url.hostname === host && !url.username && !url.password && !url.port ? url.href : null } catch { return null } }
const safeLicenseUrl = value => {
  try {
    const url = new URL(String(value || '').replace(/^\/\//, 'https://'))
    if (!['http:', 'https:'].includes(url.protocol) || !['creativecommons.org', 'commons.wikimedia.org'].includes(url.hostname)) return null
    url.protocol = 'https:'
    return safeUrl(url.href, url.hostname)
  } catch { return null }
}
const fileKey = title => String(title || '').replace(/^File:/i, '').replace(/_/g, ' ').normalize('NFC')

export function chooseCommonsPhoto(pages, identity, { trustedTitles = [], requireDepicts = false } = {}) {
  const tokens = normalizePlaceName(identity.query || identity.name).split(' ').filter(token => token.length > 1 && !['the', 'in', 'of', 'and', 'at'].includes(token))
  const trusted = new Set(trustedTitles.map(fileKey))
  const choices = []
  for (const page of pages || []) {
    const info = page.imageinfo?.[0], meta = info?.extmetadata || {}
    const title = normalizePlaceName(page.title?.replace(/^File:/, ''))
    const description = normalizePlaceName(meta.ImageDescription?.value)
    const exactFile = trusted.has(fileKey(page.title))
    if (!exactFile && (!tokens.length || !tokens.every(token => title.includes(token) || description.includes(token)))) continue
    if (!exactFile && requireDepicts && !(page.depicts || []).includes(identity.qid)) continue
    const src = safeUrl(info?.thumburl, 'upload.wikimedia.org') || safeUrl(info?.thumburl, 'thumb.wikimedia.org')
    const sourceUrl = safeUrl(info?.descriptionurl, 'commons.wikimedia.org')
    const license = plain(meta.LicenseShortName?.value)
    const licenseUrl = safeLicenseUrl(meta.LicenseUrl?.value)
    const author = plain(meta.Artist?.value)
    const free = /^(CC BY(?:-SA)? [\d.]+(?: [a-z]{2}(?:-[a-z]{2})?)?|CC0(?: [\d.]+)?|Public domain|PD)$/i.test(license)
    if (!src || !sourceUrl || !author || !free || (!licenseUrl && !/^(Public domain|PD)$/i.test(license))) continue
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(info.mime) || info.width < 600 || info.height < 350) continue
    if (meta.Restrictions?.value || /(?:non.?commercial|no.?derivatives)/i.test(license)) continue
    const ratio = info.width / info.height
    choices.push({ score: (exactFile ? 8 : 0) + (tokens.every(token => title.includes(token)) ? 4 : 0) + (ratio > 1.2 && ratio < 2.2 ? 2 : 0), media: {
      src, description: identity.name, author, license, licenseUrl: licenseUrl || sourceUrl,
      source: { label: 'Wikimedia Commons', url: sourceUrl, status: 'unverified' }
    } })
  }
  return choices.sort((a, b) => b.score - a.score)[0]?.media || null
}

const imageParameters = { action: 'query', prop: 'imageinfo', iiprop: 'url|mime|size|extmetadata', iiurlwidth: '960',
  iiextmetadatafilter: 'Artist|LicenseShortName|LicenseUrl|ImageDescription|Restrictions' }
export async function commonsFile(title, identity, { http = wikimediaHttp, signal } = {}) {
  if (typeof title !== 'string' || title.length > 250 || /[|\n\r]/.test(title)) return null
  const file = 'File:' + fileKey(title)
  const value = await http.json(actionUrl('commons.wikimedia.org', { ...imageParameters, titles: file, redirects: '1' }), { signal })
  const pages = value.query?.pages || []
  const redirects = (value.query?.redirects || []).filter(item => fileKey(item.from) === fileKey(file)).map(item => item.to)
  return chooseCommonsPhoto(pages, identity, { trustedTitles: [file, ...redirects] })
}

export async function queryCommons(identity, { request, http = request ? new WikimediaHttp({ request, root: null, intervalMs: 0 }) : wikimediaHttp, signal, requireDepicts = false } = {}) {
  const value = await http.json(actionUrl('commons.wikimedia.org', { ...imageParameters, generator: 'search',
    gsrsearch: `"${identity.query}" ${identity.city ? `"${identity.city}"` : ''} filetype:bitmap`, gsrnamespace: '6', gsrlimit: '8' }), { signal })
  const pages = value.query?.pages || []
  if (requireDepicts && pages.length) {
    const ids = pages.filter(page => Number.isInteger(page.pageid)).map(page => 'M' + page.pageid)
    if (!ids.length) return null
    const entities = await http.json(actionUrl('commons.wikimedia.org', { action: 'wbgetentities', ids: ids.join('|'), props: 'claims' }), { signal })
    for (const page of pages) page.depicts = (entities.entities?.['M' + page.pageid]?.statements?.P180 || entities.entities?.['M' + page.pageid]?.claims?.P180 || [])
      .filter(claim => claim.rank !== 'deprecated').map(claim => claim.mainsnak?.datavalue?.value?.id)
  }
  return chooseCommonsPhoto(pages, identity, { requireDepicts })
}
