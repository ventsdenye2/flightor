import type { ArtifactRecord } from '../../artifacts/repository.js'
import { routeSetPayloadSchema, type CompleteFlightPath } from '../../flight-routing/types.js'
import { connectionMinimumMinutes, edgeHasAirportChange, edgeLocations, internalTransfers, LONG_STOPOVER_MINUTES, pathHasSelfTransfer, pathTransferCount } from '../../flight-routing/itinerary.js'
import { locationsOverlap } from '../../locations/identity.js'
import { CURATED_LOCATION_IDENTITY_POLICY } from '../../locations/curated-directory.js'
import { canonicalFingerprint } from './repository.js'
import { routeGenerationGoalParametersSchema, type GoalRecord } from './types.js'
import type { GoalVerification, GoalVerificationContext, GoalVerifier } from './verifier.js'
import { currentContextFailure, currentEvidenceStatus, goalArtifacts, hasCurrentArtifactScope, selectVerification, verificationResult } from './artifact-verification.js'

function pathMissing(path: CompleteFlightPath, context: GoalVerificationContext): string[] {
  const trip = context.run.contextSnapshot
  const missing: string[] = []
  const overlaps = (left: typeof path.nodes[number]['location'], right: typeof path.nodes[number]['location']) => locationsOverlap(left, right, CURATED_LOCATION_IDENTITY_POLICY)
  const origin = path.nodes[0]!.location
  const destination = path.nodes.at(-1)!.location
  if (!trip.origin || !overlaps(origin, trip.origin)) missing.push('route_origin')
  const required = [...trip.destinationIntent.required, ...trip.locationRoleOverrides.filter(value => value.role === 'visit').map(value => value.location)]
  if (required.length === 0 || required.some(location => !path.nodes.some(node => overlaps(node.location, location)))) missing.push('route_required_location_coverage')
  if (required.length > 0 && !required.some(location => overlaps(destination, location))) missing.push('route_destination')
  const excluded = [...trip.destinationIntent.excluded, ...trip.locationRoleOverrides.filter(value => value.role === 'avoid').map(value => value.location)]
  if ([...path.nodes.map(node => node.location), ...path.edges.flatMap(edgeLocations)].some(airport => excluded.some(location => overlaps(airport, location)))) missing.push('route_excluded_location')
  const departure = path.edges[0]!.departureDate
  const from = trip.departureWindow?.from ?? trip.departureWindow?.to
  const to = trip.departureWindow?.to ?? trip.departureWindow?.from
  if (!from || !to || departure < from || departure > to) missing.push('route_departure_date')
  if (path.edges.some((edge, index) => index > 0 && edge.departureDate < (path.edges[index - 1]!.arrivalDate ?? path.edges[index - 1]!.departureDate))) missing.push('route_temporal_consistency')
  if (path.edges.some(edge => internalTransfers(edge).some(transfer => transfer.durationMinutes !== undefined && transfer.durationMinutes < 0))) missing.push('route_temporal_consistency')
  if (path.edges.some(edge => internalTransfers(edge).some(transfer => transfer.durationMinutes !== undefined
    && transfer.durationMinutes < connectionMinimumMinutes(edge.transferType === 'self', transfer.arrivalAirport.iata !== transfer.departureAirport.iata)))) missing.push('route_connection_buffer')
  if (path.transferCount !== pathTransferCount(path.edges)) missing.push('route_transfer_count')
  if (path.edges.some(edge => edge.from.type !== 'airport' || !edge.from.iata || edge.to.type !== 'airport' || !edge.to.iata)) missing.push('route_airport_identity')
  if (trip.returnWindow || trip.requiredGroundLegs.length > 0) missing.push('route_supported_scope')
  if (trip.transferPreferences.acceptsSelfTransfer !== true && pathHasSelfTransfer(path.edges)) missing.push('route_self_transfer_policy')
  if (trip.transferPreferences.acceptsAirportChange !== true && path.edges.some(edgeHasAirportChange)) missing.push('route_airport_change_policy')
  if (trip.transferPreferences.acceptsLongStopover !== true && path.edges.some(edge => internalTransfers(edge).some(transfer => (transfer.durationMinutes ?? 0) > LONG_STOPOVER_MINUTES))) missing.push('route_long_stopover_policy')
  return missing
}

async function verifyRoutes(record: ArtifactRecord, context: GoalVerificationContext): Promise<GoalVerification> {
  const parsed = routeSetPayloadSchema.safeParse(record.payload)
  if (record.schemaVersion !== 1 || !parsed.success) return verificationResult('failed', ['route_set_payload'])
  if (parsed.data.kind !== 'optimized_routes') return verificationResult('pending', ['optimized_routes_artifact'])
  const routes = parsed.data
  if (routes.representatives.length === 0) return verificationResult('pending', ['route_representatives'])
  if (routes.sourceArtifactIds.length === 0 || routes.sourceArtifactIds.some(id => !record.sourceArtifactIds?.includes(id))) return verificationResult('failed', ['route_source_lineage'])
  const records = await Promise.all(routes.sourceArtifactIds.map(id => context.artifacts.get(id)))
  const sourcePaths: CompleteFlightPath[] = []
  for (const source of records) {
    const payload = routeSetPayloadSchema.safeParse(source?.payload)
    if (!source || !hasCurrentArtifactScope(source, context) || source.type !== 'route_set' || source.schemaVersion !== 1
      || !payload.success || payload.data.kind !== 'flight_paths') return verificationResult('failed', ['route_source_scope'])
    sourcePaths.push(...payload.data.paths)
  }
  if (routes.representatives.some(value => !sourcePaths.some(path => path.id === value.path.id && canonicalFingerprint(path) === canonicalFingerprint(value.path)))) {
    return verificationResult('failed', ['route_path_lineage'])
  }
  const missing = routes.representatives.flatMap(value => pathMissing(value.path, context))
  const statuses = [currentEvidenceStatus(routes.verification, context),
    ...routes.representatives.flatMap(value => value.path.edges.map(edge => currentEvidenceStatus(edge.verification, context)))]
  if (statuses.some(status => status === 'unverified' || status === 'stale')) missing.push('verified_evidence')
  const partial = statuses.some(status => status === 'partially_verified')
    || routes.representatives.some(value => value.path.feasibility !== 'feasible' || value.path.edges.some(edge => edge.availability !== 'verified'))
  if (partial) missing.push('route_feasibility_evidence')
  return verificationResult(missing.length === 0 ? 'satisfied' : 'partial', missing, [record.id], partial ? ['evidence_partially_verified'] : [])
}

export class RouteGenerationGoalVerifier implements GoalVerifier {
  readonly kind = 'route_generation' as const

  async verify(goal: GoalRecord, context: GoalVerificationContext): Promise<GoalVerification> {
    const contextFailure = currentContextFailure(context)
    if (contextFailure) return contextFailure
    if (!routeGenerationGoalParametersSchema.safeParse(goal.parameters).success || !goal.authorization) return verificationResult('failed', ['goal_authorization'])
    const records = await goalArtifacts(goal, context, 'route_set')
    // Connection/path artifacts are valid intermediate results, not failed final candidates.
    const candidates = records.filter(record => !(record.payload && typeof record.payload === 'object'
      && 'kind' in record.payload && (record.payload.kind === 'connection_edges' || record.payload.kind === 'flight_paths')))
    return selectVerification(await Promise.all(candidates.map(record => verifyRoutes(record, context))), 'optimized_routes_artifact')
  }
}
