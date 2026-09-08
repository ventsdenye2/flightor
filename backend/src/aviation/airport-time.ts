import { z } from 'zod'

export const airportTimeViewSchema = z.object({
  basis: z.enum(['airport_local', 'utc', 'provider_local', 'unavailable']),
  display: z.string().min(1).max(200),
  instant: z.string().max(64).optional(),
  localDateTime: z.string().max(64).optional(),
  timezone: z.string().min(1).max(80).optional(),
  offset: z.string().regex(/^[+-]\d{2}:\d{2}$/).optional(),
  airportIata: z.string().regex(/^[A-Z]{3}$/).optional()
}).strict()
export type AirportTimeView = z.infer<typeof airportTimeViewSchema>

const instantPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/
const localPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/

function localDateTime(value: string): string | undefined {
  if (!localPattern.test(value)) return undefined
  const normalized = value.length === 16 ? `${value}:00` : value
  const timestamp = Date.parse(`${normalized}Z`)
  // Date.parse normalizes some impossible calendar dates; reject those too.
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 19) === normalized
    ? normalized : undefined
}

function knownTimezone(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0 || value.length > 80) return undefined
  try {
    return new Intl.DateTimeFormat('en', { timeZone: value }).resolvedOptions().timeZone
  } catch { return undefined }
}

function formatAt(timestamp: number, timezone: string): { local: string; offset: string } {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  })
  const parts = Object.fromEntries(formatter.formatToParts(timestamp).map(part => [part.type, part.value]))
  const local = `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`
  const offsetMinutes = Math.round((Date.parse(`${local}Z`) - Math.floor(timestamp / 1_000) * 1_000) / 60_000)
  const absolute = Math.abs(offsetMinutes)
  const offset = `${offsetMinutes < 0 ? '-' : '+'}${String(Math.floor(absolute / 60)).padStart(2, '0')}:${String(absolute % 60).padStart(2, '0')}`
  return { local, offset }
}

function clockLabel(value: string): string { return value.slice(0, 16).replace('T', ' ') }

/** A display projection only. It never changes the instant used by route arithmetic
 * and never substitutes the machine timezone or guesses an airport timezone. */
export function projectAirportTime(
  value: unknown,
  options: { timezone?: unknown; airportIata?: unknown; providerLocal?: boolean } = {}
): AirportTimeView {
  const airportIata = typeof options.airportIata === 'string' && /^[A-Z]{3}$/.test(options.airportIata)
    ? options.airportIata : undefined
  const airport = airportIata ? { airportIata } : {}
  const normalized = typeof value === 'string' && value.length <= 64 ? value.trim().replace(' ', 'T') : ''
  const timezone = knownTimezone(options.timezone)
  const clock = normalized.replace(/(?:Z|[+-]\d{2}:\d{2})$/, '').replace(/\.\d+$/, '')
  const timestamp = instantPattern.test(normalized) && localDateTime(clock) ? Date.parse(normalized) : Number.NaN
  if (Number.isFinite(timestamp)) {
    const instant = new Date(timestamp).toISOString()
    if (timezone) {
      const formatted = formatAt(timestamp, timezone)
      return airportTimeViewSchema.parse({
        basis: 'airport_local', display: `${clockLabel(formatted.local)} (${timezone}, UTC${formatted.offset})`,
        instant, localDateTime: formatted.local, timezone, offset: formatted.offset, ...airport
      })
    }
    return airportTimeViewSchema.parse({
      basis: 'utc', display: `${clockLabel(instant)} (UTC; airport timezone unavailable)`,
      instant, timezone: 'UTC', offset: '+00:00', ...airport
    })
  }
  const local = options.providerLocal ? localDateTime(normalized) : undefined
  if (local) {
    return airportTimeViewSchema.parse({
      basis: 'provider_local',
      display: `${clockLabel(local)} (${timezone ? `${timezone}; UTC offset unavailable` : 'provider local; timezone unavailable'})`,
      localDateTime: local, ...(timezone ? { timezone } : {}), ...airport
    })
  }
  return { basis: 'unavailable', display: 'Time unavailable', ...airport }
}
