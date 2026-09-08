/** Server-owned airport clock projection. Raw instants remain the calculation authority. */
export interface AirportTimeView {
  basis: 'airport_local' | 'utc' | 'provider_local' | 'unavailable'
  display: string
  instant?: string
  localDateTime?: string
  timezone?: string
  offset?: string
  airportIata?: string
}
export interface AirportTimePresentation {
  schemaVersion: 1
  airportTimes: Record<string, AirportTimeView>
  truncated: boolean
}

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= max

/** Invalid or newer presentation falls back safely without discarding the immutable result. */
export function readAirportTimePresentation(value: unknown): AirportTimePresentation | undefined {
  if (!record(value) || value.schemaVersion !== 1 || typeof value.truncated !== 'boolean' || !record(value.airportTimes)) return
  const entries = Object.entries(value.airportTimes)
  if (entries.length > 8192) return
  const airportTimes: Record<string, AirportTimeView> = {}
  for (const [pointer, view] of entries) {
    if (!text(pointer, 512) || !pointer.startsWith('/') || !record(view)
      || !['airport_local', 'utc', 'provider_local', 'unavailable'].includes(String(view.basis)) || !text(view.display, 200)
      || (view.instant !== undefined && !text(view.instant, 64))
      || (view.localDateTime !== undefined && !text(view.localDateTime, 64))
      || (view.timezone !== undefined && !text(view.timezone, 80))
      || (view.offset !== undefined && (typeof view.offset !== 'string' || !/^[+-]\d{2}:\d{2}$/.test(view.offset)))
      || (view.airportIata !== undefined && (typeof view.airportIata !== 'string' || !/^[A-Z]{3}$/.test(view.airportIata)))) return
    airportTimes[pointer] = {
      basis: view.basis as AirportTimeView['basis'], display: view.display,
      ...(view.instant === undefined ? {} : { instant: view.instant as string }),
      ...(view.localDateTime === undefined ? {} : { localDateTime: view.localDateTime as string }),
      ...(view.timezone === undefined ? {} : { timezone: view.timezone as string }),
      ...(view.offset === undefined ? {} : { offset: view.offset as string }),
      ...(view.airportIata === undefined ? {} : { airportIata: view.airportIata as string })
    }
  }
  return { schemaVersion: 1, airportTimes, truncated: value.truncated }
}

/** Never use the device timezone as an airport timezone, including legacy/cached results. */
export function airportTimeDisplay(raw: unknown, presentation?: AirportTimePresentation, pointer?: string): string {
  const projected = pointer ? presentation?.airportTimes[pointer] : undefined
  if (projected) return projected.display
  if (!text(raw, 64)) return '时间未提供'
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/i.test(raw)) {
    const instant = new Date(raw)
    if (Number.isFinite(instant.getTime())) return `${instant.toISOString().slice(0, 16).replace('T', ' ')} (UTC; airport timezone unavailable)`
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(raw)) {
    return `${raw.slice(0, 16).replace('T', ' ')} (provider local; timezone unavailable)`
  }
  return '时间未提供'
}
