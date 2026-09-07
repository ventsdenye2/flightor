import { View, Text } from '@tarojs/components'
import type { ArtifactEnvelope } from '../../services/artifactService'
import { ArtifactCard } from './ArtifactCard'
import { displayLocation, displayRoute, firstText, numberValue, record, records, strings } from './payload'
import './RoutePreviewCard.scss'

export type RoutePreviewKind = 'connection_edges' | 'flight_paths' | 'optimized_routes'

export interface RoutePreviewCardProps {
  artifact: ArtifactEnvelope
  kind: RoutePreviewKind
  onAction?: () => void
}

const kindLabel: Record<RoutePreviewKind, string> = {
  connection_edges: 'CONNECTION EDGES',
  flight_paths: 'FLIGHT PATHS',
  optimized_routes: 'OPTIMIZED ROUTES'
}

function routeCount(payload: Record<string, unknown>, kind: RoutePreviewKind): number {
  const field = kind === 'connection_edges' ? payload.edges : kind === 'flight_paths' ? payload.paths : payload.representatives
  return Array.isArray(field) ? field.length : 0
}

function routeLine(value: unknown, kind: RoutePreviewKind): string | undefined {
  const item = record(value)
  if (!item) return undefined
  if (kind === 'connection_edges') return displayRoute(item)
  if (kind === 'flight_paths') {
    const nodes = records(item.nodes, 32).map(node => record(node)?.location).map(displayLocation).filter((item): item is string => item !== undefined)
    return nodes.length > 1 ? nodes.join(' → ') : undefined
  }
  const scored = record(item.path)
  if (!scored) return undefined
  return routeLine(scored, 'flight_paths')
}

export function RoutePreviewCard({ artifact, kind, onAction }: RoutePreviewCardProps) {
  const payload = record(artifact.payload)
  if (!payload) return null
  const values = kind === 'connection_edges' ? records(payload.edges, 500) : kind === 'flight_paths' ? records(payload.paths, 200) : records(payload.representatives, 50)
  const query = record(payload.query)
  const queryLabel = query ? `${displayLocation(query.origin) ?? 'Origin'} → ${displayLocation(query.destination) ?? 'Destination'}` : undefined
  const warnings = strings(payload.warnings, 4).length > 0
    ? strings(payload.warnings, 4)
    : records(payload.warnings, 4).map(item => firstText(item.message)).filter((item): item is string => item !== undefined)
  return (
    <ArtifactCard
      artifact={artifact}
      accent='route'
      label={kindLabel[kind]}
      title={queryLabel ?? 'Route preview'}
      summary={`${routeCount(payload, kind)} candidate${routeCount(payload, kind) === 1 ? '' : 's'} · ${firstText(payload.serviceVersion) ?? 'service version unavailable'}`}
      actionLabel={onAction ? (kind === 'optimized_routes' ? 'Review route result' : 'Open route details') : undefined}
      onAction={onAction}
    >
      <View className='artifact-route__list'>
        {values.slice(0, 3).map((value, index) => {
          const item = record(value)
          const path = routeLine(value, kind)
          const routeValue = kind === 'optimized_routes' && item ? record(item.path) : item
          const fare = routeValue ? record(routeValue.totalFare) : undefined
          const fareAmount = fare ? numberValue(fare.amount) : undefined
          const currency = fare ? firstText(fare.currency) : undefined
          return (
            <View key={`${path ?? 'route'}-${index}`} className='artifact-route__row'>
              <Text className='artifact-route__path'>{path ?? 'Route endpoints unavailable'}</Text>
              {fareAmount !== undefined && <Text className='artifact-route__fare'>{currency ?? ''}{fareAmount.toLocaleString()}</Text>}
            </View>
          )
        })}
        {values.length === 0 && <Text className='artifact-route__empty'>No route candidates were returned.</Text>}
        {values.length > 3 && <Text className='artifact-route__more'>Showing 3 of {values.length} returned candidates</Text>}
        {warnings.length > 0 && <Text className='artifact-route__warning'>{warnings[0]}</Text>}
      </View>
    </ArtifactCard>
  )
}
