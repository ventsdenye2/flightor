import * as journey from '../route-plans/journey.js'
import type { RoutePick } from '../route-plans/engine.js'
import type { TripState } from './schema.js'

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function normalize(value: unknown): RoutePick[] {
  const source = isRecord(value) ? value.routes ?? value.picks ?? value.results : value
  return Array.isArray(source) ? source as RoutePick[] : []
}

/**
 * Route generation is intentionally a single server-side call.  It is kept
 * behind this adapter so the conversation agent never manufactures a flight,
 * fare or route itself and so a planner implementation can evolve without
 * changing the public conversation protocol.
 */
export function buildJourneyInput(state: TripState): journey.JourneyPlanInput {
  const from = state.window_from!
  const dateFrom = new Date(`${from}T00:00:00Z`)
  const derivedTo = new Date(dateFrom.getTime())
  derivedTo.setUTCDate(derivedTo.getUTCDate() + Math.max(0, state.travel_days! - 1))
  const defaultWindowTo = derivedTo.toISOString().slice(0, 10)
  const windowTo = state.window_to && state.window_to > from ? state.window_to : defaultWindowTo
  return {
    origin: state.origin!,
    windowFrom: from,
    windowTo,
    travelDays: state.travel_days!,
    regions: state.regions,
    requiredIatas: state.required_iatas,
    excludedIatas: state.excluded_iatas,
    interests: state.interests,
    budgetMax: state.budget_max,
    cityTarget: state.pace === 'many_cities' ? Math.max(2, Math.min(6, state.travel_days! - 1)) : null,
    overnightPref: false,
    // "少中转" is a soft preference.  JourneyPlanInput currently has no
    // explicit soft-preference field, so never turn it into a hard nonstop
    // constraint and accidentally discard viable routes.
    directOnly: false
  }
}

export async function planFromJourney(state: TripState): Promise<RoutePick[]> {
  const planner = journey.planJourney as unknown as (...args: unknown[]) => unknown
  const input = buildJourneyInput(state)
  const result = await Promise.resolve(planner(input))
  return normalize(result).slice(0, 3)
}
