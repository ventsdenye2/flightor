import { normalizePlaceName, validPoint } from './geo-index.mjs'

export function claimValues(entity, property) {
  const claims = (entity?.claims?.[property] || []).filter(claim => claim.rank !== 'deprecated')
  const preferred = claims.some(claim => claim.rank === 'preferred') ? claims.filter(claim => claim.rank === 'preferred') : claims
  return preferred.map(claim => claim.mainsnak?.datavalue?.value).filter(value => value != null)
}
export function entityLocation(entity, { maxPrecision = .01 } = {}) {
  if (!/^Q[1-9]\d*$/.test(entity?.id || '')) return null
  const points = claimValues(entity, 'P625').filter(point => validPoint(point) && point.globe === 'http://www.wikidata.org/entity/Q2' && (point.precision == null || point.precision <= maxPrecision))
  if (!points.length || points.some(point => Math.abs(point.latitude - points[0].latitude) > .002 || Math.abs(point.longitude - points[0].longitude) > .002)) return null
  return { latitude: points[0].latitude, longitude: points[0].longitude,
    source: { label: 'Wikidata', url: `https://www.wikidata.org/wiki/${entity.id}`, status: 'unverified' } }
}
export function entityNames(entity) {
  return [...new Set([...Object.values(entity?.labels || {}).map(value => value.value), ...Object.values(entity?.aliases || {}).flat().map(value => value.value), ...Object.values(entity?.sitelinks || {}).map(value => value.title)].filter(Boolean))]
}
export function exactEntityName(entity, name) { return entityNames(entity).some(value => normalizePlaceName(value) === normalizePlaceName(name)) }
export function entityPlace(entity, local, { allowCoarse = false } = {}) {
  const types = claimValues(entity, 'P31').map(value => value.id)
  if (types.some(type => ['Q5', 'Q4167410', 'Q3305213', 'Q13442814', 'Q16521'].includes(type))) return null
  const current = entityLocation(entity, { maxPrecision: allowCoarse ? 1 : .01 })
  const location = entity?.claims?.P625?.length && !current ? null : local || current
  if (!location) return null
  return { ...local, ...location, qid: entity.id, label: entity.labels?.en?.value || entityNames(entity)[0] || entity.id,
    precision: local?.precision ?? claimValues(entity, 'P625')[0]?.precision,
    description: entity.descriptions?.en?.value || '', names: entityNames(entity), entity }
}

/** Enterprise's documented entity model differs from the MediaWiki claims model. */
export function fromEnterpriseEntity(value) {
  const entity = value?.entity
  if (!/^Q[1-9]\d*$/.test(entity?.identifier || '') || !entity.statements || entity.type !== 'item') return null
  const text = values => Object.fromEntries(Object.entries(values || {}).filter(([, value]) => typeof value === 'string').map(([language, value]) => [language, { language, value }]))
  const claims = {}
  for (const [property, statements] of Object.entries(entity.statements)) {
    if (!/^P\d+$/.test(property) || !Array.isArray(statements)) continue
    claims[property] = statements.map(statement => {
      const value = statement.value
      let converted = value?.content
      if (value?.type === 'wikibase-item') converted = /^Q[1-9]\d*$/.test(value.content || '') ? { id: value.content } : null
      if (value?.type === 'globe-coordinate') {
        const data = value.content_data || {}
        converted = { latitude: Number(data.latitude), longitude: Number(data.longitude), globe: data.globe,
          precision: data.precision != null && String(data.precision).trim() && Number.isFinite(Number(data.precision)) ? Number(data.precision) : undefined }
      }
      return { rank: statement.rank, mainsnak: converted == null ? {} : { datavalue: { value: converted } } }
    })
  }
  const aliases = Object.fromEntries(Object.entries(entity.aliases || {}).filter(([, values]) => Array.isArray(values)).map(([language, values]) => [language, values.filter(value => typeof value === 'string').map(value => ({ language, value }))]))
  return { id: entity.identifier, type: 'item', labels: text(entity.labels), descriptions: text(entity.descriptions), aliases, claims, sitelinks: entity.sitelinks || {} }
}
