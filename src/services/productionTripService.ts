import { artifactService, type ArtifactFetchContext } from './artifactService'
import { getCloudWorkspace } from './workspaceService'
import { record } from '../components/artifacts/payload'
import { artifactToTripPresentation } from '../features/ui-experience/productionPresentation'

export async function loadProductionTrip(id: string, context: ArtifactFetchContext) {
  const selected = await artifactService.fetchArtifact(id, context)
  const routeId = selected.type === 'route' ? selected.id : record(selected.payload)?.routeArtifactId
  if (typeof routeId !== 'string') throw new Error('攻略缺少对应路线，请从规划记录重新打开')
  const [route, workspace] = await Promise.all([
    selected.type === 'route' ? Promise.resolve(selected) : artifactService.fetchArtifact(routeId, context),
    getCloudWorkspace(selected.tripId, selected.conversationId)
  ])
  if (route.tripId !== selected.tripId) throw new Error('攻略与行程不匹配')
  let guide = selected.type === 'travel_guide' ? selected : undefined
  if (!guide) {
    // API refs are newest first. Only a guide bound to this immutable route is eligible.
    for (const ref of workspace.artifactRefs.filter(ref => ref.type === 'travel_guide').slice(0, 8)) {
      const candidate = await artifactService.fetchArtifact(ref.id, context)
      if (candidate.tripId === route.tripId && record(candidate.payload)?.routeArtifactId === route.id) { guide = candidate; break }
    }
  }
  return { route, guide, workspace, presentation: artifactToTripPresentation(route, guide, workspace) }
}
