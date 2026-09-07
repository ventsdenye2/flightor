import { Text } from '@tarojs/components'
import type { ArtifactEnvelope } from '../../services/artifactService'
import { resolveArtifactRenderer } from './registry'
import { FlightSearchCard } from './FlightSearchCard'
import { ResearchCard } from './ResearchCard'
import { RoutePreviewCard, type RoutePreviewKind } from './RoutePreviewCard'
import { TravelGuideCard } from './TravelGuideCard'
import { UnavailableArtifactCard } from './UnavailableArtifactCard'
import { ArtifactCard } from './ArtifactCard'
import { displayLocation, record, records } from './payload'

export interface ArtifactRendererProps {
  artifact: ArtifactEnvelope
  onAction?: () => void
}

export function ArtifactRenderer({ artifact, onAction }: ArtifactRendererProps) {
  const resolution = resolveArtifactRenderer(artifact)
  if (!resolution.supported || resolution.key === 'unavailable') {
    const reason = resolution.reason === 'unsupported_version'
      ? 'This artifact schema version is newer than the installed renderer.'
      : resolution.reason === 'unsupported_payload_kind'
        ? 'This route payload kind is not available in the installed renderer.'
        : 'The returned artifact payload could not be rendered safely.'
    return <UnavailableArtifactCard artifact={artifact} reason={reason} />
  }
  if (resolution.key === 'flight_search') return <FlightSearchCard artifact={artifact} onAction={onAction} />
  if (resolution.key === 'research') return <ResearchCard artifact={artifact} onAction={onAction} />
  if (resolution.key === 'travel_guide') return <TravelGuideCard artifact={artifact} onAction={onAction} />
  if (resolution.key === 'route' || resolution.key === 'destination_set') {
    const payload = record(artifact.payload)!
    const destinations = records(payload.candidates, 50).slice(0, 5).map(candidate => displayLocation(candidate.location)).filter(Boolean)
    return <ArtifactCard artifact={artifact} accent='research' label={resolution.key === 'route' ? 'ITINERARY' : 'DESTINATIONS'} title={resolution.key === 'route' ? '行程大纲' : '目的地建议'} summary={resolution.key === 'route' ? `${records(payload.days, 60).length} 天行程 · 交通待查询` : destinations.join(' · ')} actionLabel={onAction ? '查看详情' : undefined} onAction={onAction} />
  }
  return <RoutePreviewCard artifact={artifact} kind={resolution.key.slice('route_set:'.length) as RoutePreviewKind} onAction={onAction} />
}
