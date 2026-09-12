type UnknownRecord = Record<string, unknown>

function record(value: unknown): UnknownRecord | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord : undefined
}

/** The legacy SerpApi adapter wrote false as a default, without baggage evidence.
 * Keep those snapshots intact while preventing readers from treating that value
 * as a provider-confirmed fact. The current adapter leaves this field absent. */
export function projectUnconfirmedFareFields(payload: unknown, schemaVersion: number): string[] {
  const root = record(payload)
  if (!root) return []
  const results = schemaVersion === 1 ? [{ result: root, path: '' }]
    : schemaVersion === 2 && Array.isArray(root.results)
      ? root.results.slice(0, 31).map((result, index) => ({ result: record(result), path: `/results/${index}` }))
      : []
  return results.flatMap(({ result, path }) => {
    if (result?.provider !== 'serpapi' || !Array.isArray(result.offers)) return []
    return result.offers.slice(0, 100).flatMap((offer, index) => record(offer)?.baggageRecheck === false
      ? [`${path}/offers/${index}/baggageRecheck`] : [])
  })
}
