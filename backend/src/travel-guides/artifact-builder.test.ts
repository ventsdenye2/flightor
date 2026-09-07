import { describe, expect, it } from 'vitest'
import type { LocationRef, VerificationRecord } from '../aviation/types.js'
import type { ResearchArtifact } from '../research-agent/types.js'
import type { TripRoutePlanPayload } from '../trip-planning/types.js'
import { DeterministicTravelGuideBuilder } from './artifact-builder.js'

const tokyo: LocationRef = {
  id: 'city:TYO', type: 'city', name: 'Tokyo', countryCode: 'JP', cityCode: 'TYO',
  latitude: 35.6762, longitude: 139.6503
}
const partial: VerificationRecord = {
  status: 'partially_verified', checkedAt: '2026-09-07T00:00:00.000Z', confidence: 0.6,
  sources: [{ provider: 'serpapi', reference: 'https://example.com/tokyo' }]
}

function route(): TripRoutePlanPayload {
  return {
    kind: 'trip_route_plan', schemaVersion: 1, plannerVersion: 'test-v1',
    sourceArtifactIds: ['destination-set-1'], tripContextVersion: 2,
    cities: [{ location: tokyo, stayDays: 2, role: 'visit', reasons: ['required'] }],
    days: [
      { day: 1, city: tokyo, activityRefs: [] },
      { day: 2, city: tokyo, activityRefs: [] }
    ],
    stopoverOnly: [], landTransfers: [],
    unassignedActivityRefs: [{ id: 'event-user', title: 'User event', reason: 'user_requested' }],
    verification: partial, warnings: ['ground_transfers_unresolved']
  }
}

function research(): ResearchArtifact {
  return {
    id: 'research-1', type: 'research', schemaVersion: 2,
    brief: {
      destinations: [tokyo], interests: ['culture'], questions: ['What is open?'],
      researchTypes: ['activity'], maxResults: 5
    },
    findings: [
      {
        id: 'finding-1', category: 'activity', destinations: [tokyo],
        title: 'Museum source', summary: 'A bounded source-backed summary.',
        sources: [{ title: 'Museum source', url: 'https://example.com/tokyo', domain: 'example.com', snippet: 'A bounded source-backed summary.', authority: 'unknown' }],
        verification: partial, warnings: []
      },
      {
        id: 'finding-2', category: 'event', destinations: [tokyo],
        title: 'Unverified event', summary: 'A snippet-only event.',
        sources: [{ title: 'Event', url: 'https://other.example/event', domain: 'other.example', snippet: 'A snippet-only event.', authority: 'unknown' }],
        verification: { ...partial, status: 'unverified', confidence: 0.1 }, warnings: []
      }
    ],
    queryCount: 1, warnings: [], createdAt: '2026-09-07T00:00:00.000Z'
  }
}

describe('DeterministicTravelGuideBuilder', () => {
  it('matches Tokyo city research to Narita routes without including Osaka', async () => {
    const tripRoute = route()
    const narita: LocationRef = { ...tokyo, id: 'catalog:NRT', type: 'airport', iata: 'NRT', cityCode: 'NRT' }
    tripRoute.cities[0]!.location = narita
    tripRoute.days = tripRoute.days.map(day => ({ ...day, city: narita }))
    const source = research()
    source.findings.push({ ...source.findings[0]!, id: 'osaka', destinations: [{ ...tokyo, id: 'city:OSA', cityCode: 'OSA', name: 'Osaka' }] })
    const result = await new DeterministicTravelGuideBuilder().build({ routeArtifactId: 'route-1', route: tripRoute, researchArtifacts: [source] })
    expect(result.days.flatMap(day => day.items.map(item => item.sourceFindingId))).toEqual(['finding-1'])
  })
  it('distributes eligible findings across all city days without duplication', async () => {
    const source = research()
    source.findings = Array.from({ length: 6 }, (_, index) => ({ ...source.findings[0]!, id: `finding-${index}` }))
    const tripRoute = route()
    tripRoute.cities[0]!.stayDays = 5
    tripRoute.days = Array.from({ length: 5 }, (_, index) => ({ day: index + 1, city: tokyo, activityRefs: [] }))
    const result = await new DeterministicTravelGuideBuilder().build({ routeArtifactId: 'route-1', route: tripRoute, researchArtifacts: [source] })
    expect(result.days.map(day => day.items.length)).toEqual([2, 1, 1, 1, 1])
    expect(new Set(result.days.flatMap(day => day.items.map(item => item.sourceFindingId))).size).toBe(6)
  })
  it('composes only eligible source-backed findings and keeps artifact references', async () => {
    const result = await new DeterministicTravelGuideBuilder().build({
      routeArtifactId: 'route-1', route: route(), researchArtifacts: [research()]
    })

    expect(result.routeArtifactId).toBe('route-1')
    expect(result.sourceArtifactIds).toEqual(['route-1', 'destination-set-1', 'research-1'])
    expect(result.days.flatMap(day => day.items)).toHaveLength(1)
    expect(result.days[0]?.items[0]).toMatchObject({
      sourceArtifactId: 'research-1', sourceFindingId: 'finding-1', city: tokyo
    })
    expect(result.unassignedActivityRefs).toEqual(route().unassignedActivityRefs)
    expect(result.warnings).toContain('omitted_1_unverified_or_stale_findings')
    expect(result.verification.status).toBe('partially_verified')
  })

  it('does not fabricate items when no eligible research exists', async () => {
    const onlyUnverified = research()
    onlyUnverified.findings = onlyUnverified.findings.slice(1)
    const result = await new DeterministicTravelGuideBuilder().build({
      routeArtifactId: 'route-1', route: route(), researchArtifacts: [onlyUnverified]
    })
    expect(result.days.every(day => day.items.length === 0)).toBe(true)
    expect(result.verification.status).toBe('unverified')
    expect(result.warnings).toContain('no_eligible_research_findings')
  })

  it('honors cancellation before building', async () => {
    const controller = new AbortController()
    controller.abort(new Error('cancelled'))
    await expect(new DeterministicTravelGuideBuilder().build({
      routeArtifactId: 'route-1', route: route(), researchArtifacts: []
    }, { signal: controller.signal })).rejects.toThrow('cancelled')
  })
})
