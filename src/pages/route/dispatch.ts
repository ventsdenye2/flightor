import type { ArtifactEnvelope } from '../../services/artifactService'
import type { RouteView } from '../../services/routeArtifact'
import type { TripPresentation } from '../../features/ui-experience/presentation'
import { resolveArtifactRenderer, type RendererResolution } from '../../components/artifacts/registry'

export const ROUTE_DETAIL_SHELL_CLASS = 'ux-app production-detail-page route-production'

export type RouteDetailView =
  | { kind: 'guest' }
  | { kind: 'missing' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'trip'; presentation: TripPresentation }
  | { kind: 'route-set'; routes: RouteView[] }
  | { kind: 'flight-list'; artifact: ArtifactEnvelope }
  | { kind: 'flight-detail'; artifact: ArtifactEnvelope; offerId: string }
  | { kind: 'research'; artifact: ArtifactEnvelope }
  | { kind: 'destination'; artifact: ArtifactEnvelope }
  | { kind: 'unavailable'; artifact?: ArtifactEnvelope; reason?: RendererResolution['reason'] | 'presentation_unavailable' }

export interface RouteDetailInput {
  ownerId?: string
  artifactId: string
  error?: string
  artifact?: ArtifactEnvelope
  presentation?: TripPresentation
  routes?: RouteView[]
  offerId?: string
}

export function decodeRouteParam(value: string | undefined): string | undefined {
  if (!value) return value
  try { return decodeURIComponent(value) } catch { return value }
}

export function resolveRouteDetailView(input: RouteDetailInput): RouteDetailView {
  if (!input.ownerId) return { kind: 'guest' }
  if (!input.artifactId) return { kind: 'missing' }
  if (input.error) return { kind: 'error', message: input.error }
  if (input.presentation) return { kind: 'trip', presentation: input.presentation }
  if (!input.artifact) return { kind: 'loading' }

  const resolution = resolveArtifactRenderer(input.artifact)
  if (!resolution.supported || resolution.key === 'unavailable') {
    return { kind: 'unavailable', artifact: input.artifact, reason: resolution.reason }
  }
  if (resolution.key.startsWith('route_set:')) return { kind: 'route-set', routes: input.routes ?? [] }
  if (resolution.key === 'flight_search') {
    return input.offerId
      ? { kind: 'flight-detail', artifact: input.artifact, offerId: input.offerId }
      : { kind: 'flight-list', artifact: input.artifact }
  }
  if (resolution.key === 'research') return { kind: 'research', artifact: input.artifact }
  if (resolution.key === 'destination_set') return { kind: 'destination', artifact: input.artifact }

  // Route and guide artifacts are rendered only after their immutable snapshots
  // have been combined into a production presentation.
  return { kind: 'unavailable', artifact: input.artifact, reason: 'presentation_unavailable' }
}
