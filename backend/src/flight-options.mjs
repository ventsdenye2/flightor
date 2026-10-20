import fs from 'node:fs/promises'
import path from 'node:path'

// Publish only travel facts, never raw tool messages or local evidence paths.
function presentJourney(item) {
  return {
    direction: item.direction,
    airlines: item.airlines || [], departureAirport: item.departureAirport || null, arrivalAirport: item.arrivalAirport || null,
    departureLocal: item.departureLocal || null, arrivalLocal: item.arrivalLocal || null,
    durationMinutes: item.durationMinutes ?? null, stopCount: item.stopCount ?? null,
    segments: (item.details?.segments || []).map(({ airline, flightNumber, origin, destination, departureLocal, arrivalLocal, durationMinutes, cabin, stops }) => ({ airline, flightNumber, origin, destination, departureLocal, arrivalLocal, durationMinutes, cabin, ...(Array.isArray(stops) ? { stops: stops.map(({ city, durationMinutes }) => ({ city, durationMinutes })) } : {}) })),
    connections: (item.details?.connections || []).map(({ city, durationMinutes, selfTransfer, airportChange, collectAndRecheckBaggage }) => ({ city, durationMinutes, selfTransfer, airportChange, collectAndRecheckBaggage })),
    baggage: item.details?.baggage || null
  }
}
export function presentFlightOptions(result) {
  if (!result || result.source !== 'Trip.com' || !Array.isArray(result.candidates) || !result.query || !result.searchId) return null
  return {
    searchId: result.searchId, source: 'Trip.com', sourceUrl: result.sourceUrl?.startsWith('https://') ? result.sourceUrl : null,
    observedAt: result.observedAt, status: result.status,
    origin: result.query.origin, destination: result.query.destination, date: result.query.departureDate,
    tripType: result.query.tripType || 'one_way', returnDate: result.query.returnDate || null,
    originName: result.resolved?.origin?.name || result.query.origin, destinationName: result.resolved?.destination?.name || result.query.destination,
    adults: result.query.adults || 1, cabin: result.query.cabin || 'economy',
    options: result.candidates.map(item => ({
      ...(Array.isArray(item.journeys) ? { journeys: item.journeys.map(presentJourney) } : {}),
      id: item.id, airlines: item.airlines || [], amount: item.price?.amount ?? null, currency: item.price?.currency || result.query.currency,
      departureAirport: item.departureAirport || null, arrivalAirport: item.arrivalAirport || null,
      departureLocal: item.departureLocal || null, arrivalLocal: item.arrivalLocal || null,
      durationMinutes: item.durationMinutes ?? null, stopCount: item.stopCount ?? null,
      segments: (item.details?.segments || []).map(({ airline, flightNumber, origin, destination, departureLocal, arrivalLocal, durationMinutes, cabin, stops }) => ({ airline, flightNumber, origin, destination, departureLocal, arrivalLocal, durationMinutes, cabin, ...(Array.isArray(stops) ? { stops: stops.map(({ city, durationMinutes }) => ({ city, durationMinutes })) } : {}) })),
      connections: (item.details?.connections || []).map(({ city, durationMinutes, selfTransfer, airportChange, collectAndRecheckBaggage }) => ({ city, durationMinutes, selfTransfer, airportChange, collectAndRecheckBaggage })),
      baggage: item.details?.baggage || null
    }))
  }
}

export async function flightOptionsFromEvidence(evidence, root) {
  const found = new Map(), references = new Set()
  function visit(value, depth = 0) {
    if (!value || depth > 12) return
    if (typeof value === 'string') { try { visit(JSON.parse(value), depth + 1) } catch {} return }
    if (typeof value !== 'object') return
    if (/^[a-f\d-]{36}$/i.test(value.searchId || '')) {
      references.add(value.searchId)
      const options = presentFlightOptions(value)
      if (options) found.set(options.searchId, options)
    }
    for (const child of Object.values(value)) visit(child, depth + 1)
  }
  visit(evidence)
  for (const id of references) {
    try { const options = presentFlightOptions(JSON.parse(await fs.readFile(path.join(root, 'flight-results', id + '.json'), 'utf8'))); if (options) found.set(id, options) } catch {}
  }
  return [...found.values()].sort((a, b) => String(a.observedAt).localeCompare(String(b.observedAt))).at(-1) || null
}

export function resolveFlightSelection(conversation, selection) {
  if (!selection) return null
  const result = conversation.flightOptions
  const option = result?.searchId === selection.searchId && result.options.find(item => item.id === selection.candidateId)
  if (!option) throw Error('这条航班已不在当前查询结果中，请重新选择')
  return { searchId: result.searchId, candidateId: option.id }
}
