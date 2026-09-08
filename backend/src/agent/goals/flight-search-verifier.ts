import type { ArtifactRecord } from '../../artifacts/repository.js'
import type { LocationRef } from '../../aviation/types.js'
import { flightSearchArtifactSchema, type FareSearchResult } from '../../fares/types.js'
import { flexibleFlightSearchArtifactSchema } from '../../fares/search-service.js'
import { airportExactIdentity, cityGroupingCode } from '../../locations/identity.js'
import { CURATED_LOCATION_IDENTITY_POLICY } from '../../locations/curated-directory.js'
import { flightSearchGoalParametersSchema, type GoalRecord } from './types.js'
import type { GoalVerification, GoalVerificationContext, GoalVerifier } from './verifier.js'
import { currentContextFailure, currentEvidenceStatus, goalArtifacts, selectVerification, verificationResult } from './artifact-verification.js'

function matchesAirport(code: string, location: LocationRef): boolean {
  return location.type === 'airport'
    ? airportExactIdentity(location) === `airport:${code}`
    : cityGroupingCode(location, CURATED_LOCATION_IDENTITY_POLICY) === cityGroupingCode(code, CURATED_LOCATION_IDENTITY_POLICY)
}

function withinWindow(date: string, window: { from?: string | undefined; to?: string | undefined } | undefined): boolean {
  return (!window?.from || date >= window.from) && (!window?.to || date <= window.to)
}

function queryMissing(query: FareSearchResult['query'], goal: GoalRecord, context: GoalVerificationContext): string[] {
  const parameters = flightSearchGoalParametersSchema.parse(goal.parameters)
  const trip = context.run.contextSnapshot
  const missing: string[] = []
  if (trip.origin && !matchesAirport(query.origin, trip.origin)) missing.push('flight_origin')
  if (trip.destinationIntent.required.length > 0 && !trip.destinationIntent.required.some(location => matchesAirport(query.destination, location))) missing.push('flight_destination')
  const excluded = [...trip.destinationIntent.excluded, ...trip.locationRoleOverrides.filter(value => value.role === 'avoid').map(value => value.location)]
  if (excluded.some(location => matchesAirport(query.destination, location))) missing.push('flight_destination_excluded')
  if (parameters.departureDate ? query.departureDate !== parameters.departureDate : !withinWindow(query.departureDate, trip.departureWindow)) missing.push('flight_departure_date')
  if (parameters.returnDate ? query.returnDate !== parameters.returnDate : query.returnDate !== undefined && !withinWindow(query.returnDate, trip.returnWindow)) missing.push('flight_return_date')
  return missing
}

function validOffers(result: FareSearchResult): boolean {
  return result.offers.every(offer => offer.segments[0]?.origin === result.query.origin
    && offer.segments.at(-1)?.destination === result.query.destination
    && offer.currency === result.query.currency)
}

function resultEvidence(results: FareSearchResult[], record: ArtifactRecord, context: GoalVerificationContext, partialCoverage = false): GoalVerification {
  if (results.some(result => !validOffers(result))) return verificationResult('failed', ['flight_offer_query_mismatch'])
  const statuses = results.map(result => currentEvidenceStatus(result.verification, context))
  if (statuses.some(status => status === 'unverified' || status === 'stale')) {
    return verificationResult('partial', ['verified_evidence'], [record.id], ['evidence_not_currently_verified'])
  }
  if (partialCoverage || statuses.some(status => status === 'partially_verified')) {
    return verificationResult('partial', partialCoverage ? ['flight_date_coverage'] : ['verified_evidence'], [record.id], ['evidence_partially_verified'])
  }
  return verificationResult('satisfied', [], [record.id])
}

function verifyExact(record: ArtifactRecord, goal: GoalRecord, context: GoalVerificationContext): GoalVerification {
  const parsed = flightSearchArtifactSchema.safeParse(record.payload)
  if (!parsed.success || parsed.data.id !== record.id) return verificationResult('failed', ['flight_search_payload'])
  const missing = queryMissing(parsed.data.query, goal, context)
  if (missing.length > 0) return verificationResult('pending', missing, [], ['flight_query_does_not_match_goal'])
  // A verified empty result completes a search; finding a purchasable offer is a different goal.
  return resultEvidence([parsed.data], record, context)
}

function verifyFlexible(record: ArtifactRecord, goal: GoalRecord, context: GoalVerificationContext): GoalVerification {
  const parsed = flexibleFlightSearchArtifactSchema.safeParse(record.payload)
  if (!parsed.success || parsed.data.id !== record.id) return verificationResult('failed', ['flight_search_payload'])
  const payload = parsed.data
  const scanned = new Set(payload.scannedDates)
  const successful = new Set(payload.successfulDates)
  const failed = new Set(payload.failedDates)
  const resultDates = new Set(payload.results.map(result => result.query.departureDate))
  const window = payload.window
  if (scanned.size !== payload.scannedDates.length || successful.size !== payload.successfulDates.length || failed.size !== payload.failedDates.length
    || resultDates.size !== payload.results.length || successful.size !== resultDates.size
    || [...successful].some(date => !resultDates.has(date) || failed.has(date))
    || [...successful, ...failed].some(date => !scanned.has(date))
    || [...scanned].some(date => date < window.departureDateFrom || date > window.departureDateTo || (!successful.has(date) && !failed.has(date)))
    || payload.results.some(result => result.query.origin !== window.origin || result.query.destination !== window.destination
      || result.query.returnDate !== window.returnDate || result.query.currency !== window.currency || result.query.travelClass !== window.travelClass
      || result.query.departureDate < window.departureDateFrom || result.query.departureDate > window.departureDateTo)) {
    return verificationResult('failed', ['flight_search_date_metadata'])
  }
  const matching = payload.results.filter(result => queryMissing(result.query, goal, context).length === 0)
  if (matching.length === 0) {
    const missing = payload.results.length > 0
      ? payload.results.flatMap(result => queryMissing(result.query, goal, context))
      : ['flight_search_result']
    return verificationResult('pending', missing, [], ['flight_query_does_not_match_goal'])
  }
  const relevantFailures = [...failed].filter(departureDate => queryMissing({
    origin: window.origin, destination: window.destination, departureDate,
    ...(window.returnDate ? { returnDate: window.returnDate } : {}), currency: window.currency, travelClass: window.travelClass
  }, goal, context).length === 0)
  // Failed exploratory dates outside the accepted request do not invalidate a matching sample.
  return resultEvidence(matching, record, context, relevantFailures.length > 0)
}

export class FlightSearchGoalVerifier implements GoalVerifier {
  readonly kind = 'flight_search' as const

  async verify(goal: GoalRecord, context: GoalVerificationContext): Promise<GoalVerification> {
    const contextFailure = currentContextFailure(context)
    if (contextFailure) return contextFailure
    if (!flightSearchGoalParametersSchema.safeParse(goal.parameters).success) return verificationResult('failed', ['goal_parameters'])
    const records = await goalArtifacts(goal, context, 'flight_search')
    return selectVerification(records.map(record => record.schemaVersion === 1 ? verifyExact(record, goal, context)
      : record.schemaVersion === 2 ? verifyFlexible(record, goal, context)
        : verificationResult('failed', ['flight_search_schema_version'])), 'flight_search_artifact')
  }
}
