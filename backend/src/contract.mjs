// MVP只适配展示结构，不做业务验收或审核否决。
const array = value => Array.isArray(value) ? value : []
const text = (value, fallback = '') => typeof value === 'string' ? value : fallback
// Legacy reader for saved/manual text. The live reviewer submits through submit_itinerary.
export function parseReview(value) {
  try {
    const parsed = JSON.parse(value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''))
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
  } catch {}
  return { title: '旅行规划', overview: text(value), days: [] }
}
export function toPresentation(candidate, id, flightResult) {
  const days = array(candidate.days).map(day => ({ ...(day || {}), activities: array(day?.activities).filter(a => a && typeof a === 'object') }))
  const sources = [...new Map(days.flatMap(d => d.activities.flatMap(a => array(a.sources))).filter(s => typeof s?.url === 'string' && /^https?:\/\//i.test(s.url)).map(s => [s.url, { label: text(s.label, s.url), url: s.url, status: 'unverified' }])).values()]
  const selection = candidate.flightSelection
  const flight = selection && flightResult?.searchId === selection.searchId ? flightResult.candidates?.find(c => c.id === selection.candidateId) : null
  const journeys = flight?.journeys?.length ? flight.journeys : flight ? [flight] : []
  const flights = journeys.map((journey, index) => ({
    id: `${flight.id}-${index}`, title: flight.journeys ? index === 0 ? '去程航班 · 往返组合' : '返程航班 · 往返组合' : '查询航班', dateLabel: journey.departureLocal?.slice(0, 10) || flightResult.query.departureDate,
    priceIncluded: !!flight.journeys && index > 0,
    legs: (journey.details?.segments?.length ? journey.details.segments : [{ origin: journey.departureAirport, destination: journey.arrivalAirport, departureLocal: journey.departureLocal, arrivalLocal: journey.arrivalLocal, durationMinutes: journey.durationMinutes, airline: (journey.airlines || flight.airlines).join(' / ') }]).map(s => ({ from: s.origin, to: s.destination, fromCode: s.origin, toCode: s.destination, depart: s.departureLocal, arrive: s.arrivalLocal, duration: s.durationMinutes == null ? null : `${s.durationMinutes} 分钟`, carrier: s.airline || s.flightNumber || '航司待确认' })),
    price: { amount: index === 0 ? flight.price.amount : null, currency: flight.price.currency, unit: 'person', status: 'quote', source: { label: `Trip.com · ${flightResult.observedAt}`, url: flightResult.sourceUrl, status: 'unverified' } }, airlineLabel: (journey.airlines || flight.airlines).join(' / '), warning: `${flight.journeys ? index === 0 ? '价格为整组往返合计。' : '包含在去程卡片所示的往返合计中；不重复计价。' : ''}查询时间：${flightResult.observedAt}。${Date.now() - Date.parse(flightResult.observedAt) > 300000 ? '历史查询快照，需重新查价。' : 'Trip.com 查询快照。'}未到结算页核价；行李与自转机以详情为准`, source: { label: `Trip.com · ${flightResult.observedAt}`, url: flightResult.sourceUrl, status: 'unverified' }
  }))
  return { id: 'live-' + id, provenance: 'dsh', title: text(candidate.title, '旅行规划'), destination: text(candidate.destination), description: text(candidate.overview),
    highlights: array(candidate.highlights).map(item => ({ title: text(item?.title), description: text(item?.description) })).filter(item => item.title && item.description),
    travelNotes: array(candidate.issues).map(item => text(item?.detail)).filter(Boolean),
    route: [text(candidate.destination)], dates: { start: text(candidate.startDate) || null, end: text(candidate.endDate) || null, label: '' }, durationDays: days.length, travelers: Number(candidate.travelers) || 1, cover: null, status: 'ready', flights, alternatives: [], sources,
    days: days.map((day, index) => ({ id: text(day.date, `day-${index + 1}`), label: `D${index + 1}`, title: text(day.theme, '当日安排'), subtitle: text(day.date, '相对日期'), status: 'ready', activities: day.activities.map((a, n) => ({ id: `${id}-d${index + 1}-a${n + 1}`, lookupId: text(a.id), name: text(a.name, '活动安排'), time: text(a.time) || null, until: text(a.until) || null, category: text(a.category, '游览'), summary: text(a.description),
      introduction: text(a.introduction), recommendationReason: text(a.recommendationReason), visitNotes: text(a.visitNotes), imageQuery: a.imageQuery === null ? null : text(a.imageQuery) || undefined, area: text(a.city),
      latitude: Number.isFinite(a.latitude) ? a.latitude : null, longitude: Number.isFinite(a.longitude) ? a.longitude : null, media: null, source: sources.find(s => s.url === array(a.sources)[0]?.url) || null })) })) }
}
