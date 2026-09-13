import { AppError } from '../lib/errors.js'
import type { TripContext } from './types.js'

type TripDates = Pick<TripContext, 'departureWindow' | 'returnWindow' | 'travelDays'>
const DAY_MS = 86_400_000
const ordinal = (date: string) => Date.parse(`${date}T00:00:00Z`) / DAY_MS
const firstDate = (window: TripDates['departureWindow']) => window?.from ?? (window?.precision === 'exact' ? window.to : undefined)
const lastDate = (window: TripDates['departureWindow']) => window?.to ?? (window?.precision === 'exact' ? window.from : undefined)
const lower = (window: TripDates['departureWindow']) => firstDate(window) ? ordinal(firstDate(window)!) : -Infinity
const upper = (window: TripDates['departureWindow']) => lastDate(window) ? ordinal(lastDate(window)!) : Infinity

/** A window bounds possible dates; neither endpoint is an exclusive checkout date. */
export function tripDatesConsistent(trip: TripDates): boolean {
  const departure = trip.departureWindow
  const returning = trip.returnWindow
  if ([departure, returning].some(window => window?.precision === 'exact' && window.from && window.to && window.from !== window.to)) return false
  const first = lower(departure)
  const last = upper(departure)
  const returnFirst = lower(returning)
  const returnLast = upper(returning)
  if (first > last || returnFirst > returnLast) return false
  if (trip.travelDays === undefined) return first <= returnLast
  const offset = trip.travelDays - 1
  return Math.max(first, returnFirst - offset) <= Math.min(last, returnLast - offset)
}

export function assertTripDatesConsistent(trip: TripDates): void {
  if (!tripDatesConsistent(trip)) {
    throw new AppError('TRIP_DATES_INCONSISTENT',
      'Exact windows identify one date, not the whole trip. Departure, return and travelDays must describe one inclusive calendar span. Correct conflicting fields together; do not add a checkout day.',
      409, { fields: ['departureWindow', 'returnWindow', 'travelDays'], counting: 'inclusive_calendar_days' })
  }
}

/** Derived planning/verification constraint only; never writes a missing Trip field. */
export function tripDurationDays(trip: TripDates): number | undefined {
  assertTripDatesConsistent(trip)
  if (trip.travelDays !== undefined) return trip.travelDays
  const first = lower(trip.departureWindow)
  const last = upper(trip.returnWindow)
  if (Number.isFinite(first) && Number.isFinite(last)
    && first === upper(trip.departureWindow) && last === lower(trip.returnWindow)) return last - first + 1
  return undefined
}

/** Conservative research coverage, without creating missing Trip facts. */
export function tripTravelWindow(trip: TripDates): { from?: string; to?: string } | undefined {
  assertTripDatesConsistent(trip)
  const offset = trip.travelDays === undefined ? undefined : trip.travelDays - 1
  // Intersect possible starts with the return bounds shifted by the duration.
  // A one-sided lower bound must never become an invented upper bound.
  const first = offset === undefined ? lower(trip.departureWindow)
    : Math.max(lower(trip.departureWindow), lower(trip.returnWindow) - offset)
  const last = offset === undefined ? upper(trip.returnWindow)
    : Math.min(upper(trip.departureWindow) + offset, upper(trip.returnWindow))
  const iso = (day: number) => Number.isFinite(day) ? new Date(day * DAY_MS).toISOString().slice(0, 10) : undefined
  const from = iso(first)
  const to = iso(last)
  return from || to ? { ...(from ? { from } : {}), ...(to ? { to } : {}) } : undefined
}
