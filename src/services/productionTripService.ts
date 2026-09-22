import { artifactService, type ArtifactFetchContext } from './artifactService'
import { getCloudWorkspace } from './workspaceService'
import { record } from '../components/artifacts/payload'
import { artifactToTripPresentation } from '../features/ui-experience/productionPresentation'
import type {TripPresentation} from '../features/ui-experience/presentation'
import { readPlaceEnrichment, resolvePlaceEnrichment } from './placeService'

export async function loadProductionTrip(id: string, context: ArtifactFetchContext) {
  const selected = await artifactService.fetchArtifact(id, context)
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
  const effectiveGuide=guide??staleGuide
  return { route, guide: effectiveGuide, workspace, selectedFlightArtifact, presentation: artifactToTripPresentation(route, effectiveGuide, workspace, selectedFlightArtifact, context.locale ?? 'zh') }
}

/** Independent extension read: callers publish text before awaiting this promise. */
export async function loadProductionPlaces(loaded:Awaited<ReturnType<typeof loadProductionTrip>>,context:ArtifactFetchContext){
  let effectiveGuide=loaded.guide
  const publication=loaded.presentation.publication
  if(effectiveGuide && publication?.status==='accepted'){
    const enrichment=await readPlaceEnrichment(effectiveGuide.id)
    if(enrichment&&enrichment.contentVersion===publication.contentVersion){
      const prior=effectiveGuide.enrichment?.contentVersion===enrichment.contentVersion?effectiveGuide.enrichment:undefined
      effectiveGuide={...effectiveGuide,enrichment:{...prior,...enrichment,activities:{...prior?.activities,
        ...Object.fromEntries(Object.entries(enrichment.activities).map(([id,value])=>[id,{...record(prior?.activities[id]),...record(value)}]))}}}
    }
  }
  return {...loaded,guide:effectiveGuide,presentation:artifactToTripPresentation(loaded.route,effectiveGuide,loaded.workspace,loaded.selectedFlightArtifact,context.locale??'zh')}
}

export function samePlacePublication(a:TripPresentation|undefined,b:TripPresentation):boolean {
 return a?.publication?.status==='accepted'&&b?.publication?.status==='accepted'&&a.locale===b.locale
  &&a.publication.artifactId===b.publication.artifactId&&a.publication.contentVersion===b.publication.contentVersion
}

export async function prepareProductionPlaces(id:string,context:ArtifactFetchContext){
 const loaded=await loadProductionTrip(id,{...context,force:true}),pub=loaded.presentation.publication
 if(pub?.status!=='accepted'||!pub.artifactId||!pub.contentVersion)throw Error('PLACE_BASE_UNAVAILABLE')
 await resolvePlaceEnrichment(pub.artifactId,pub.contentVersion)
 return loadProductionPlaces(await loadProductionTrip(id,{...context,force:true}),context)
}

/** Only an explicit UI action invokes this; rendering and recovery remain GET-only. */
export async function prepareProductionLocale(id: string, context: ArtifactFetchContext, retryRevision?: number) {
  const loaded = await loadProductionTrip(id, { ...context, force: true })
  const publication = loaded.presentation.publication
  if (!publication?.artifactId || !publication.canLocalize || (retryRevision === undefined
    ? publication.status !== 'preparing' : !publication.canRetry || publication.revision !== retryRevision)) {
    throw new Error('PUBLICATION_RETRY_UNAVAILABLE')
  }
  await artifactService.localizeArtifact(publication.artifactId, { ...context, ...(retryRevision === undefined ? {} : { retryRevision }) })
  return loadProductionTrip(id, { ...context, force: true })
}
