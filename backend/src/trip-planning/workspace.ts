import { v7 as uuidv7 } from 'uuid'
import { checkpoint, loadWorkspaceArtifact, type ArtifactWorkspace } from '../artifacts/workspace.js'
import { destinationDiscoveryInputSchema, destinationDiscoveryResultSchema, destinationSetPayloadSchema, type DestinationDiscoveryInput, type DestinationDiscoveryService } from '../destinations/types.js'
import { tripRoutePlanPayloadSchema, tripRoutePlanResultSchema, type TripRoutePlanner } from './types.js'
import type { TripContext } from '../trips/types.js'

export async function discoverTripDestinations(input: DestinationDiscoveryInput, service: DestinationDiscoveryService, scope: ArtifactWorkspace, kind: 'destination_candidates' | 'destination_recommendations' = 'destination_candidates') {
  const query = destinationDiscoveryInputSchema.parse(input)
  await checkpoint(scope)
  const result = destinationDiscoveryResultSchema.parse(await service.discover(query, { ...(scope.signal ? { signal: scope.signal } : {}) }))
  const payload = destinationSetPayloadSchema.parse({ kind, schemaVersion: 1, ...result, query })
  await checkpoint(scope)
  const record = await scope.artifacts.create({ id: uuidv7(), tripId: scope.tripId, ...(scope.conversationId ? { conversationId: scope.conversationId } : {}), type: 'destination_set', schemaVersion: 1, payload, verification: payload.verification })
  return { record, payload }
}

export async function planTripDays(input: { candidateArtifactId: string; trip: TripContext; maxCities: number }, planner: TripRoutePlanner, scope: ArtifactWorkspace) {
  const source = await loadWorkspaceArtifact(scope, input.candidateArtifactId, 'destination_set', [1])
  const candidates = destinationSetPayloadSchema.parse(source.payload).candidates
  const result = tripRoutePlanResultSchema.parse(await planner.plan({ candidates, tripContext: input.trip, maxCities: input.maxCities }, { ...(scope.signal ? { signal: scope.signal } : {}) }))
  const payload = tripRoutePlanPayloadSchema.parse({ ...result, kind: 'trip_route_plan', schemaVersion: 1, sourceArtifactIds: [source.id], tripContextVersion: input.trip.version })
  await checkpoint(scope)
  const record = await scope.artifacts.create({ id: uuidv7(), tripId: scope.tripId, ...(scope.conversationId ? { conversationId: scope.conversationId } : {}), type: 'route', schemaVersion: 1, payload, verification: payload.verification })
  return { record, payload }
}
