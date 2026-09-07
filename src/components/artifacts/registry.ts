import type { ArtifactEnvelope } from '../../services/artifactService'

export type ArtifactRendererKey =
  | 'flight_search'
  | 'research'
  | 'travel_guide'
  | 'route'
  | 'destination_set'
  | 'route_set:connection_edges'
  | 'route_set:flight_paths'
  | 'route_set:optimized_routes'
  | 'unavailable'

export interface RendererResolution {
  key: ArtifactRendererKey
  supported: boolean
  reason?: 'unknown_type' | 'unsupported_version' | 'unsupported_payload_kind' | 'invalid_payload'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasType(value: unknown, expected: string): value is Record<string, unknown> & { type: string } {
  return isRecord(value) && value.type === expected
}

function isBoundedArray(value: unknown, max: number): value is unknown[] {
  return Array.isArray(value) && value.length <= max
}

/**
 * Lightweight shape guards deliberately keep payload-specific parsing here.
 * They make renderers receive only bounded, expected shapes without pretending
 * that an unknown server payload has a newer schema.
 */
export function hasFlightSearchPayload(value: unknown): value is Record<string, unknown> & { type: 'flight_search'; offers?: unknown[]; results?: unknown[] } {
  if (!hasType(value, 'flight_search') || typeof value.id !== 'string') return false
  return isBoundedArray(value.offers, 100) || isBoundedArray(value.results, 31)
}

export function hasResearchPayload(value: unknown): value is Record<string, unknown> & { type: 'research'; findings: unknown[] } {
  return hasType(value, 'research') && isBoundedArray(value.findings, 50)
}

export function hasTravelGuidePayload(value: unknown): value is Record<string, unknown> & { kind: 'trip_travel_guide'; days: unknown[] } {
  return isRecord(value) && value.kind === 'trip_travel_guide' && value.schemaVersion === 1 && isBoundedArray(value.days, 60)
}

export function hasRouteSetPayload(value: unknown, kind: 'connection_edges' | 'flight_paths' | 'optimized_routes'): boolean {
  if (!isRecord(value) || value.kind !== kind || value.schemaVersion !== 1) return false
  if (kind === 'connection_edges') return isBoundedArray(value.edges, 500)
  if (kind === 'flight_paths') return isBoundedArray(value.paths, 200)
  return isBoundedArray(value.representatives, 50)
}

function unavailable(reason: RendererResolution['reason']): RendererResolution {
  return { key: 'unavailable', supported: false, reason }
}

/** Explicit dispatch by artifact type, schemaVersion, and route payload kind. */
export function resolveArtifactRenderer(artifact: Pick<ArtifactEnvelope, 'type' | 'schemaVersion' | 'payload'>): RendererResolution {
  if (artifact.type === 'route' || artifact.type === 'destination_set') {
    if (artifact.schemaVersion !== 1) return unavailable('unsupported_version')
    const p = artifact.payload
    if (!isRecord(p) || p.schemaVersion !== 1) return unavailable('invalid_payload')
    if (artifact.type === 'route') return p.kind === 'trip_route_plan' && isBoundedArray(p.days, 60) ? { key: 'route', supported: true } : unavailable('invalid_payload')
    return ['destination_candidates', 'destination_recommendations'].includes(String(p.kind)) && isBoundedArray(p.candidates, 50) ? { key: 'destination_set', supported: true } : unavailable('invalid_payload')
  }
  if (artifact.type === 'flight_search') {
    if (artifact.schemaVersion !== 1 && artifact.schemaVersion !== 2) return unavailable('unsupported_version')
    return hasFlightSearchPayload(artifact.payload)
      ? { key: 'flight_search', supported: true }
      : unavailable('invalid_payload')
  }
  if (artifact.type === 'research') {
    if (artifact.schemaVersion !== 1 && artifact.schemaVersion !== 2) return unavailable('unsupported_version')
    return hasResearchPayload(artifact.payload)
      ? { key: 'research', supported: true }
      : unavailable('invalid_payload')
  }
  if (artifact.type === 'travel_guide') {
    if (artifact.schemaVersion !== 1) return unavailable('unsupported_version')
    return hasTravelGuidePayload(artifact.payload)
      ? { key: 'travel_guide', supported: true }
      : unavailable('invalid_payload')
  }
  if (artifact.type === 'route_set') {
    if (artifact.schemaVersion !== 1) return unavailable('unsupported_version')
    if (!isRecord(artifact.payload) || typeof artifact.payload.kind !== 'string') return unavailable('invalid_payload')
    if (artifact.payload.kind === 'connection_edges' || artifact.payload.kind === 'flight_paths' || artifact.payload.kind === 'optimized_routes') {
      return hasRouteSetPayload(artifact.payload, artifact.payload.kind)
        ? { key: `route_set:${artifact.payload.kind}`, supported: true }
        : unavailable('invalid_payload')
    }
    return unavailable('unsupported_payload_kind')
  }
  return unavailable('unknown_type')
}

export const getArtifactRenderer = resolveArtifactRenderer

export const rendererRegistry = {
  resolve: resolveArtifactRenderer,
  supported: (artifact: Pick<ArtifactEnvelope, 'type' | 'schemaVersion' | 'payload'>): boolean => resolveArtifactRenderer(artifact).supported
}

/** Class form keeps registry ownership explicit for future renderer injection. */
export class ArtifactRendererRegistry {
  resolve(artifact: Pick<ArtifactEnvelope, 'type' | 'schemaVersion' | 'payload'>): RendererResolution {
    return resolveArtifactRenderer(artifact)
  }

  supported(artifact: Pick<ArtifactEnvelope, 'type' | 'schemaVersion' | 'payload'>): boolean {
    return this.resolve(artifact).supported
  }
}

export const artifactRendererRegistry = new ArtifactRendererRegistry()
