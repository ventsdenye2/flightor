import { v7 as uuidv7 } from 'uuid'
import { loadWorkspaceArtifact, saveWorkspaceArtifact, type ArtifactWorkspace } from '../artifacts/workspace.js'
import { readableResearchArtifactSchema } from '../research-agent/types.js'
import { tripRoutePlanPayloadSchema } from '../trip-planning/types.js'
import { travelGuideArtifactPayloadSchema, type TravelGuideBuilder } from './artifact.js'

export async function composeTravelGuide(input: { routeArtifactId: string; researchArtifactIds: readonly string[] }, builder: TravelGuideBuilder, scope: ArtifactWorkspace) {
  const routeRecord = await loadWorkspaceArtifact(scope, input.routeArtifactId, 'route', [1])
  const route = tripRoutePlanPayloadSchema.parse(routeRecord.payload)
  const researchArtifacts = []
  for (const id of new Set(input.researchArtifactIds)) {
    const record = await loadWorkspaceArtifact(scope, id, 'research', [1, 2])
    const artifact = readableResearchArtifactSchema.parse(record.payload)
    if (artifact.id !== record.id) throw new Error('Research artifact identity does not match its envelope')
    researchArtifacts.push(artifact)
  }
  const payload = travelGuideArtifactPayloadSchema.parse(await builder.build({ routeArtifactId: input.routeArtifactId, route, researchArtifacts }, { ...(scope.signal ? { signal: scope.signal } : {}) }))
  if (payload.routeArtifactId !== input.routeArtifactId || input.researchArtifactIds.some(id => !payload.sourceArtifactIds.includes(id))) throw new Error('Travel guide builder returned mismatched source references')
  const record = await saveWorkspaceArtifact(scope, { id: uuidv7(), sourceArtifactIds: [routeRecord.id, ...new Set(input.researchArtifactIds)], type: 'travel_guide', schemaVersion: 1, payload, verification: payload.verification })
  return { record, payload }
}
