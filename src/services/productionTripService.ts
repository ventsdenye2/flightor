import { artifactService, type ArtifactFetchContext } from './artifactService'
import { getCloudWorkspace } from './workspaceService'
import { record } from '../components/artifacts/payload'
import { artifactToTripPresentation } from '../features/ui-experience/productionPresentation'

export async function loadProductionTrip(id: string, context: ArtifactFetchContext) {
  let selected = await artifactService.fetchArtifact(id, context)
  const publication = record(record(selected.payload)?.publication)
  if (selected.type === 'travel_guide' && publication?.status === 'preparing' && publication?.canLocalize === true) {
    selected = await artifactService.localizeArtifact(id, context)
  }
  const routeId = selected.type === 'route' ? selected.id : record(selected.payload)?.routeArtifactId
  if (typeof routeId !== 'string') throw new Error('攻略缺少对应路线，请从规划记录重新打开')
  const [route, workspace] = await Promise.all([
    selected.type === 'route' ? Promise.resolve(selected) : artifactService.fetchArtifact(routeId, context),
    getCloudWorkspace(selected.tripId, selected.conversationId, context.locale)
  ])
  if (route.tripId !== selected.tripId) throw new Error('攻略与行程不匹配')
  const selection = workspace.trip.selectedFlight
  const guideMatchesSelection = (artifact: typeof selected) => {
    const binding = record(record(artifact.payload)?.flightSelection)
    if (!selection) return !binding
    return binding?.kind === selection.kind
      && binding?.artifactId === selection.artifactId
      && binding?.choiceId === (selection.kind === 'offer' ? selection.offerId : selection.routeId)
      && binding?.revision === selection.revision
  }
  let guide = selected.type === 'travel_guide' && guideMatchesSelection(selected) ? selected : undefined
  let staleGuide = selected.type === 'travel_guide' ? selected : undefined
  if (!guide) {
    // API refs are newest first. Only a guide bound to this immutable route is eligible.
    for (const ref of workspace.artifactRefs.filter(ref => ref.type === 'travel_guide').slice(0, 8)) {
      const candidate = await artifactService.fetchArtifact(ref.id, context)
      if (candidate.tripId !== route.tripId || record(candidate.payload)?.routeArtifactId !== route.id) continue
      if (!staleGuide) staleGuide = candidate
      if (guideMatchesSelection(candidate)) { guide = candidate; break }
    }
  }
  const routeContextVersion = record(route.payload)?.tripContextVersion
  let selectedFlightArtifact
  if (selection && selection.contextVersion === routeContextVersion) {
    try { selectedFlightArtifact = await artifactService.fetchArtifact(selection.artifactId, context) } catch { /* Keep the itinerary usable with an empty flight state. */ }
  }
  return { route, guide: guide ?? staleGuide, workspace, presentation: artifactToTripPresentation(route, guide ?? staleGuide, workspace, selectedFlightArtifact) }
}
