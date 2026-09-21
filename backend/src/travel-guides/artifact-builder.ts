import { sourceApplicability } from './source-applicability.js'
import { createHash } from 'node:crypto'
import type { LocationRef, VerificationRecord } from '../aviation/types.js'
import { locationsOverlap } from '../locations/identity.js'
import { CURATED_LOCATION_IDENTITY_POLICY } from '../locations/curated-directory.js'
import type { ReadableResearchArtifact, ResearchArtifact } from '../research-agent/types.js'
import {
  travelGuideArtifactPayloadSchema,
  travelGuideBuildInputSchema,
  type TravelGuideArtifactPayload,
  type TravelGuideBuilder,
  type TravelGuideBuildInput,
  type TravelGuideBuilderContext
} from './artifact.js'

const BUILDER_VERSION = 'travel-guide-v3'

function sameLocation(left: LocationRef, right: LocationRef): boolean {
  return locationsOverlap(left, right, CURATED_LOCATION_IDENTITY_POLICY)
}

function legacyVerification(
  confidence: 'confirmed' | 'partial' | 'unconfirmed',
  checkedAt: string,
  sourceUrls: readonly string[]
): VerificationRecord {
  return {
    status: confidence === 'unconfirmed' ? 'unverified' : 'partially_verified',
    checkedAt,
    confidence: confidence === 'confirmed' ? 0.6 : confidence === 'partial' ? 0.4 : 0.1,
    sources: sourceUrls.slice(0, 20).map(reference => ({ provider: 'legacy_research', reference }))
  }
}

interface NormalizedFinding {
  id: string
  category: 'event' | 'seasonal' | 'activity' | 'stopover' | 'practical'
  destinations: LocationRef[]
  title: string
  summary: string
  verification: VerificationRecord
  artifactId: string
}

function normalizedFindings(artifact: ReadableResearchArtifact): NormalizedFinding[] {
  if (artifact.schemaVersion === 2) {
    return artifact.findings.map(finding => ({
      id: finding.id,
      category: finding.category,
      destinations: finding.destinations,
      title: finding.title,
      summary: finding.summary,
      verification: finding.verification,
      artifactId: artifact.id
    }))
  }
  const categories = artifact.brief.researchTypes
  return artifact.findings.map((finding, index) => ({
    id: `legacy_${index + 1}`,
    category: categories[index % categories.length] ?? 'activity',
    destinations: artifact.brief.destinations,
    title: finding.title,
    summary: finding.summary,
    verification: legacyVerification(finding.confidence, finding.verifiedAt, finding.sourceUrls),
    artifactId: artifact.id
  }))
}

function reasonFor(category: NormalizedFinding['category']): 'event' | 'seasonal' | 'agent_recommended' | 'stopover' {
  if (category === 'event') return 'event'
  if (category === 'seasonal') return 'seasonal'
  if (category === 'stopover') return 'stopover'
  return 'agent_recommended'
}

function itemId(finding: NormalizedFinding, day: number): string {
  return `guide_${createHash('sha256').update(`${finding.artifactId}:${finding.id}:${day}`).digest('hex').slice(0, 24)}`
}

export function aggregateGuideVerification(items: Array<{ verification: VerificationRecord }>, now: string): VerificationRecord {
  if (items.length === 0) {
    return { status: 'unverified', checkedAt: now, confidence: 0, sources: [] }
  }
  const statuses = items.map(item => item.verification.status)
  const status: VerificationRecord['status'] = statuses.includes('unverified')
    ? 'unverified'
    : statuses.includes('stale')
      ? 'stale'
      : statuses.includes('partially_verified')
        ? 'partially_verified'
        : 'verified'
  const sources = new Map<string, VerificationRecord['sources'][number]>()
  for (const item of items) {
    for (const source of item.verification.sources) {
      const key = `${source.provider}:${source.reference ?? ''}`
      if (!sources.has(key)) sources.set(key, source)
    }
  }
  return {
    status,
    checkedAt: now,
    confidence: Math.min(...items.map(item => item.verification.confidence)),
    sources: [...sources.values()].slice(0, 20)
  }
}

export class DeterministicTravelGuideBuilder implements TravelGuideBuilder {
  async build(input: TravelGuideBuildInput, context: TravelGuideBuilderContext = {}): Promise<TravelGuideArtifactPayload> {
    if (context.signal?.aborted) throw context.signal.reason ?? new Error('Travel guide build cancelled')
    const normalized = travelGuideBuildInputSchema.parse(input)
    const findings = normalized.researchArtifacts.flatMap(normalizedFindings)
    const omitted = findings.filter(item => item.verification.status === 'unverified' || item.verification.status === 'stale').length
    const eligible = findings.filter(item => item.verification.status === 'verified' || item.verification.status === 'partially_verified')
    const consumed = new Set<string>()
    const days = normalized.route.days.map((day, dayIndex) => {
      const available = eligible.filter(finding =>
        !consumed.has(`${finding.artifactId}:${finding.id}`)
        && finding.destinations.some(destination => sameLocation(destination, day.city)))
      // Spread evidence across the city's remaining days instead of consuming
      // the first six findings on day one and leaving the rest of the trip empty.
      const remainingCityDays = normalized.route.days.slice(dayIndex).filter(next => sameLocation(next.city, day.city)).length
      const matches = available.slice(0, Math.min(6, Math.ceil(available.length / remainingCityDays)))
      for (const finding of matches) consumed.add(`${finding.artifactId}:${finding.id}`)
      return {
        day: day.day,
        city: day.city,
        items: matches.map(finding => ({
          id: itemId(finding, day.day),
          title: finding.title,
          description: finding.summary,
          city: day.city,
          category: finding.category,
          reason: reasonFor(finding.category),
          sourceArtifactId: finding.artifactId,
          sourceFindingId: finding.id,
          sourceApplicability: sourceApplicability(),
          verification: finding.verification
        }))
      }
    })
    if (context.signal?.aborted) throw context.signal.reason ?? new Error('Travel guide build cancelled')
    const items = days.flatMap(day => day.items)
    const warnings = [...new Set([
      ...normalized.route.warnings,
      ...normalized.researchArtifacts.flatMap(artifact => artifact.schemaVersion === 2 ? artifact.warnings : []),
      ...(omitted > 0 ? [`omitted_${omitted}_unverified_or_stale_findings`] : []),
      ...(items.some(item => item.verification.status === 'partially_verified') ? ['guide_contains_partially_verified_research'] : []),
      ...(items.length === 0 ? ['no_eligible_research_findings'] : [])
    ])].slice(0, 40)
    const now = new Date().toISOString()
    return travelGuideArtifactPayloadSchema.parse({
      kind: 'trip_travel_guide',
      schemaVersion: 1,
      builderVersion: BUILDER_VERSION,
      sourceArtifactIds: [
        normalized.routeArtifactId,
        ...normalized.route.sourceArtifactIds,
        ...normalized.researchArtifacts.map(artifact => artifact.id)
      ].filter((value, index, values) => values.indexOf(value) === index).slice(0, 30),
      routeArtifactId: normalized.routeArtifactId,
      days,
      unassignedActivityRefs: normalized.route.unassignedActivityRefs,
      verification: aggregateGuideVerification(items, now),
      warnings,
      createdAt: now
    })
  }
}
